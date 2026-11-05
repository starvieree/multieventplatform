import { route, ok, dbError, audit, ApiError } from '../../../../../lib/utils/api';
import { adminDb } from '../../../../../lib/supabase/server';
import { eventBodySchema, toRpc } from '../../../../../lib/validations/event';
export const POST = route({ auth: 'admin', perm: 'events.manage', rate: [30, 60_000], schema: eventBodySchema }, async ({ userId, body, rid }) => {
  const r = toRpc(body);
  const { data, error } = await adminDb().rpc('admin_save_event', { p_actor: userId, p_id: null, ...r });
  if (error) { if (error.code === '23505') throw new ApiError(409, 'duplicate', 'Slug event sudah dipakai.'); dbError(error); }
  await audit(adminDb(), { actor: userId, action: 'events.create', type: 'events', id: data as string, after: { title: body.event.title, slug: body.event.slug }, rid });
  return ok({ id: data }, {}, 201);
});
