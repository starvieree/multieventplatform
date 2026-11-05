import { route, ok, ApiError } from '../../../../lib/utils/api';
import { ERROR_TEXT } from '../../../../lib/utils/status';
export const GET = route({ auth: 'user', rate: [60, 60_000] }, async ({ ctx }) => {
  const sb = ctx.locals.supabase;
  const { data: q } = await sb.from('queue_requests').select('id,status,error_code,event_id,quantity,queued_at,processed_at').eq('id', ctx.params.id!).maybeSingle();
  if (!q) throw new ApiError(404, 'not_found', 'Permintaan antrean tidak ditemukan.');
  const { data: reg } = q.status === 'accepted' ? await sb.from('registrations').select('id').eq('queue_request_id', q.id).maybeSingle() : { data: null };
  return ok({ ...q, registration_id: reg?.id ?? null, message: q.error_code ? ERROR_TEXT[q.error_code] ?? 'Permintaan tidak dapat diproses.' : null });
});
