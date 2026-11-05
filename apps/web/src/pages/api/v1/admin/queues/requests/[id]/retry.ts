import { route, ok, dbError } from '../../../../../../../lib/utils/api';
import { adminDb } from '../../../../../../../lib/supabase/server';
// Retry/requeue aman: hanya untuk permintaan berstatus failed; reserve_quota tetap idempotent sehingga tidak ada reservasi ganda.
export const POST = route({ auth: 'admin', perm: 'queues.manage', rate: [30, 60_000] }, async ({ ctx, userId }) => {
  const { data, error } = await adminDb().rpc('admin_retry_queue', { p_actor: userId, p_id: ctx.params.id });
  if (error) dbError(error);
  return ok(data);
});
