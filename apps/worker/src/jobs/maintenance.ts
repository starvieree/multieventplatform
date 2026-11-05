import { db, config } from '../utils/supabase.js';
import { errMsg, log } from '../utils/log.js';
import { stats } from '../utils/stats.js';

export async function expireReservations() {
  const { data, error } = await db.rpc('expire_reservations');
  if (error) return log('error', 'expire gagal', { err: errMsg(error) });
  if (data) { stats.expired += Number(data); log('info', 'reservasi kedaluwarsa dilepas', { count: data }); }
}

// Rekonsiliasi: transaksi pending terlalu lama dicek ke Midtrans dari server, lalu diproses lewat jalur yang sama dengan webhook.
export async function reconcilePending() {
  if (!config.midtransKey) return;
  const { data } = await db.rpc('stale_pending_transactions');
  const base = config.midtransProd ? 'https://api.midtrans.com/v2' : 'https://api.sandbox.midtrans.com/v2';
  for (const { order_id } of (data ?? []) as { order_id: string }[]) {
    try {
      const res = await fetch(`${base}/${encodeURIComponent(order_id)}/status`, {
        headers: { Accept: 'application/json', Authorization: 'Basic ' + Buffer.from(config.midtransKey + ':').toString('base64') }, signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const p = (await res.json()) as Record<string, string>;
      if (p.order_id !== order_id || !p.transaction_status) continue;
      const { error } = await db.rpc('process_payment_notification', { p_payload: p, p_signature_valid: true });  // respons server-ke-server dipercaya
      if (error) throw error;
      stats.reconciled++;
    } catch (e) { log('warn', 'rekonsiliasi gagal', { order_id, err: errMsg(e) }); }
  }
}
