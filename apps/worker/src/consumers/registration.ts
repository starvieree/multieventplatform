import type { Channel, ConsumeMessage } from 'amqplib';
import { z } from 'zod';
import { db } from '../utils/supabase.js';
import { Q, MAX_RETRY } from '../messaging/topology.js';
import { errMsg, log } from '../utils/log.js';
import { stats } from '../utils/stats.js';

const Msg = z.object({
  message_id: z.string().uuid(), event_type: z.literal('registration.requested'), schema_version: z.literal(1),
  data: z.object({ queue_request_id: z.string().uuid(), user_id: z.string().uuid(), event_id: z.string().uuid(), ticket_category_id: z.string().uuid(), quantity: z.number().int().positive(), idempotency_key: z.string() }),
});

export async function startRegistrationConsumer(ch: Channel, prefetch: number) {
  await ch.prefetch(prefetch);
  return ch.consume(Q.requests, (msg) => { if (msg) void handle(ch, msg); }, { noAck: false });
}

async function handle(ch: Channel, msg: ConsumeMessage) {
  let parsed: z.infer<typeof Msg>;
  try { parsed = Msg.parse(JSON.parse(msg.content.toString())); }
  catch { stats.dead++; log('warn', 'payload invalid -> DLQ'); return ch.nack(msg, false, false); }   // permanen -> dead-letter
  const id = parsed.data.queue_request_id;
  try {
    // RPC atomik: lock event+kategori, hitung kuota, buat reservasi, simpan hasil — satu transaksi.
    const { data, error } = await db.rpc('reserve_quota', { p_queue_request_id: id });
    if (error) throw error;
    stats.processed++;
    if ((data as { status: string }).status === 'accepted') stats.accepted++; else stats.rejected++;
    ch.ack(msg);                                        // ack hanya setelah commit; duplikat aman karena reserve_quota idempotent
  } catch (e) {
    const retries = Number(msg.properties.headers?.['x-retry'] ?? 0);
    log('warn', 'reserve_quota gagal', { id, retries, err: errMsg(e) });
    if (retries >= MAX_RETRY) {
      stats.dead++;
      await db.rpc('mark_queue_failed', { p_id: id, p_code: 'RETRY_EXHAUSTED', p_message: errMsg(e) });
      return ch.nack(msg, false, false);                // -> DLX registration.dead
    }
    stats.retried++;
    ch.sendToQueue(Q.retry, msg.content, { persistent: true, contentType: 'application/json', headers: { 'x-retry': retries + 1 } });
    ch.ack(msg);
  }
}
