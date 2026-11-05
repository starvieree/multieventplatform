import { defineMiddleware } from 'astro:middleware';
import { createSupabase } from './lib/supabase/server';

const PROD = import.meta.env.PROD;
const SB = new URL(import.meta.env.PUBLIC_SUPABASE_URL || 'http://localhost').origin;
const MIDTRANS = 'https://app.sandbox.midtrans.com https://app.midtrans.com';
const CSP = [
  "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
  `script-src 'self' ${MIDTRANS}`, "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", 'font-src https://fonts.gstatic.com',
  `img-src 'self' data: blob: ${SB}`, `connect-src 'self' ${SB} ${MIDTRANS} https://api.sandbox.midtrans.com https://api.midtrans.com`, `frame-src ${MIDTRANS}`,
].join('; ');

const PRIVATE = ['/dashboard', '/registration', '/admin'];
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { pathname, search, origin } = ctx.url;
  ctx.locals.requestId = crypto.randomUUID();
  ctx.locals.user = null; ctx.locals.roles = []; ctx.locals.permissions = [];
  ctx.locals.supabase = createSupabase(ctx.request, ctx.cookies);

  // CSRF untuk API JSON: Origin harus sama (webhook Midtrans server-to-server dikecualikan; ia dilindungi signature).
  if (pathname.startsWith('/api/') && MUTATING.has(ctx.request.method) && pathname !== '/api/v1/webhooks/midtrans') {
    const o = ctx.request.headers.get('origin');
    if (!o || o !== origin) return json(403, 'forbidden_origin', 'Permintaan ditolak.', ctx.locals.requestId);
  }

  // Sesi diverifikasi ke Supabase Auth (getUser), bukan dari cookie mentah.
  if ((ctx.request.headers.get('cookie') ?? '').includes('sb-')) {
    const { data } = await ctx.locals.supabase.auth.getUser();
    ctx.locals.user = data.user ?? null;
  }
  const needsAccess = pathname.startsWith('/admin') || pathname.startsWith('/api/v1/admin');
  if (ctx.locals.user && needsAccess) {
    const { data } = await ctx.locals.supabase.rpc('my_access');
    ctx.locals.roles = (data?.roles as string[]) ?? [];
    ctx.locals.permissions = (data?.permissions as string[]) ?? [];
  }

  if (PRIVATE.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    if (!ctx.locals.user) return ctx.redirect(`/login?next=${encodeURIComponent(pathname + search)}`);
    if (pathname.startsWith('/admin') && !ctx.locals.roles.some((r) => r === 'admin' || r === 'super_admin')) return ctx.rewrite('/404');   // admin tidak terlihat oleh non-admin
  }

  const res = await next();
  const h = res.headers;
  h.set('X-Content-Type-Options', 'nosniff'); h.set('X-Frame-Options', 'DENY'); h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)'); h.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (PROD) { h.set('Content-Security-Policy', CSP); h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains'); }
  if (PRIVATE.some((p) => pathname.startsWith(p)) || pathname.startsWith('/api/')) h.set('Cache-Control', 'private, no-store');
  h.set('X-Request-Id', ctx.locals.requestId);
  return res;
});

const json = (status: number, code: string, message: string, request_id: string) =>
  new Response(JSON.stringify({ success: false, error: { code, message, details: {} }, request_id }), { status, headers: { 'Content-Type': 'application/json' } });
