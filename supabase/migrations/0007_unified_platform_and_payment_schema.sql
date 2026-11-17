-- ==============================================================================
-- 0007_unified_platform_and_payment_schema.sql
-- Integrasi Schema Multi-Event Platform & Fitur Pembayaran Payment
-- ==============================================================================

-- 1. Tambah kolom ekstensi pada tabel registrations jika belum ada
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS order_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS participant_name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS event_category TEXT,
  ADD COLUMN IF NOT EXISTS event_title TEXT,
  ADD COLUMN IF NOT EXISTS ticket_tier_id TEXT,
  ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS payment_type TEXT,
  ADD COLUMN IF NOT EXISTS midtrans_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS raw_response JSONB;

-- 2. Tambah kolom ekstensi pada tabel transactions untuk QRIS & kasir manual
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS base_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unique_code INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qris_string TEXT,
  ADD COLUMN IF NOT EXISTS qr_data_url TEXT,
  ADD COLUMN IF NOT EXISTS checkout_url TEXT,
  ADD COLUMN IF NOT EXISTS external_reference TEXT,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_notification JSONB;

-- 3. Tabel Orders & Payments (sinkronisasi sistem kasir ShopeePay)
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT UNIQUE NOT NULL,
  total_amount BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'expired')),
  registration_id UUID REFERENCES public.registrations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'ShopeePay QRIS',
  amount BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
  external_reference TEXT,
  verified_by UUID REFERENCES public.profiles(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Alokasi Kode Unik QRIS
CREATE OR REPLACE FUNCTION public.allocate_qris_unique_code(p_base_amount NUMERIC, p_window_minutes INT DEFAULT 15)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_used_codes INT[];
  v_candidate INT;
  v_attempts INT := 0;
BEGIN
  SELECT COALESCE(array_agg(unique_code), '{}') INTO v_used_codes
  FROM transactions
  WHERE base_amount = p_base_amount
    AND transaction_status = 'pending'
    AND unique_code > 0
    AND expiry_time > now();

  v_candidate := floor(random() * 899 + 100)::int;
  WHILE v_candidate = ANY(v_used_codes) AND v_attempts < 900 LOOP
    v_candidate := ((v_candidate + 1 - 100) % 900) + 100;
    v_attempts := v_attempts + 1;
  END LOOP;

  IF v_attempts >= 900 THEN
    RAISE EXCEPTION 'SLOT_KODE_UNIK_PENUH';
  END IF;

  RETURN jsonb_build_object(
    'base_amount', p_base_amount,
    'unique_code', v_candidate,
    'total_amount', p_base_amount + v_candidate,
    'expires_in_seconds', p_window_minutes * 60
  );
END $$;

-- 5. Penyelesaian Mutasi QRIS Otomatis
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
  v_target_amt NUMERIC := round(p_amount);
BEGIN
  SELECT * INTO t 
  FROM transactions 
  WHERE round(gross_amount) = v_target_amt 
    AND transaction_status = 'pending'
    AND expiry_time > now()
  ORDER BY created_at DESC 
  LIMIT 1 
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT * INTO reg 
    FROM registrations 
    WHERE round(COALESCE(total_amount, amount)) = v_target_amt 
      AND (payment_status = 'pending' OR status = 'pending')
      AND created_at > now() - interval '15 minutes'
    ORDER BY created_at DESC 
    LIMIT 1 
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'message', 'Tidak ditemukan transaksi pending dengan nominal tersebut');
    END IF;

    UPDATE registrations 
    SET payment_status = 'paid', status = 'paid', registration_status = 'confirmed', confirmed_at = now(),
        payment_type = COALESCE(payment_type, p_source),
        raw_response = jsonb_build_object('mutation_source', p_source, 'raw_text', p_raw_text, 'amount', p_amount, 'confirmed_at', now())
    WHERE id = reg.id;

    PERFORM _issue_tickets(reg.id);
    RETURN jsonb_build_object('success', true, 'order_id', reg.order_id, 'registration_id', reg.id, 'amount', v_target_amt);
  END IF;

  UPDATE transactions 
  SET transaction_status = 'paid', paid_at = now(),
      external_reference = COALESCE(p_external_ref, external_reference),
      payment_type = COALESCE(p_source, payment_type),
      raw_notification = jsonb_build_object('source', p_source, 'text', p_raw_text, 'received_at', now())
  WHERE id = t.id;

  SELECT * INTO reg FROM registrations WHERE id = t.registration_id FOR UPDATE;
  
  UPDATE quota_reservations 
  SET status = 'confirmed', confirmed_at = now() 
  WHERE registration_id = reg.id AND status = 'reserved';

  UPDATE registrations 
  SET payment_status = 'paid', status = 'paid', registration_status = 'confirmed', confirmed_at = now(),
      payment_type = COALESCE(payment_type, p_source)
  WHERE id = reg.id;

  PERFORM _issue_tickets(reg.id);

  INSERT INTO activity_logs (actor_type, action, resource_type, resource_id, reason, after_data)
  VALUES ('system', 'qris_mutation_settled', 'transaction', t.id::text, p_source, jsonb_build_object('amount', v_target_amt, 'order_id', t.order_id));

  RETURN jsonb_build_object('success', true, 'order_id', t.order_id, 'registration_id', reg.id, 'amount', v_target_amt);
END $$;

-- 6. Verifikasi Manual Kasir / Merchant
CREATE OR REPLACE FUNCTION public.verify_manual_payment(
  p_actor UUID,
  p_order_id TEXT,
  p_notes TEXT DEFAULT '',
  p_external_ref TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  reg registrations;
  t transactions;
BEGIN
  SELECT * INTO reg FROM registrations WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
  IF reg.payment_status = 'paid' OR reg.status = 'paid' THEN RAISE EXCEPTION 'ORDER_ALREADY_PAID'; END IF;

  SELECT * INTO t FROM transactions WHERE order_id = p_order_id FOR UPDATE;
  IF FOUND THEN
    UPDATE transactions 
    SET transaction_status = 'paid', paid_at = now(),
        verified_by = p_actor, verified_at = now(),
        external_reference = COALESCE(p_external_ref, external_reference)
    WHERE id = t.id;
  END IF;

  UPDATE quota_reservations 
  SET status = 'confirmed', confirmed_at = now() 
  WHERE registration_id = reg.id AND status = 'reserved';

  UPDATE registrations 
  SET payment_status = 'paid', status = 'paid', registration_status = 'confirmed', confirmed_at = now(),
      admin_note = p_notes
  WHERE id = reg.id;

  INSERT INTO public.payments (order_id, method, amount, status, external_reference, verified_by, verified_at)
  SELECT o.id, 'Manual Cashier Verification', reg.total_amount, 'paid', p_external_ref, p_actor, now()
  FROM orders o WHERE o.order_number = p_order_id;

  PERFORM _issue_tickets(reg.id);

  INSERT INTO activity_logs (actor_user_id, actor_type, action, resource_type, resource_id, reason)
  VALUES (p_actor, 'admin', 'manual_payment_verified', 'registration', reg.id::text, p_notes);

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', 'paid');
END $$;

-- 7. Grants
REVOKE EXECUTE ON FUNCTION public.allocate_qris_unique_code, public.process_qris_mutation, public.verify_manual_payment FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_qris_unique_code TO service_role;
GRANT EXECUTE ON FUNCTION public.process_qris_mutation TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_manual_payment TO service_role;
