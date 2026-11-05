import { route, ok, pageParams } from '../../../../lib/utils/api';
export const GET = route({}, async ({ ctx }) => {
  const { page, limit, from, to } = pageParams(ctx.url);
  const { data, count } = await ctx.locals.supabase.from('blogs').select('title,slug,excerpt,thumbnail_path,category,published_at', { count: 'exact' }).eq('status', 'published').order('published_at', { ascending: false }).range(from, to);
  return ok(data, { page, limit, total: count ?? 0 });
});
