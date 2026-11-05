import { route, ok, ApiError, audit } from '../../../../../../lib/utils/api';
import { adminDb } from '../../../../../../lib/supabase/server';
import { fetchTransactionStatus } from '../../../../../../lib/utils/midtrans';
// Sinkron manual ke Midtrans (server-ke-server); hasil diproses lewat fungsi yang sama dengan webhook (idempotent).
export const POST = route({ auth: 'admin', perm: 'transactions.view', rate: [20, 60_000] }, async ({ ctx, userId, rid }) => {
  const db = adminDb();
  const { data: t } = await db.from('transactions').select('order_id').eq('id', ctx.params.id!).maybeSingle();
  if (!t) throw new ApiError(404, 'not_found', 'Transaksi tidak ditemukan.');
  let s; try { s = await fetchTransactionStatus(t.order_id); } catch { throw new ApiError(502, 'payment_provider_error', 'Midtrans tidak dapat dihubungi.'); }
  const { data } = await db.rpc('process_payment_notification', { p_payload: s, p_signature_valid: s.order_id === t.order_id });
  await audit(db, { actor: userId, action: 'transactions.reconcile', type: 'transactions', id: ctx.params.id, after: data, rid });
  return ok(data);
});
