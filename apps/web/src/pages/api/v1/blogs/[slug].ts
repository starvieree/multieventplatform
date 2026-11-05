import { route, ok, ApiError } from '../../../../lib/utils/api';
export const GET = route({}, async ({ ctx }) => {
  const { data } = await ctx.locals.supabase.from('blogs').select('*').eq('slug', ctx.params.slug!).eq('status', 'published').maybeSingle();
  if (!data) throw new ApiError(404, 'not_found', 'Artikel tidak ditemukan.');
  return ok(data);
});
