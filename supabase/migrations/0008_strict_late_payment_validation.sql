-- ==============================================================================
-- 0008_strict_late_payment_validation.sql
-- Validasi Ketat Pembayaran Melebihi Batas Waktu (Late Payment / Kadaluarsa)
--
-- Aturan Bisnis:
-- 1. Jika pembayaran masuk dalam batas waktu yang ditentukan (tepat waktu):
--    -> Pendaftaran dikonfirmasi dan E-Ticket resmi diterbitkan (_issue_tickets).
-- 2. Jika pembayaran masuk setelah batas waktu habis / kadaluarsa:
--    -> Transaksi dicatat 'paid' (agar uang tercatat dan tidak hilang dari pembukuan),
--    -> Pendaftaran berstatus 'cancelled' / dibatalkan,
--    -> TIKET TIDAK DITERBITKAN (tidak dapat tiket karena terlambat bayar),
--    -> Kuota event tidak diambil / reservasi dilepas,
--    -> Diberikan admin_note bahwa transaksi perlu refund ke peserta.
-- ==============================================================================

-- 1. Update fungsi process_payment_notification
CREATE OR REPLACE FUNCTION public.process_payment_notification(p_payload JSONB, p_signature_valid BOOLEAN) 
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order TEXT := p_payload ->> 'order_id'; 
  v_status TEXT := p_payload ->> 'transaction_status'; 
  v_code TEXT := p_payload ->> 'status_code';
  v_tid TEXT := p_payload ->> 'transaction_id'; 
  v_fraud TEXT := p_payload ->> 'fraud_status'; 
  v_gross NUMERIC; 
  v_key TEXT; 
  v_nid UUID; 
  v_new TEXT;
  v_is_late BOOLEAN := false;
  t transactions; 
  reg registrations; 
  res quota_reservations; 
  v_redacted JSONB := p_payload - 'signature_key' - 'va_numbers' - 'permata_va_number' - 'bill_key' - 'masked_card' - 'card_type';
