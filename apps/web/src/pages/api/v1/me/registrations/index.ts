import { route, ok, pageParams } from '../../../../../lib/utils/api';
export const GET = route({ auth: 'user' }, async ({ ctx }) => {
  const { page, limit, from, to } = pageParams(ctx.url);
  let q = ctx.locals.supabase.from('registrations').select('id,registration_code,quantity,total_amount,registration_status,payment_status,created_at,event:events(title,slug,start_at)', { count: 'exact' });
  const s = ctx.url.searchParams.get('status'); if (s) q = q.eq('registration_status', s);
  const { data, count } = await q.order('created_at', { ascending: false }).range(from, to);
  return ok(data, { page, limit, total: count ?? 0 });
});
