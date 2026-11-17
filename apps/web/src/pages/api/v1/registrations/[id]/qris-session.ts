import { route, ok, ApiError } from '../../../../../lib/utils/api';
import { adminDb } from '../../../../../lib/supabase/server';
import { QrisService, parseQris } from '../../../../../lib/services/qris.service';
import { QrisgateService } from '../../../../../lib/services/qrisgate.service';

export const POST = route({ auth: 'user', rate: [15, 60_000] }, async ({ ctx, userId }) => {
  const db = adminDb() as any;
  const regId = ctx.params.id;

  // 1. Ambil data pendaftaran dan cek reservasi aktif
  const { data: regRaw, error: regErr } = await db
    .from('registrations')
    .select(
      'id, user_id, registration_code, registration_status, quantity, total_amount, ticket_category_id, ticket:ticket_categories(price,name), event:events(title), reservations:quota_reservations(status,expires_at)'
    )
    .eq('id', regId!)
    .maybeSingle();

  if (regErr || !regRaw) {
    throw new ApiError(404, 'not_found', 'Pendaftaran tidak ditemukan.');
  }

  const reg = regRaw as any;

  if (reg.user_id !== userId) {
    const { roles } = ctx.locals;
    if (!roles?.includes('admin') && !roles?.includes('super_admin')) {
      throw new ApiError(403, 'forbidden', 'Anda tidak memiliki akses ke pendaftaran ini.');
    }
  }

  if (reg.registration_status !== 'awaiting_payment') {
    throw new ApiError(409, 'invalid_state', 'Status pendaftaran tidak dalam antrean pembayaran.');
  }

  const activeRes = reg.reservations?.find(
    (x: any) => x.status === 'reserved' && new Date(x.expires_at).getTime() > Date.now()
  );
  if (!activeRes) {
    throw new ApiError(409, 'reservation_expired', 'Batas waktu reservasi telah berakhir.');
  }

  // Nominal dasar sesuai harga tiket event yang ditentukan admin
  const basePrice = reg.ticket?.price !== undefined && reg.ticket?.price !== null ? Number(reg.ticket.price) : 0;
  const calculatedAmount = basePrice * (reg.quantity || 1);
  const baseAmount = calculatedAmount > 0 ? calculatedAmount : Number(reg.total_amount) || 1;

  if (baseAmount <= 0) {
    throw new ApiError(400, 'invalid_amount', 'Nominal tiket harus lebih besar dari 0 untuk membuat QRIS.');
  }

  // 2. Cek apakah ada transaksi QRIS pending sebelumnya
  const { data: existingTxRaw } = await db
    .from('transactions')
    .select('*')
    .eq('registration_id', reg.id)
    .eq('transaction_status', 'pending')
    .maybeSingle();

  const existingTx = existingTxRaw as any;

  // Jika transaksi pending masih aktif (belum expired), gunakan kembali QRIS tersebut
  if (
    existingTx &&
    new Date(existingTx.expiry_time).getTime() > Date.now() &&
    existingTx.raw_status
  ) {
    const rawQr = existingTx.raw_status;
    let qrUrl = '';
    try {
      const QRCode = (await import('qrcode')).default;
      qrUrl = await QRCode.toDataURL(rawQr, { errorCorrectionLevel: 'M', margin: 2, scale: 8 });
    } catch {}

    const parsed = parseQris(rawQr);
    const existingGross = Number(existingTx.gross_amount);
    const uCode = Math.max(0, existingGross - baseAmount);

    return ok({
      order_id: existingTx.order_id,
      base_amount: baseAmount,
      unique_code: uCode,
      total_amount: existingGross,
      qr_data_url: qrUrl,
      qris_string: rawQr,
      info: {
        merchantName: parsed.merchantName || 'musgraph',
        city: parsed.merchantCity || 'BANYUWANGI',
        postalCode: parsed.postalCode || '68465',
        crc: parsed.crc || '',
      },
      expires_at: existingTx.expiry_time,
      reused: true,
    });
  }

  // 3. Batalkan transaksi pending sebelumnya (jika expired) agar tidak melanggar unique index
  if (existingTx) {
    await db
      .from('transactions')
      .update({ transaction_status: 'cancelled', raw_status: 'replaced_by_new_qris' })
      .eq('id', existingTx.id);
  }

  // 4. Generate order ID baru
  const orderId = `QRIS-${reg.registration_code || String(reg.id).slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  // 5. Buat QRIS Dinamis (utamakan API QRISGate cloud, fallback ke EMVCo lokal)
  const qrisgateService = new QrisgateService();
  let totalAmount = baseAmount;
  let uniqueCode = 0;
  let qrDataUrl = '';
  let qrisString = '';
  let checkoutUrl = '';
  let qrisInfo: any = null;
  let provider = 'qris';

  if (qrisgateService.getApiKey()) {
    try {
      const qgRes = await qrisgateService.createTransaction({
        externalOrderId: orderId,
        amount: baseAmount,
        customerName: 'Peserta',
        returnUrl: `${ctx.url.origin}/registration/${reg.id}/status`,
      });

      if (qgRes.success && qgRes.data) {
        totalAmount = Number(qgRes.data.total_amount || baseAmount);
        uniqueCode = Number(qgRes.data.unique_code || 0);
        qrisString = qgRes.data.qr_string || qgRes.data.qris_string || '';
        checkoutUrl = qgRes.data.checkout_url || '';
        qrDataUrl = qgRes.qrDataUrl || '';
        provider = 'qrisgate';

        try {
          const parsed = parseQris(qrisString);
          qrisInfo = {
            merchantName: qgRes.data.merchant_name || parsed.merchantName || 'musgraph',
            city: parsed.merchantCity || 'BANYUWANGI',
            postalCode: parsed.postalCode || '68465',
            acquirer: (qgRes.data as any).acquirer || 'SHOPEEPAY',
            crc: parsed.crc || '',
          };
        } catch {}
      } else {
        console.warn('[QRIS Session] QRISGate API notice:', qgRes.error);
      }
    } catch (err: any) {
      console.warn('[QRIS Session] QRISGate call failed, fallback to local EMVCo:', err.message);
    }
  }

  // Fallback ke generator EMVCo lokal Tag 54 jika QRISGate offline atau kredit tidak tersedia
  if (!qrisString || !qrDataUrl) {
    const qrisService = new QrisService();
    const dynamicQris = await qrisService.generateDynamicQris(baseAmount);
    totalAmount = baseAmount;
    uniqueCode = 0;
    qrisString = dynamicQris.raw;
    qrDataUrl = dynamicQris.qrDataUrl;
    qrisInfo = dynamicQris.info;
    provider = 'qris';
  }

  // 6. Simpan transaksi baru ke tabel transactions
  const { error: insErr } = await db.from('transactions').insert({
    registration_id: reg.id,
    order_id: orderId,
    provider,
    payment_type: 'qris',
    gross_amount: totalAmount,
    currency: 'IDR',
    raw_status: qrisString,
    expiry_time: activeRes.expires_at,
    transaction_status: 'pending',
  });

  if (insErr) {
    console.error('[QRIS Session] Insert transaction error:', insErr);
    throw new ApiError(500, 'db_error', 'Gagal membuat sesi transaksi QRIS.');
  }

  // 7. Update status pendaftaran menjadi pending & sinkronkan total_amount
  await db
    .from('registrations')
    .update({
      total_amount: totalAmount,
      payment_status: 'pending',
    })
    .eq('id', reg.id);

  return ok({
    order_id: orderId,
    base_amount: baseAmount,
    unique_code: uniqueCode,
    total_amount: totalAmount,
    qr_data_url: qrDataUrl,
    qris_string: qrisString,
    checkout_url: checkoutUrl,
    info: qrisInfo,
    expires_at: activeRes.expires_at,
    reused: false,
  });
});
