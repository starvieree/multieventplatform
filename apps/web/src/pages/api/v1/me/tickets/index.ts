import { route, ok } from '../../../../../lib/utils/api';
export const GET = route({ auth: 'user' }, async ({ ctx }) => {
  const { data } = await ctx.locals.supabase.from('tickets').select('id,ticket_code,status,attendee_name,issued_at,registration:registrations(registration_code,event:events(title,slug,start_at,venue_name))').order('issued_at', { ascending: false });
  return ok(data);
});
