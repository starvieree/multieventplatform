import { route, ok, ApiError } from '../../../../lib/utils/api';
import { adminDb } from '../../../../lib/supabase/server';
import { verifySignature } from '../../../../lib/utils/midtrans';
// Satu-satunya jalur yang boleh mengubah status pembayaran menjadi lunas. Tanpa auth user; dilindungi signature SHA512.
export const POST = route({ rate: [300, 60_000] }, async ({ ctx }) => {
  const payload = await ctx.request.json().catch(() => null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ApiError(400, 'invalid_request', 'Payload tidak valid.');
  const valid = verifySignature(payload as Record<string, unknown>);
  const { data, error } = await adminDb().rpc('process_payment_notification', { p_payload: payload, p_signature_valid: valid });
  if (error) throw new Error('DB_ERROR');                               // 500 -> Midtrans mengulang notifikasi
  if (!valid) throw new ApiError(403, 'invalid_signature', 'Signature tidak valid.');
  return ok(data);                                                      // 200 untuk processed/duplicate/ignored agar Midtrans berhenti mengulang
});
