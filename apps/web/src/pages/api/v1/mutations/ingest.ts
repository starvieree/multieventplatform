import { route, ok, ApiError } from '../../../../lib/utils/api';
import { adminDb } from '../../../../lib/supabase/server';
import { extractAmountFromNotificationText } from '../../../../lib/services/qris-notification';

/**
 * Ingestion Endpoint untuk Forwarder Notifikasi Android / MacroDroid / Webhook Bank.
 * Menerima payload teks notifikasi uang masuk, mengekstrak angka nominal,
 * dan mencocokkan transaksi pending secara atomik di database PostgreSQL.
 */
export const POST = route({ rate: [120, 60_000] }, async ({ ctx }) => {
  const body = (await ctx.request.json().catch(() => null)) as Record<string, any> | null;
  if (!body || typeof body !== 'object') {
    throw new ApiError(400, 'invalid_payload', 'Payload JSON tidak valid.');
  }

  // 1. Verifikasi Device Token jika disetel di env
  const expectedToken = import.meta.env.MERCHANT_DEVICE_TOKEN;
  if (expectedToken) {
    const incomingToken =
      ctx.request.headers.get('x-device-token') ||
      ctx.request.headers.get('authorization')?.replace('Bearer ', '');
    if (incomingToken !== expectedToken) {
      throw new ApiError(401, 'unauthorized_device', 'Device token tidak valid.');
    }
  }

  // 2. Ekstrak nominal dari teks notifikasi atau properti amount langsung
  let parsedAmount = Number(body.amount);
  const rawText = String(body.text || body.message || body.notification_text || '').trim();

  if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
    const extracted = extractAmountFromNotificationText(rawText);
    parsedAmount = extracted.amount || 0;
  }

  if (!parsedAmount || parsedAmount <= 0) {
    throw new ApiError(422, 'amount_not_found', 'Gagal mengekstrak nominal uang masuk dari teks notifikasi.');
  }

  const externalRef = String(body.external_reference || body.ref_id || `INGEST-${Date.now()}`);
  const db = adminDb() as any;

  // 3. Temukan transaksi pending di database yang cocok dengan nominal uang masuk
  const { data: matchedTx } = await db
    .from('transactions')
    .select('*')
    .eq('transaction_status', 'pending')
    .eq('gross_amount', parsedAmount)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!matchedTx) {
    return ok({
      settled: false,
      amount: parsedAmount,
      message: `Tidak ditemukan transaksi pending dengan nominal Rp ${parsedAmount.toLocaleString('id-ID')}.`,
    });
  }

  // 4. Eksekusi RPC atomik process_payment_notification
  const settlementPayload = {
    order_id: matchedTx.order_id,
    transaction_status: 'settlement',
    gross_amount: String(matchedTx.gross_amount),
    transaction_id: externalRef,
    transaction_time: new Date().toISOString(),
    payment_type: 'qris',
  };

  const { data: rpcRes, error: rpcErr } = await db.rpc('process_payment_notification', {
    p_payload: settlementPayload,
    p_signature_valid: true,
  });

  if (rpcErr) {
    console.error('[Mutation Ingest] RPC process_payment_notification error:', rpcErr);
    // Direct fallback jika RPC terkendala
    await db
      .from('transactions')
      .update({
        transaction_status: 'paid',
        paid_at: new Date().toISOString(),
        provider_transaction_id: externalRef,
        raw_status: 'settlement',
      })
      .eq('id', matchedTx.id);

    await db
      .from('registrations')
      .update({
        registration_status: 'confirmed',
        payment_status: 'paid',
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', matchedTx.registration_id);

    await db
      .from('quota_reservations')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
      })
      .eq('registration_id', matchedTx.registration_id);
  }

  return ok({
    settled: true,
    order_id: matchedTx.order_id,
    registration_id: matchedTx.registration_id,
    amount: matchedTx.gross_amount,
    message: 'Transaksi QRIS berhasil dilunasi dan tiket telah diterbitkan.',
    result: rpcRes,
  });
});

export const GET = async () => {
  return new Response(
    JSON.stringify({
      status: 'active',
      service: 'Android Mutation Ingestion Listener',
      timestamp: new Date().toISOString(),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
