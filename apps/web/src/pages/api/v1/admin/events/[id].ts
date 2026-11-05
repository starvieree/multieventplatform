import { route, ok, dbError, audit, ApiError } from '../../../../../lib/utils/api';
import { adminDb } from '../../../../../lib/supabase/server';
import { eventBodySchema, toRpc } from '../../../../../lib/validations/event';
export const GET = route({ auth: 'admin', perm: 'events.manage' }, async ({ ctx }) => {
  const db = adminDb(), id = ctx.params.id!;
  const [{ data: e }, { data: tickets }, { data: fields }] = await Promise.all([db.from('events').select('*').eq('id', id).maybeSingle(), db.from('ticket_categories').select('*').eq('event_id', id).order('price'), db.from('event_form_fields').select('*').eq('event_id', id).order('sort_order')]);
  if (!e) throw new ApiError(404, 'not_found', 'Event tidak ditemukan.');
  return ok({ ...e, ticket_categories: tickets, form_fields: fields });
});
export const PATCH = route({ auth: 'admin', perm: 'events.manage', rate: [30, 60_000], schema: eventBodySchema }, async ({ ctx, userId, body, rid }) => {
  const { error } = await adminDb().rpc('admin_save_event', { p_actor: userId, p_id: ctx.params.id, ...toRpc(body) });
  if (error) { if (error.code === '23505') throw new ApiError(409, 'duplicate', 'Slug event sudah dipakai.'); dbError(error); }
  await audit(adminDb(), { actor: userId, action: 'events.update', type: 'events', id: ctx.params.id, after: { title: body.event.title, total_quota: body.event.total_quota }, rid });
  return ok({ id: ctx.params.id });
});
