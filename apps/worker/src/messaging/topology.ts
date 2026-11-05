import type { Channel } from 'amqplib';
export const Q = { requests: 'registration.requests', retry: 'registration.retry', dead: 'registration.dead' } as const;
export const DLX = 'registration.dlx';
export const RETRY_DELAY_MS = 10_000;
export const MAX_RETRY = 5;

// Durable queue + DLX + antrean retry bertenggat (TTL) yang kembali ke registration.requests.
export async function assertTopology(ch: Channel) {
  await ch.assertExchange(DLX, 'direct', { durable: true });
  await ch.assertQueue(Q.dead, { durable: true });
  await ch.bindQueue(Q.dead, DLX, 'dead');
  await ch.assertQueue(Q.requests, { durable: true, arguments: { 'x-dead-letter-exchange': DLX, 'x-dead-letter-routing-key': 'dead' } });
  await ch.assertQueue(Q.retry, { durable: true, arguments: { 'x-message-ttl': RETRY_DELAY_MS, 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': Q.requests } });
}
