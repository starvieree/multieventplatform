import { route, ok, ApiError, pageParams, audit } from '../../../../../lib/utils/api';
import { adminDb } from '../../../../../lib/supabase/server';
import { byApi, schemaFor, assertPerm, cleanSearch } from '../../../../../lib/admin-resources';
// CRUD admin generik berbasis konfigurasi: izin dicek per resource, validasi zod dari definisi field, semua perubahan masuk audit log.
export const GET = route({ auth: 'admin' }, async ({ ctx }) => {
  const res = byApi(ctx.params.resource!);
  if (!res) throw new ApiError(404, 'not_found', 'Resource tidak ditemukan.');
  assertPerm(ctx.locals, res.perm);
  const { page, limit, from, to } = pageParams(ctx.url, 100);
  let q = adminDb().from(res.table).select(res.select, { count: 'exact' });
  const s = cleanSearch(ctx.url.searchParams.get('q')); if (s && res.search.length) q = q.or(res.search.map((c) => `${c}.ilike.%${s}%`).join(','));
  const st = ctx.url.searchParams.get('status'); if (st && res.statusCol && res.statusOptions?.includes(st)) q = q.eq(res.statusCol, st);
  const { data, count, error } = await q.order(res.order, { ascending: res.order === 'sort_order' || res.order === 'name' }).range(from, to);
  if (error) throw new Error('DB_ERROR');
  return ok(data, { page, limit, total: count ?? 0 });
});
export const POST = route({ auth: 'admin', rate: [60, 60_000] }, async ({ ctx, userId, rid }) => {
  const res = byApi(ctx.params.resource!);
  if (!res || !res.create || res.slug === 'events') throw new ApiError(404, 'not_found', 'Resource tidak ditemukan.');
  assertPerm(ctx.locals, res.perm);
  const parsed = schemaFor(res).safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, 'invalid_request', parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const row = res.prepare ? res.prepare(parsed.data) : parsed.data;
  const { data, error } = await adminDb().from(res.table).insert(row).select('id').single();
  if (error) throw new ApiError(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'duplicate' : 'internal_error', error.code === '23505' ? 'Data dengan slug/nama tersebut sudah ada.' : 'Gagal menyimpan.');
  await audit(adminDb(), { actor: userId, action: `${res.slug}.create`, type: res.table, id: data.id, after: row, rid });
  return ok(data, {}, 201);
});
