import type { ConfirmChannel } from 'amqplib';
import { db } from '../utils/supabase.js';
import { Q } from '../messaging/topology.js';
import { errMsg, log } from '../utils/log.js';
import { stats } from '../utils/stats.js';

// Transactional outbox: baris outbox ditulis satu transaksi dengan queue_request; worker yang mempublikasikan ke RabbitMQ.
// claim_outbox memakai visibility timeout 30 dtk, sehingga publish yang gagal/crash dicoba lagi (consumer idempotent).
export async function publishOutbox(ch: ConfirmChannel): Promise<number> {
  const { data, error } = await db.rpc('claim_outbox', { p_limit: 50 });
  if (error) throw error;
  const rows = (data ?? []) as { id: string; payload: { message_id: string } }[];
  const ok: string[] = [];
  for (const row of rows) {
    try {
      ch.sendToQueue(Q.requests, Buffer.from(JSON.stringify(row.payload)), { persistent: true, contentType: 'application/json', messageId: row.payload.message_id });
      await ch.waitForConfirms();
      ok.push(row.id);
    } catch (e) {
      log('warn', 'publish gagal', { id: row.id, err: errMsg(e) });
      await db.rpc('mark_outbox_failed', { p_id: row.id, p_delay_seconds: 15, p_error: errMsg(e) });
    }
  }
  if (ok.length) { await db.rpc('mark_outbox_published', { p_ids: ok }); stats.published += ok.length; }
  return rows.length;
}
