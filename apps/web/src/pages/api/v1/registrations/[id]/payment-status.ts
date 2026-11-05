import { route, ok, ApiError } from '../../../../../lib/utils/api';
import { adminDb } from '../../../../../lib/supabase/server';
import { fetchTransactionStatus } from '../../../../../lib/utils/midtrans';
const SEL = 'id,registration_code,registration_status,payment_status,total_amount,transactions(order_id,transaction_status,payment_type,expiry_time,paid_at,created_at),reservations:quota_reservations(status,expires_at)';
export const GET = route({ auth: 'user', rate: [30, 60_000] }, async ({ ctx }) => {
  const sb = ctx.locals.supabase;
  let { data } = await sb.from('registrations').select(SEL).eq('id', ctx.params.id!).maybeSingle();
  if (!data) throw new ApiError(404, 'not_found', 'Pendaftaran tidak ditemukan.');
  const pending = (data as any).transactions?.find((t: any) => t.transaction_status === 'pending');
  if (pending && ctx.url.searchParams.get('refresh') === '1') {                    // sinkron manual ke Midtrans dari server; hasilnya diproses lewat jalur yang sama dengan webhook
    try { const s = await fetchTransactionStatus(pending.order_id); if (s.order_id === pending.order_id) await adminDb().rpc('process_payment_notification', { p_payload: s, p_signature_valid: true }); } catch { /* status tetap dari database */ }
    ({ data } = await sb.from('registrations').select(SEL).eq('id', ctx.params.id!).maybeSingle());
  }
  return ok(data);
});
