import { route, ok, dbError } from '../../../../lib/utils/api';
import { adminDb } from '../../../../lib/supabase/server';
import { queueSchema } from '../../../../lib/validations/schemas';
// Identitas user SELALU dari sesi server, tidak pernah dari body. Operasi atomik + outbox di satu transaksi database.
export const POST = route({ auth: 'user', rate: [10, 60_000], schema: queueSchema }, async ({ userId, body }) => {
  const { data, error } = await adminDb().rpc('request_registration_queue', { p_user: userId, p_event: body.event_id, p_category: body.ticket_category_id, p_qty: body.quantity, p_key: body.idempotency_key });
  if (error) dbError(error);
  return ok(data, {}, 202);
});