BEGIN
  IF NOT p_signature_valid THEN
    INSERT INTO payment_notifications (order_id, provider_transaction_id, signature_valid, processing_status, status_code, payload_redacted)
    VALUES (left(v_order, 100), v_tid, false, 'rejected_signature', v_code, v_redacted);
    RETURN jsonb_build_object('result', 'invalid_signature');
  END IF;

  BEGIN v_gross := (p_payload ->> 'gross_amount')::numeric; EXCEPTION WHEN OTHERS THEN v_gross := null; END;
  v_key := encode(sha256(convert_to(concat_ws('|', v_order, v_status, v_code, p_payload ->> 'gross_amount', v_tid, p_payload ->> 'transaction_time'), 'UTF8')), 'hex');
  
  INSERT INTO payment_notifications (notification_key, order_id, provider_transaction_id, signature_valid, status_code, payload_redacted)
  VALUES (v_key, v_order, v_tid, true, v_code, v_redacted) ON CONFLICT (notification_key) DO NOTHING RETURNING id INTO v_nid;
  
  IF v_nid IS NULL THEN RETURN jsonb_build_object('result', 'duplicate'); END IF;

  SELECT * INTO t FROM transactions WHERE order_id = v_order FOR UPDATE;
  IF NOT FOUND THEN 
    UPDATE payment_notifications SET processing_status = 'unknown_order' WHERE id = v_nid; 
    RETURN jsonb_build_object('result', 'unknown_order'); 
  END IF;
  
  UPDATE payment_notifications SET transaction_id = t.id WHERE id = v_nid;

  IF v_gross IS DISTINCT FROM t.gross_amount OR (t.provider_transaction_id IS NOT NULL AND v_tid IS NOT NULL AND t.provider_transaction_id <> v_tid) THEN
    UPDATE payment_notifications SET processing_status = 'rejected_mismatch' WHERE id = v_nid; 
    RETURN jsonb_build_object('result', 'mismatch');
  END IF;

  v_new := CASE
    WHEN v_status = 'settlement' THEN 'paid'
    WHEN v_status = 'capture' AND COALESCE(v_fraud, 'accept') = 'accept' THEN 'paid'
    WHEN v_status IN ('capture', 'pending') THEN 'pending'
    WHEN v_status = 'deny' THEN 'failed' 
    WHEN v_status = 'cancel' THEN 'cancelled' 
    WHEN v_status = 'expire' THEN 'expired'
    WHEN v_status = 'refund' THEN 'refunded' 
    WHEN v_status = 'partial_refund' THEN 'partially_refunded' 
    ELSE null 
  END;

  IF v_new IS NULL THEN 
    UPDATE payment_notifications SET processing_status = 'ignored_unknown_status' WHERE id = v_nid; 
    RETURN jsonb_build_object('result', 'ignored'); 
  END IF;

  -- Status final tidak boleh mundur (namun jika v_new = 'paid', biarkan diproses untuk penanganan telat bayar)
  IF (t.transaction_status IN ('refunded', 'failed') AND v_new <> 'paid')
     OR (t.transaction_status = 'cancelled' AND v_new <> 'paid')
     OR (t.transaction_status = 'paid' AND v_new NOT IN ('paid', 'refunded', 'partially_refunded')) 
     OR (t.transaction_status = 'partially_refunded' AND v_new <> 'refunded') THEN
    UPDATE payment_notifications SET processing_status = 'ignored_out_of_order' WHERE id = v_nid; 
    RETURN jsonb_build_object('result', 'ignored_out_of_order');
  END IF;

  SELECT * INTO reg FROM registrations WHERE id = t.registration_id FOR UPDATE;

  -- ===========================================================================
  -- JIKA NOTIFIKASI ADALAH PEMBAYARAN LUNAS ('paid' / 'settlement')
  -- ===========================================================================
  IF v_new = 'paid' THEN
    SELECT * INTO res FROM quota_reservations WHERE registration_id = reg.id ORDER BY reserved_at DESC LIMIT 1 FOR UPDATE;

    -- VALIDASI KETAT WAKTU PEMBAYARAN:
    -- Dikatakan terlambat (kadaluarsa) jika:
    -- 1. Batas waktu expiry_time di tabel transactions sudah lewat
    -- 2. ATAU batas waktu expires_at di tabel quota_reservations sudah lewat
    -- 3. ATAU status reservasi kuota bukan 'reserved' (misal: 'expired' atau 'released')
    -- 4. ATAU status pendaftaran sudah 'expired' atau 'cancelled'
    -- 5. ATAU status transaksi sendiri sudah 'expired'
    v_is_late := (
      (t.expiry_time IS NOT NULL AND t.expiry_time < now())
      OR (res.id IS NOT NULL AND res.expires_at IS NOT NULL AND res.expires_at < now())
      OR (res.id IS NOT NULL AND res.status IN ('expired', 'released'))
      OR (reg.registration_status IN ('expired', 'cancelled'))
      OR (t.transaction_status = 'expired')
    );

    IF v_is_late THEN
      -- -----------------------------------------------------------------------
      -- KASUS A: PEMBAYARAN TELAT / SUDAH KADALUARSA -> JANGAN TERBITKAN TIKET!
      -- -----------------------------------------------------------------------
      UPDATE transactions SET 
        transaction_status = 'paid', 
        provider_transaction_id = COALESCE(provider_transaction_id, v_tid), 
        fraud_status = v_fraud,
        payment_type = COALESCE(p_payload ->> 'payment_type', payment_type), 
        raw_status = 'settlement_late_expired',
        transaction_time = COALESCE((p_payload ->> 'transaction_time')::timestamp at time zone 'Asia/Jakarta', transaction_time),
        paid_at = CASE WHEN paid_at IS NULL THEN now() ELSE paid_at END,
        updated_at = now()
      WHERE id = t.id;

      -- Lepaskan kuota jika masih berstatus 'reserved' agar tidak membebani kapasitas event
      IF res.id IS NOT NULL AND res.status = 'reserved' THEN
        UPDATE quota_reservations 
        SET status = 'expired', released_at = now(), release_reason = 'late_payment_expired' 
        WHERE id = res.id;
      END IF;

      -- Batalkan registrasi, catat pembayaran lunas, dan beri alert refund untuk admin
      UPDATE registrations SET 
        registration_status = 'cancelled', 
        payment_status = 'paid', 
        admin_note = 'Pembayaran diterima SETELAH batas waktu kadaluarsa (Telat bayar). Tiket TIDAK diterbitkan. Perlu refund manual ke peserta.',
        updated_at = now()
      WHERE id = reg.id;

      -- Log aktivitas sistem
      INSERT INTO activity_logs (actor_type, action, resource_type, resource_id, reason) 
      VALUES ('system', 'late_payment_no_ticket', 'registration', reg.id::text, t.order_id);

      -- Kirim notifikasi sistem ke akun peserta
      IF reg.user_id IS NOT NULL THEN
        INSERT INTO notifications (user_id, title, body, type, related_type, related_id) 
        VALUES (
          reg.user_id, 
          'Pembayaran Melebihi Batas Waktu', 
          'Pembayaran Anda berhasil kami terima, namun waktu pembayaran pendaftaran Anda telah kadaluarsa sehingga tiket tidak dapat diterbitkan. Silakan hubungi admin panitia untuk proses pengembalian dana (refund).', 
          'late_payment_expired', 
          'registration', 
          reg.id
        );
      END IF;

      UPDATE payment_notifications SET processing_status = 'processed_late_requires_refund' WHERE id = v_nid;
      RETURN jsonb_build_object('result', 'paid_late_expired_no_ticket', 'status', 'cancelled');

    ELSE
      -- -----------------------------------------------------------------------
      -- KASUS B: PEMBAYARAN VALID & TEPAT WAKTU (ON TIME) -> TERBITKAN TIKET
      -- -----------------------------------------------------------------------
      UPDATE transactions SET 
        transaction_status = 'paid', 
        provider_transaction_id = COALESCE(provider_transaction_id, v_tid), 
        fraud_status = v_fraud,
        payment_type = COALESCE(p_payload ->> 'payment_type', payment_type), 
        raw_status = v_status,
        transaction_time = COALESCE((p_payload ->> 'transaction_time')::timestamp at time zone 'Asia/Jakarta', transaction_time),
        paid_at = CASE WHEN paid_at IS NULL THEN now() ELSE paid_at END,
        updated_at = now()
      WHERE id = t.id;

      IF res.id IS NOT NULL THEN
        UPDATE quota_reservations SET status = 'confirmed', confirmed_at = now() WHERE id = res.id;
      END IF;

      UPDATE registrations SET 
        registration_status = 'confirmed', 
        payment_status = 'paid', 
        confirmed_at = COALESCE(confirmed_at, now()),
        updated_at = now()
      WHERE id = reg.id;

      -- Penerbitan E-Ticket resmi hanya terjadi jika pembayaran tepat waktu
      PERFORM _issue_tickets(reg.id);

      UPDATE payment_notifications SET processing_status = 'processed' WHERE id = v_nid;
      RETURN jsonb_build_object('result', 'processed', 'status', 'paid');
    END IF;

  ELSIF v_new IN ('failed', 'cancelled', 'expired') THEN
    UPDATE transactions SET 
      transaction_status = v_new, 
      provider_transaction_id = COALESCE(provider_transaction_id, v_tid), 
      fraud_status = v_fraud,
      payment_type = COALESCE(p_payload ->> 'payment_type', payment_type), 
      raw_status = v_status,
      transaction_time = COALESCE((p_payload ->> 'transaction_time')::timestamp at time zone 'Asia/Jakarta', transaction_time),
      updated_at = now()
    WHERE id = t.id;

    IF NOT EXISTS (SELECT 1 FROM transactions WHERE registration_id = reg.id AND transaction_status = 'paid') THEN
      UPDATE quota_reservations 
      SET status = CASE WHEN v_new = 'expired' THEN 'expired' ELSE 'released' END, released_at = now(), release_reason = 'payment_' || v_new
      WHERE registration_id = reg.id AND status = 'reserved';
      
      UPDATE registrations 
      SET payment_status = v_new, 
          registration_status = CASE WHEN registration_status IN ('draft', 'awaiting_payment') THEN (CASE WHEN v_new = 'expired' THEN 'expired' ELSE 'cancelled' END) ELSE registration_status END,
          updated_at = now()
      WHERE id = reg.id;
    END IF;

  ELSIF v_new IN ('refunded', 'partially_refunded') THEN
    UPDATE transactions SET 
      transaction_status = v_new, 
      provider_transaction_id = COALESCE(provider_transaction_id, v_tid), 
      fraud_status = v_fraud,
      raw_status = v_status,
      updated_at = now()
    WHERE id = t.id;

    UPDATE registrations SET payment_status = v_new, updated_at = now() WHERE id = reg.id;
    IF v_new = 'refunded' THEN
      UPDATE tickets SET status = 'void' WHERE registration_id = reg.id AND status = 'active';
      UPDATE quota_reservations SET status = 'released', released_at = now(), release_reason = 'refunded' WHERE registration_id = reg.id AND status = 'confirmed';
      UPDATE registrations SET registration_status = 'cancelled', updated_at = now() WHERE id = reg.id;
    END IF;
  END IF;

  UPDATE payment_notifications SET processing_status = 'processed' WHERE id = v_nid;
  RETURN jsonb_build_object('result', 'processed', 'status', v_new);
