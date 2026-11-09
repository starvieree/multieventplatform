import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import { writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, config } from './utils/supabase.js';
import { assertTopology } from './messaging/topology.js';
import { startRegistrationConsumer } from './consumers/registration.js';
import { publishOutbox } from './publishers/outbox.js';
import { expireReservations, reconcilePending } from './jobs/maintenance.js';
import { errMsg, log } from './utils/log.js';
import { stats } from './utils/stats.js';

const workerId = `${hostname()}-${process.pid}`;
let stopping = false;
const timers: NodeJS.Timeout[] = [];

async function heartbeat() {
  try { writeFileSync(join(tmpdir(), 'worker.alive'), String(Date.now())); } catch {}
  await db.from('worker_heartbeats').upsert({ worker_id: workerId, last_seen: new Date().toISOString(), stats });
}

async function run() {
  const conn: ChannelModel = await amqp.connect(config.rabbitUrl);
  const ch: ConfirmChannel = await conn.createConfirmChannel();
  await assertTopology(ch);
  const consumer = await startRegistrationConsumer(ch, config.concurrency);
  log('info', 'worker aktif', { workerId, prefetch: config.concurrency });

  const closed = new Promise<void>((resolve) => { conn.on('close', () => resolve()); conn.on('error', (e) => log('error', 'amqp error', { err: errMsg(e) })); });
  let publishing = false;
  const every = (ms: number, fn: () => Promise<unknown>) => timers.push(setInterval(() => { fn().catch((e) => log('warn', 'job gagal', { err: errMsg(e) })); }, ms));
  every(1_000, async () => { if (publishing) return; publishing = true; try { await publishOutbox(ch); } finally { publishing = false; } });
  every(10_000, heartbeat);
  every(30_000, expireReservations);
  every(60_000, reconcilePending);

  const shutdown = async () => {               // graceful shutdown: berhenti menerima pesan, selesaikan yang berjalan
    if (stopping) return; stopping = true;
    log('info', 'shutdown'); timers.forEach(clearInterval);
    try { await ch.cancel(consumer.consumerTag); await new Promise((r) => setTimeout(r, 3_000)); await conn.close(); } catch { /* sudah tertutup */ }
    process.exit(0);
  };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  await closed;
  timers.forEach(clearInterval); timers.length = 0;
}

// reconnect otomatis dengan backoff
let delay = 1_000;
for (;;) {
  try { await run(); delay = 1_000; } catch (e) { log('error', 'koneksi gagal', { err: errMsg(e) }); }
  if (stopping) break;
  await new Promise((r) => setTimeout(r, delay)); delay = Math.min(delay * 2, 30_000);
}
