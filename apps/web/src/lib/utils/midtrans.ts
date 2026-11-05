import { createHash, timingSafeEqual } from 'node:crypto';

const prod = () => import.meta.env.MIDTRANS_IS_PRODUCTION === 'true';
const urls = () => (prod()
  ? { snap: 'https://app.midtrans.com/snap/v1/transactions', api: 'https://api.midtrans.com/v2' }
  : { snap: 'https://app.sandbox.midtrans.com/snap/v1/transactions', api: 'https://api.sandbox.midtrans.com/v2' });
const auth = () => 'Basic ' + Buffer.from(import.meta.env.MIDTRANS_SERVER_KEY + ':').toString('base64');

// signature_key = SHA512(order_id + status_code + gross_amount + ServerKey); dibandingkan constant-time.
export function verifySignature(p: Record<string, unknown>, serverKey = import.meta.env.MIDTRANS_SERVER_KEY as string): boolean {
  const { order_id, status_code, gross_amount, signature_key } = p as Record<string, string>;
  if (!order_id || !status_code || !gross_amount || !signature_key || !serverKey) return false;
  const expected = createHash('sha512').update(order_id + status_code + gross_amount + serverKey).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(signature_key));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createSnapTransaction(input: { orderId: string; amount: number; email: string; name: string; itemName: string; qty: number; minutes: number; finishUrl: string }) {
  const res = await fetch(urls().snap, {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: auth() },
    body: JSON.stringify({
      transaction_details: { order_id: input.orderId, gross_amount: Math.round(input.amount) },
      item_details: [{ id: 'ticket', name: input.itemName.slice(0, 50), price: Math.round(input.amount / input.qty), quantity: input.qty }],
      customer_details: { first_name: input.name.slice(0, 50), email: input.email },
      callbacks: { finish: input.finishUrl },
      expiry: { unit: 'minute', duration: Math.max(1, input.minutes) },
    }),
  });
  if (!res.ok) throw new Error(`MIDTRANS_CREATE_${res.status}`);
  return (await res.json()) as { token: string; redirect_url: string };
}

export async function fetchTransactionStatus(orderId: string) {
  const res = await fetch(`${urls().api}/${encodeURIComponent(orderId)}/status`, { headers: { Accept: 'application/json', Authorization: auth() }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`MIDTRANS_STATUS_${res.status}`);
  return (await res.json()) as Record<string, string>;
}
export const snapScriptUrl = () => (prod() ? 'https://app.midtrans.com/snap/snap.js' : 'https://app.sandbox.midtrans.com/snap/snap.js');
