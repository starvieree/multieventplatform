import { route, ok, pageParams } from '../../../../../lib/utils/api';
export const GET = route({ auth: 'user' }, async ({ ctx }) => {
  const { page, limit, from, to } = pageParams(ctx.url);
  const { data, count } = await ctx.locals.supabase.from('notifications').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);
  return ok(data, { page, limit, total: count ?? 0 });
});
