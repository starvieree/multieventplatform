import { route, ok, ApiError } from '../../../../../lib/utils/api';
export const GET = route({ auth: 'user' }, async ({ ctx }) => {
  const { data } = await ctx.locals.supabase.from('tickets').select('*, registration:registrations(registration_code,event:events(title,slug,start_at,end_at,venue_name,address))').eq('id', ctx.params.id!).maybeSingle();
  if (!data) throw new ApiError(404, 'not_found', 'Tiket tidak ditemukan.');
  return ok(data);
});
