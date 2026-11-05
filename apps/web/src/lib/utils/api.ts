import type { APIContext, APIRoute } from 'astro';
import type { ZodTypeAny, z } from 'zod';
import { rateLimit } from './rate-limit';

export class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
export const ok = (data: unknown, meta: Record<string, unknown> = {}, status = 200) => new Response(JSON.stringify({ success: true, data, meta }), { status, headers });
export const fail = (status: number, code: string, message: string, requestId: string, details: unknown = {}) =>
  new Response(JSON.stringify({ success: false, error: { code, message, details }, request_id: requestId }), { status, headers });

// Kode error dari fungsi SQL -> status HTTP kontrak API.
const DB_ERRORS: Record<string, [number, string]> = {
  IDEMPOTENCY_CONFLICT: [409, 'Kunci idempotensi sudah dipakai dengan data berbeda.'], USER_LIMIT: [422, 'Batas pendaftaran per akun tercapai.'],
  REGISTRATION_CLOSED: [422, 'Pendaftaran tidak dibuka untuk event ini.'], INVALID_CATEGORY: [422, 'Kategori tiket tidak valid atau belum dijual.'],
  ACCOUNT_SUSPENDED: [403, 'Akun ditangguhkan.'], NOT_FOUND: [404, 'Data tidak ditemukan.'], INVALID_STATE: [409, 'Status saat ini tidak mengizinkan tindakan ini.'],
  RESERVATION_EXPIRED: [409, 'Waktu reservasi sudah berakhir. Silakan daftar ulang.'], QUOTA_BELOW_USED: [422, 'Kuota tidak boleh di bawah jumlah yang sudah direservasi/terkonfirmasi.'],
};
export function dbError(error: { message?: string } | null): never {
  const code = Object.keys(DB_ERRORS).find((k) => error?.message?.includes(k));
  if (code) throw new ApiError(DB_ERRORS[code][0], code, DB_ERRORS[code][1]);
  throw new Error('DB_ERROR');
}

type Opts<S extends ZodTypeAny> = { auth?: 'none' | 'user' | 'admin'; perm?: string; rate?: [limit: number, windowMs: number]; schema?: S };
type Ctx<S extends ZodTypeAny> = { ctx: APIContext; rid: string; userId: string; body: z.infer<S> };

export function route<S extends ZodTypeAny = ZodTypeAny>(opts: Opts<S>, fn: (c: Ctx<S>) => Promise<Response>): APIRoute {
  return async (ctx) => {
    const rid = ctx.locals.requestId;
    try {
      const [limit, win] = opts.rate ?? [120, 60_000];
      const who = ctx.locals.user?.id ?? ctx.clientAddress;
      if (!rateLimit(`${new URL(ctx.request.url).pathname}:${ctx.request.method}:${who}`, limit, win)) throw new ApiError(429, 'rate_limited', 'Terlalu banyak permintaan. Coba lagi sebentar.');
      const auth = opts.auth ?? 'none';
      if (auth !== 'none' && !ctx.locals.user) throw new ApiError(401, 'unauthenticated', 'Silakan masuk terlebih dahulu.');
      if (auth === 'admin') {
        const { roles, permissions } = ctx.locals;
        if (!roles.includes('admin') && !roles.includes('super_admin')) throw new ApiError(403, 'forbidden', 'Anda tidak memiliki akses.');
        if (opts.perm && !permissions.includes(opts.perm)) throw new ApiError(403, 'forbidden', 'Anda tidak memiliki izin untuk tindakan ini.');
      }
      let body: unknown;
      if (opts.schema) {
        const raw = await ctx.request.json().catch(() => null);
        const parsed = opts.schema.safeParse(raw);
        if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Data yang dikirim tidak valid: ' + parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'body'} ${i.message}`).join('; '));
        body = parsed.data;
      }
      return await fn({ ctx, rid, userId: ctx.locals.user?.id ?? '', body: body as z.infer<S> });
    } catch (e) {
      if (e instanceof ApiError) return fail(e.status, e.code, e.message, rid);
      console.error(JSON.stringify({ level: 'error', request_id: rid, path: new URL(ctx.request.url).pathname, err: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }));  // tanpa payload/secret
      return fail(500, 'internal_error', 'Terjadi kesalahan pada server.', rid);
    }
  };
}

export async function audit(db: { from: (t: string) => any }, a: { actor: string; action: string; type: string; id?: string; before?: unknown; after?: unknown; reason?: string; rid: string }) {
  await db.from('activity_logs').insert({ actor_user_id: a.actor, action: a.action, resource_type: a.type, resource_id: a.id, before_data: a.before ?? null, after_data: a.after ?? null, reason: a.reason, request_id: a.rid });
}
export const pageParams = (url: URL, max = 50) => {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
  const limit = Math.min(max, Math.max(1, Number(url.searchParams.get('limit') ?? 12) || 12));
  return { page, limit, from: (page - 1) * limit, to: page * limit - 1 };
};
