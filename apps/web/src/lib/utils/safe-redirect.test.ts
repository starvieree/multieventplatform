import { describe, expect, it } from 'vitest';
import { safeRedirect } from './safe-redirect';
import { verifySignature } from './midtrans';
import { createHash } from 'node:crypto';

describe('safeRedirect', () => {
  it('menerima path internal', () => expect(safeRedirect('/events/konser?x=1')).toBe('/events/konser?x=1'));
  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '/api/v1/me', '', null])('menolak %s', (v) => expect(safeRedirect(v as string)).toBe('/tiket-saya'));
});
describe('verifySignature', () => {
  const p = { order_id: 'A-1', status_code: '200', gross_amount: '10000.00' };
  const sig = createHash('sha512').update('A-1' + '200' + '10000.00' + 'KEY').digest('hex');
  it('valid', () => expect(verifySignature({ ...p, signature_key: sig }, 'KEY')).toBe(true));
  it('nominal diubah -> invalid', () => expect(verifySignature({ ...p, gross_amount: '1.00', signature_key: sig }, 'KEY')).toBe(false));
  it('tanpa signature -> invalid', () => expect(verifySignature(p, 'KEY')).toBe(false));
});
