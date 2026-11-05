import { route, ok, ApiError } from '../../../../lib/utils/api';
export const GET = route({}, async ({ ctx }) => {
  const sb = ctx.locals.supabase;
  const { data: e } = await sb.from('events').select('*, category:event_categories(name,slug)').eq('slug', ctx.params.slug!).maybeSingle();
  if (!e) throw new ApiError(404, 'not_found', 'Event tidak ditemukan.');
  const [{ data: ticket_categories }, { data: availability }] = await Promise.all([sb.from('ticket_categories').select('*').eq('event_id', e.id).eq('is_active', true), sb.from('ticket_availability').select('*').eq('event_id', e.id)]);
  return ok({ ...e, ticket_categories, availability });
});