END $$;


-- 2. Update fungsi process_qris_mutation untuk mutasi uang masuk
CREATE OR REPLACE FUNCTION public.process_qris_mutation(
  p_amount NUMERIC,
  p_source TEXT DEFAULT 'forwarder',
  p_raw_text TEXT DEFAULT '',
  p_external_ref TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t transactions;
  reg registrations;
  res quota_reservations;
  v_target_amt NUMERIC := round(p_amount);
  v_is_late BOOLEAN := false;
BEGIN
  -- 1. Cari transaksi pending atau expired yang cocok dengan nominal (utamakan status pending)
  SELECT * INTO t 
  FROM transactions 
  WHERE round(gross_amount) = v_target_amt 
    AND transaction_status IN ('pending', 'expired')
  ORDER BY CASE WHEN transaction_status = 'pending' THEN 1 ELSE 2 END, created_at DESC 
  LIMIT 1 
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tidak ditemukan transaksi yang cocok dengan nominal tersebut');
  END IF;

  SELECT * INTO reg FROM registrations WHERE id = t.registration_id FOR UPDATE;
  SELECT * INTO res FROM quota_reservations WHERE registration_id = reg.id ORDER BY reserved_at DESC LIMIT 1 FOR UPDATE;

  -- 2. Validasi apakah pembayaran mutasi sudah kadaluarsa (telat bayar)
  v_is_late := (
    (t.expiry_time IS NOT NULL AND t.expiry_time < now())
    OR (res.id IS NOT NULL AND res.expires_at IS NOT NULL AND res.expires_at < now())
    OR (res.id IS NOT NULL AND res.status IN ('expired', 'released'))
    OR (reg.registration_status IN ('expired', 'cancelled'))
    OR (t.transaction_status = 'expired')
  );

  IF v_is_late THEN
    -- Kasus Pembayaran Telat: Catat uang masuk tapi JANGAN terbitkan tiket
    UPDATE transactions 
    SET transaction_status = 'paid', 
        paid_at = now(),
        payment_type = COALESCE(payment_type, p_source),
        provider_transaction_id = COALESCE(p_external_ref, provider_transaction_id),
        raw_status = 'mutation_late_expired',
        updated_at = now()
    WHERE id = t.id;

    -- Lepaskan kuota jika masih reserved agar kuota tidak tersangkut
    IF res.id IS NOT NULL AND res.status = 'reserved' THEN
      UPDATE quota_reservations 
      SET status = 'expired', released_at = now(), release_reason = 'late_payment_expired' 
      WHERE id = res.id;
    END IF;

    -- Batalkan registrasi, catat pembayaran lunas, dan beri alert refund untuk admin
    UPDATE registrations 
    SET payment_status = 'paid', 
        registration_status = 'cancelled',
        admin_note = 'Pembayaran QRIS mutasi diterima SETELAH batas waktu kadaluarsa (Telat bayar). Tiket TIDAK diterbitkan. Perlu refund manual ke peserta.',
        updated_at = now()
    WHERE id = reg.id;

    -- Catat di activity_logs
    INSERT INTO activity_logs (actor_type, action, resource_type, resource_id, reason, after_data)
    VALUES ('system', 'late_payment_no_ticket', 'transaction', t.id::text, p_source, jsonb_build_object('amount', v_target_amt, 'order_id', t.order_id));

    -- Kirim notifikasi sistem ke akun peserta
    IF reg.user_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, body, type, related_type, related_id) 
      VALUES (
        reg.user_id, 
        'Pembayaran Melebihi Batas Waktu', 
        'Pembayaran sebesar Rp ' || v_target_amt::text || ' berhasil diterima, namun sesi pembayaran pendaftaran Anda telah kadaluarsa sehingga tiket tidak dapat diterbitkan. Silakan hubungi admin panitia untuk proses pengembalian dana (refund).', 
        'late_payment_expired', 
        'registration', 
        reg.id
      );
    END IF;

    RETURN jsonb_build_object('success', true, 'late', true, 'order_id', t.order_id, 'registration_id', reg.id, 'amount', v_target_amt, 'message', 'Pembayaran diterima setelah batas waktu kadaluarsa. Tiket tidak diterbitkan. Perlu refund.');
  END IF;

  -- Kasus Tepat Waktu: Terbitkan tiket
  UPDATE transactions 
  SET transaction_status = 'paid', 
      paid_at = now(),
      payment_type = COALESCE(payment_type, p_source),
      provider_transaction_id = COALESCE(p_external_ref, provider_transaction_id),
      raw_status = 'mutation_settled',
      updated_at = now()
  WHERE id = t.id;

  IF res.id IS NOT NULL THEN
    UPDATE quota_reservations 
    SET status = 'confirmed', confirmed_at = now() 
    WHERE id = res.id;
  END IF;

  UPDATE registrations 
  SET payment_status = 'paid', 
      registration_status = 'confirmed', 
      confirmed_at = now(),
      updated_at = now()
  WHERE id = reg.id;

  PERFORM _issue_tickets(reg.id);

  INSERT INTO activity_logs (actor_type, action, resource_type, resource_id, reason, after_data)
  VALUES ('system', 'qris_mutation_settled', 'transaction', t.id::text, p_source, jsonb_build_object('amount', v_target_amt, 'order_id', t.order_id));

  RETURN jsonb_build_object('success', true, 'late', false, 'order_id', t.order_id, 'registration_id', reg.id, 'amount', v_target_amt, 'message', 'Pembayaran QRIS berhasil dan tiket telah diterbitkan.');
