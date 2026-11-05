import { route, ok, pageParams } from '../../../../lib/utils/api';
export const GET = route({ rate: [120, 60_000] }, async ({ ctx }) => {
  const u = ctx.url, { page, limit, from, to } = pageParams(u);
  const clean = (s: string | null) => (s ?? '').replace(/[,()%*\\]/g, ' ').trim().slice(0, 80);
  let q = ctx.locals.supabase.from('event_listing').select('*', { count: 'exact' }).in('status', ['published', 'registration_closed', 'ongoing']);
  if (clean(u.searchParams.get('q'))) q = q.ilike('title', `%${clean(u.searchParams.get('q'))}%`);
  if (u.searchParams.get('category')) q = q.eq('category_slug', clean(u.searchParams.get('category')));
  const { data, count, error } = await q.order('start_at').range(from, to);
  if (error) throw new Error('DB_ERROR');
  return ok(data, { page, limit, total: count ?? 0 });
});
