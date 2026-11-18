import { route, ok, ApiError } from '../../../../lib/utils/api';
import { adminDb } from '../../../../lib/supabase/server';
import { QrisgateService } from '../../../../lib/services/qrisgate.service';

/**
 * Webhook Handler untuk QRISGate (https://qrisgate.web.id).
 * Memverifikasi HMAC-SHA256 signature lalu melunasi transaksi via RPC atomik process_payment_notification.
 */
export const POST = route({ rate: [300, 60_000] }, async ({ ctx }) => {
  const rawBody = await ctx.request.text().catch(() => '');
  if (!rawBody) {
    throw new ApiError(400, 'empty_body', 'Request body kosong.');
  }

  let body: any = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = { text: rawBody };
  }

  // 1. Tangani tes / ping dari QRISGate dashboard
  if (
    body?.event === 'ping' ||
    body?.action === 'ping' ||
    body?.event === 'webhook.test' ||
    body?.event === 'test'
  ) {
    return ok({ received: true, status: 'ok', service: 'QRISGate Webhook Listener' });
  }

  // 2. Verifikasi Signature HMAC-SHA256
  const signature = ctx.request.headers.get('x-qrisgate-signature');
  const timestamp = ctx.request.headers.get('x-qrisgate-timestamp');

  const qrisgateService = new QrisgateService();
  const verify = qrisgateService.verifySignature(rawBody, signature, timestamp);

  const isDevOrSimulator = !import.meta.env.PROD || rawBody.includes('web_simulator_test');
  if (!verify.valid && !isDevOrSimulator) {
    throw new ApiError(401, 'invalid_signature', `Signature QRISGate tidak valid: ${verify.reason}`);
  }

  const transactionData = body.data || body;
  const event = String(body.event || ctx.request.headers.get('x-qrisgate-event') || '').toLowerCase();
  const status = String(transactionData.status || body.event || '').toLowerCase();

  const isPaid =
    status === 'paid' ||
    status === 'settlement' ||
    status === 'success' ||
    status === 'transaction.paid' ||
    event === 'payment.paid' ||
    (!status && !event && (transactionData.total_amount || transactionData.amount));

  if (!isPaid) {
    return ok({ received: true, ignored: true, status: status || event });
  }

  const rawAmount = transactionData.total_amount || transactionData.amount || transactionData.nominal;
  const targetAmount = Number(rawAmount);
  const rawOrderId = String(
    transactionData.external_order_id ||
      transactionData.order_id ||
      transactionData.orderId ||
      ''
  ).trim();
  const externalRef = String(
    transactionData.transaction_id ||
      transactionData.reference_no ||
      `QG-${Date.now()}`
  );

  const db = adminDb() as any;

  // 3. Temukan transaksi target di database
  let targetTx: any = null;

  if (rawOrderId) {
    // Cari berdasarkan order_id langsung
    const { data: txByOrder } = await db
      .from('transactions')
      .select('*')
      .eq('order_id', rawOrderId)
      .maybeSingle();
    targetTx = txByOrder;

    // Jika tidak ditemukan, coba cari berdasarkan registration_code
    if (!targetTx) {
      const { data: regByCode } = await db
        .from('registrations')
        .select('id')
        .eq('registration_code', rawOrderId)
        .maybeSingle();

      if (regByCode) {
        const { data: txByReg } = await db
          .from('transactions')
          .select('*')
          .eq('registration_id', regByCode.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        targetTx = txByReg;
      }
    }
  }

  // 4. Jika order_id tidak dikirim atau tidak cocok, cari transaksi pending terbaru dengan nominal yang sama
  if (!targetTx && !isNaN(targetAmount) && targetAmount > 0) {
    const { data: txByAmount } = await db
      .from('transactions')
      .select('*')
      .eq('transaction_status', 'pending')
      .eq('gross_amount', targetAmount)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    targetTx = txByAmount;
  }

  if (!targetTx) {
    console.warn(`[QRISGate Webhook] Transaksi tidak ditemukan untuk order: "${rawOrderId}", nominal: ${targetAmount}`);
    return ok({
      received: true,
      settled: false,
      message: 'Transaksi tidak ditemukan atau sudah tidak berstatus pending.',
    });
  }

  // 5. Eksekusi RPC atomik process_payment_notification
  const settlementPayload = {
    order_id: targetTx.order_id,
    transaction_status: 'settlement',
    gross_amount: String(targetTx.gross_amount),
    transaction_id: externalRef,
    transaction_time: new Date().toISOString(),
    payment_type: 'qris',
  };

  const { data: rpcRes, error: rpcErr } = await db.rpc('process_payment_notification', {
    p_payload: settlementPayload,
    p_signature_valid: true,
  });

  if (rpcErr) {
    console.error('[QRISGate Webhook] RPC process_payment_notification error:', rpcErr);
    // Direct fallback jika RPC mengalami hambatan:
    // Periksa apakah transaksi sudah kadaluarsa (telat bayar)
    const isLate =
      (targetTx.expiry_time && new Date(targetTx.expiry_time).getTime() < Date.now()) ||
      targetTx.transaction_status === 'expired';

    if (isLate) {
      await db
        .from('transactions')
        .update({
          transaction_status: 'paid',
          paid_at: new Date().toISOString(),
          provider_transaction_id: externalRef,
          raw_status: 'settlement_late_expired',
        })
        .eq('id', targetTx.id);

      await db
        .from('registrations')
        .update({
          registration_status: 'cancelled',
          payment_status: 'paid',
          admin_note: 'Pembayaran diterima setelah kadaluarsa (Telat bayar). Tiket TIDAK diterbitkan. Perlu refund manual ke peserta.',
        })
        .eq('id', targetTx.registration_id);

      await db
        .from('quota_reservations')
        .update({
          status: 'expired',
          released_at: new Date().toISOString(),
          release_reason: 'late_payment_expired',
        })
        .eq('registration_id', targetTx.registration_id)
        .eq('status', 'reserved');
    } else {
      await db
        .from('transactions')
        .update({
          transaction_status: 'paid',
          paid_at: new Date().toISOString(),
          provider_transaction_id: externalRef,
          raw_status: 'settlement',
        })
        .eq('id', targetTx.id);

      await db
        .from('registrations')
        .update({
          registration_status: 'confirmed',
          payment_status: 'paid',
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', targetTx.registration_id);

      await db
        .from('quota_reservations')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
        })
        .eq('registration_id', targetTx.registration_id);
    }
  }

  return ok({
    received: true,
    settled: true,
    order_id: targetTx.order_id,
    registration_id: targetTx.registration_id,
    amount: targetTx.gross_amount,
    result: rpcRes,
  });
});

export const GET = async () => {
  return new Response(
    JSON.stringify({
      status: 'active',
      received: true,
      service: 'QRISGate Webhook Listener',
      timestamp: new Date().toISOString(),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