END $$;


-- 3. Update fungsi expire_reservations agar tabel transactions juga diupdate menjadi expired
CREATE OR REPLACE FUNCTION public.expire_reservations() 
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  WITH exp AS (
    SELECT qr.id, qr.registration_id 
    FROM quota_reservations qr 
    JOIN registrations r ON r.id = qr.registration_id
    WHERE qr.status = 'reserved' AND qr.expires_at < now()
      AND NOT EXISTS (
        SELECT 1 FROM transactions t 
        WHERE t.registration_id = r.id 
          AND (t.transaction_status = 'paid' OR (t.transaction_status = 'pending' AND COALESCE(t.expiry_time, qr.expires_at) > now() - interval '5 minutes'))
      )
    FOR UPDATE OF r, qr SKIP LOCKED
  ),
  upd_qr AS (
    UPDATE quota_reservations q 
    SET status = 'expired', released_at = now(), release_reason = 'reservation_expired' 
    FROM exp WHERE q.id = exp.id 
    RETURNING q.registration_id
  ),
  upd_reg AS (
    UPDATE registrations r 
    SET registration_status = 'expired', 
        payment_status = CASE WHEN r.payment_status = 'pending' THEN 'expired' ELSE r.payment_status END,
        updated_at = now()
    FROM upd_qr 
    WHERE r.id = upd_qr.registration_id AND r.registration_status IN ('draft', 'awaiting_payment') 
    RETURNING r.id
  ),
  upd_tx AS (
    UPDATE transactions t
    SET transaction_status = 'expired',
        updated_at = now()
    FROM upd_qr 
    WHERE t.registration_id = upd_qr.registration_id 
      AND t.transaction_status = 'pending'
  )
  SELECT count(*) INTO n FROM upd_qr;
  RETURN coalesce(n, 0);
END $$;
