-- ==============================================================================
-- UNIFIED DATABASE SCHEMA: MULTI-EVENT PLATFORM & PAYMENT SYSTEM
-- ==============================================================================
-- File: supabase/UNIFIED_FULL_SCHEMA.sql
-- Menggabungkan arsitektur enterprise Multi-Event Platform (antrean, kuota atomik,
-- RBAC, outbox RabbitMQ, formulir dinamis, tiket) dengan sistem pembayaran Payment
-- (Midtrans Snap, Webhook, QRIS Dinamis EMVCo Tag 54, Alokasi Kode Unik,
-- Mutasi Ingestion Forwarder Android, dan Verifikasi Manual Kasir).
-- Aman dijalankan langsung di Supabase SQL Editor.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 1. MIGRASI & ADAPTASI TABEL LAMA (JIKA ADA DARI PROJECT PAYMENT)
-- ==============================================================================
DO $$
BEGIN
  -- Jika tabel events sudah ada tapi kolom 'id' bertipe varchar/text (dari project payment lama):
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'id' AND data_type IN ('character varying', 'text')
  ) THEN
    -- Backup dan ubah nama sementara
    ALTER TABLE public.events RENAME TO events_legacy;
  END IF;
END $$;

-- ==============================================================================
-- 2. SISTEM PENGGUNA, PROFIL, DAN RBAC (AUTH INTEGRATION)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  phone TEXT,
  avatar_path TEXT,
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (name IN ('participant', 'admin', 'super_admin')),
  description TEXT
);

CREATE TABLE IF NOT EXISTS public.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Seed Data Roles & Permissions Dasar
INSERT INTO public.roles (name, description) VALUES
  ('participant', 'Peserta pendaftaran event'),
  ('admin', 'Pengelola event dan verifikasi tiket/pembayaran'),
  ('super_admin', 'Akses penuh ke seluruh sistem')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.permissions (code, description) VALUES
  ('events.manage', 'Membuat dan mengubah event'),
  ('orders.view', 'Melihat seluruh transaksi & pesanan'),
  ('orders.verify', 'Verifikasi pembayaran manual kasir'),
  ('tickets.checkin', 'Scan dan validasi tiket masuk'),
  ('system.settings', 'Mengubah konfigurasi sistem')
ON CONFLICT (code) DO NOTHING;

-- Sambungkan permissions ke role admin & super_admin
DO $$
DECLARE
  v_admin UUID;
  v_super UUID;
BEGIN
  SELECT id INTO v_admin FROM public.roles WHERE name = 'admin';
  SELECT id INTO v_super FROM public.roles WHERE name = 'super_admin';

  IF v_admin IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_admin, id FROM public.permissions WHERE code IN ('events.manage', 'orders.view', 'orders.verify', 'tickets.checkin')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_super IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_super, id FROM public.permissions
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ==============================================================================
-- 3. KATALOG EVENT & TIKET
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.event_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed Default Categories
INSERT INTO public.event_categories (name, slug, description, icon) VALUES
  ('Running', 'running', 'Lomba lari maraton, fun run, trail running', 'Footprints'),
  ('Konser', 'konser', 'Konser musik festival live band & orchestra', 'Music'),
  ('Festival', 'festival', 'Pameran budaya, seni, dan festival kuliner', 'Sparkles'),
  ('Workshop', 'workshop', 'Pelatihan intensif, seminar, dan conference teknologi', 'BookOpen')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES public.event_categories(id),
  organizer_name TEXT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  summary TEXT,
  description TEXT,
  poster_path TEXT,
  banner_path TEXT,
  poster_alt TEXT,
  event_type TEXT NOT NULL DEFAULT 'offline' CHECK (event_type IN ('offline', 'online', 'hybrid')),
  venue_name TEXT,
  address TEXT,
  online_url TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  registration_opens_at TIMESTAMPTZ NOT NULL,
  registration_closes_at TIMESTAMPTZ NOT NULL,
  total_quota INT NOT NULL CHECK (total_quota >= 0),
  max_per_user INT NOT NULL DEFAULT 1 CHECK (max_per_user > 0),
  allow_multiple_categories BOOLEAN NOT NULL DEFAULT false,
  requirements TEXT,
  faq JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta_title TEXT,
  meta_description TEXT,
  og_image_path TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'registration_closed', 'ongoing', 'completed', 'archived')),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at >= start_at),
  CHECK (registration_closes_at >= registration_opens_at)
);

CREATE TABLE IF NOT EXISTS public.ticket_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  quota INT NOT NULL CHECK (quota >= 0),
  sales_start_at TIMESTAMPTZ,
  sales_end_at TIMESTAMPTZ,
  max_per_user INT CHECK (max_per_user > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_form_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'textarea', 'number', 'email', 'tel', 'select', 'checkbox', 'date')),
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_required BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  validation_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (event_id, field_key)
);

-- Migrasi data dinamis jika ada events_legacy
DO $$
DECLARE
  rec RECORD;
  v_new_event_id UUID;
  v_cat_id UUID;
  v_tier RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_legacy') THEN
    FOR rec IN EXECUTE 'SELECT * FROM public.events_legacy' LOOP
      SELECT id INTO v_cat_id FROM public.event_categories WHERE lower(name) = lower(rec.category) LIMIT 1;
      
      INSERT INTO public.events (
        title, slug, organizer_name, venue_name, total_quota, status,
        poster_path, description, start_at, end_at, registration_opens_at, registration_closes_at, category_id
      ) VALUES (
        rec.title, rec.slug, rec.organizer, rec.location, COALESCE(rec.quota, 1000),
        CASE WHEN rec.status = 'open' THEN 'published' ELSE 'draft' END,
        rec.image_url, rec.description,
        now() + interval '30 days', now() + interval '30 days 4 hours',
        now() - interval '1 day', now() + interval '29 days', v_cat_id
      )
      ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
      RETURNING id INTO v_new_event_id;

      -- Migrasikan ticket_tiers JSONB menjadi baris ticket_categories
      IF rec.ticket_tiers IS NOT NULL AND jsonb_typeof(rec.ticket_tiers::jsonb) = 'array' THEN
        FOR v_tier IN SELECT * FROM jsonb_to_recordset(rec.ticket_tiers::jsonb) AS x(name text, price numeric, description text) LOOP
          INSERT INTO public.ticket_categories (event_id, name, price, quota, description)
          VALUES (v_new_event_id, v_tier.name, COALESCE(v_tier.price, 0), 500, v_tier.description)
          ON CONFLICT DO NOTHING;
        END LOOP;
      END IF;
    END LOOP;
  END IF;
END $$;

-- ==============================================================================
-- 4. SISTEM ANTREAN & RESERVASI KUOTA (HIGH CONCURRENCY)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.queue_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key TEXT NOT NULL UNIQUE,           -- user_id:idempotency_key
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  event_id UUID NOT NULL REFERENCES public.events(id),
  ticket_category_id UUID NOT NULL REFERENCES public.ticket_categories(id),
  quantity INT NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'accepted', 'rejected', 'failed', 'expired')),
  message_id UUID UNIQUE DEFAULT gen_random_uuid(),
  retry_count INT NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS queue_one_active_per_user_event 
  ON public.queue_requests (user_id, event_id) 
  WHERE status IN ('queued', 'processing');

-- ==============================================================================
-- 5. PENDAFTARAN & RESERVASI (TERINTEGRASI DENGAN FIELD PAYMENT)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_code TEXT UNIQUE,
  user_id UUID REFERENCES public.profiles(id),
  event_id UUID REFERENCES public.events(id),
  ticket_category_id UUID REFERENCES public.ticket_categories(id),
  queue_request_id UUID UNIQUE REFERENCES public.queue_requests(id),
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  registration_status TEXT NOT NULL DEFAULT 'draft' CHECK (registration_status IN ('draft', 'awaiting_payment', 'confirmed', 'cancelled', 'expired')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'expired', 'cancelled', 'refunded', 'partially_refunded')),
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  -- Kolom Integrasi Sistem Payment (Dukungan QRIS, Midtrans & Legacy Payment)
  order_id TEXT UNIQUE,
  participant_name TEXT,
  email TEXT,
  phone TEXT,
  event_category TEXT,
  event_title TEXT,
  ticket_tier_id TEXT,
  amount NUMERIC(12, 2),
  payment_type TEXT,
  midtrans_transaction_id TEXT,
  raw_response JSONB
);

-- Pastikan semua kolom ekstensi ada meskipun tabel registrations sudah pernah dibuat sebelumnya
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS registration_code TEXT,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES public.events(id),
  ADD COLUMN IF NOT EXISTS ticket_category_id UUID REFERENCES public.ticket_categories(id),
  ADD COLUMN IF NOT EXISTS queue_request_id UUID,
  ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS registration_status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS admin_note TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS order_id TEXT,
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

-- Buat indeks untuk performa pencarian
CREATE INDEX IF NOT EXISTS idx_registrations_order_id ON public.registrations (order_id);
CREATE INDEX IF NOT EXISTS idx_registrations_user_id ON public.registrations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registrations_event_id ON public.registrations (event_id, registration_status);
CREATE INDEX IF NOT EXISTS idx_registrations_status_amount ON public.registrations (payment_status, total_amount, created_at DESC);

-- Adaptasi data registrasi lama yang sudah ada di Supabase
DO $$
BEGIN
  EXECUTE '
    UPDATE public.registrations 
    SET 
      registration_code = COALESCE(registration_code, order_id, ''REG-'' || upper(substr(id::text, 1, 8))),
      total_amount = CASE WHEN total_amount = 0 AND amount IS NOT NULL THEN amount ELSE total_amount END,
      subtotal = CASE WHEN subtotal = 0 AND amount IS NOT NULL THEN amount ELSE subtotal END,
      payment_status = CASE 
        WHEN status IS NOT NULL AND status <> ''pending'' THEN status 
        ELSE COALESCE(payment_status, ''pending'')
      END,
      status = CASE 
        WHEN payment_status IS NOT NULL AND payment_status <> ''pending'' THEN payment_status 
        ELSE COALESCE(status, ''pending'')
      END,
      registration_status = CASE 
        WHEN status = ''paid'' OR payment_status = ''paid'' THEN ''confirmed''
        WHEN status IN (''failed'', ''expired'', ''cancelled'') THEN status
        WHEN payment_status IN (''failed'', ''expired'', ''cancelled'') THEN payment_status
        ELSE COALESCE(registration_status, ''awaiting_payment'')
      END,
      confirmed_at = CASE 
        WHEN (status = ''paid'' OR payment_status = ''paid'') AND confirmed_at IS NULL THEN updated_at 
        ELSE confirmed_at 
      END
    WHERE registration_code IS NULL OR total_amount = 0 OR payment_status IS NULL
  ';
END $$;

-- Trigger Sinkronisasi Status (menjamin keselarasan query lama dan baru)
CREATE OR REPLACE FUNCTION public.sync_registration_statuses()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    NEW.status = NEW.payment_status;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.payment_status = NEW.status;
  END IF;

  IF NEW.payment_status = 'paid' OR NEW.status = 'paid' THEN
    NEW.registration_status = 'confirmed';
    NEW.confirmed_at = COALESCE(NEW.confirmed_at, now());
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_registration_statuses ON public.registrations;
CREATE TRIGGER trg_sync_registration_statuses
  BEFORE INSERT OR UPDATE ON public.registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_registration_statuses();

CREATE TABLE IF NOT EXISTS public.registration_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  field_label_snapshot TEXT NOT NULL,
  answer JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (registration_id, field_key)
);

CREATE TABLE IF NOT EXISTS public.quota_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id),
  ticket_category_id UUID NOT NULL REFERENCES public.ticket_categories(id),
  quantity INT NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'confirmed', 'released', 'expired')),
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  release_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_quota_reservations_status_expiry 
  ON public.quota_reservations (event_id, status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS one_live_reservation_per_registration 
  ON public.quota_reservations (registration_id) 
  WHERE status IN ('reserved', 'confirmed');

-- ==============================================================================
-- 6. TRANSAKSI PEMBAYARAN: MIDTRANS & QRIS MANDIRI / QRISGATE
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'midtrans', -- 'midtrans', 'qris_self_hosted', 'qris_shopeepay', 'qrisgate', 'manual'
  provider_transaction_id TEXT,
  base_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  unique_code INT NOT NULL DEFAULT 0,
  gross_amount NUMERIC(12, 2) NOT NULL CHECK (gross_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'IDR',
  payment_type TEXT,
  -- Midtrans Snap Details
  snap_token TEXT,
  snap_redirect_url TEXT,
  -- QRIS Dinamis & Gateway Details
  qris_string TEXT,
  qr_data_url TEXT,
  checkout_url TEXT,
  external_reference TEXT,
  -- Verifikasi Manual Kasir / Merchant
  verified_by UUID REFERENCES public.profiles(id),
  verified_at TIMESTAMPTZ,
  -- Status Pelacakan
  transaction_status TEXT NOT NULL DEFAULT 'pending' CHECK (transaction_status IN ('pending', 'paid', 'failed', 'expired', 'cancelled', 'refunded', 'partially_refunded')),
  fraud_status TEXT,
  transaction_time TIMESTAMPTZ,
  expiry_time TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  raw_status TEXT,
  raw_notification JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_order_id ON public.transactions (order_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status_amount ON public.transactions (transaction_status, gross_amount, expiry_time);

CREATE TABLE IF NOT EXISTS public.payment_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES public.transactions(id),
  provider TEXT NOT NULL DEFAULT 'midtrans',
  notification_key TEXT UNIQUE,
  order_id TEXT,
  provider_transaction_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signature_valid BOOLEAN NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received',
  status_code TEXT,
  payload_redacted JSONB,
  processing_error TEXT
);

-- ==============================================================================
-- 7. TABEL ORDERS & PAYMENTS (PENJELASAN2.md / KASIR SHOPEEPAY INTEGRASI)
-- ==============================================================================

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

-- ==============================================================================
-- 8. TIKET & KONTEN PLATFORM (BLOG, BANNER, AUDIT)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  ticket_code TEXT NOT NULL UNIQUE,
  attendee_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'void')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_in_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.blogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  excerpt TEXT,
  content TEXT NOT NULL DEFAULT '',
  thumbnail_path TEXT,
  category TEXT,
  author_id UUID REFERENCES public.profiles(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TIMESTAMPTZ,
  meta_title TEXT,
  meta_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.partnerships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  organization_type TEXT,
  website TEXT,
  description TEXT,
  attachment_path TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'approved', 'rejected')),
  internal_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'replied', 'closed')),
  internal_note TEXT,
  assigned_admin_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  image_path TEXT,
  mobile_image_path TEXT,
  alt_text TEXT,
  cta_label TEXT,
  cta_url TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  type TEXT NOT NULL DEFAULT 'info',
  related_type TEXT,
  related_id UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id, read_at) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID,
  actor_type TEXT NOT NULL DEFAULT 'admin',
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  before_data JSONB,
  after_data JSONB,
  reason TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.outbox_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'publishing', 'published')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_messages_poll ON public.outbox_messages (status, available_at);

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.app_settings (key, value) VALUES
  ('reservation_minutes', '30'::jsonb),
  ('qris_expiration_minutes', '15'::jsonb),
  ('maintenance_mode', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
  worker_id TEXT PRIMARY KEY,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  stats JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ==============================================================================
-- 9. TRIGGERS & PROFIL OTOMATIS
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at() 
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN 
  NEW.updated_at = now(); 
  RETURN NEW; 
END $$;

DO $$ 
DECLARE 
  t TEXT; 
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'event_categories', 'events', 'ticket_categories', 
    'queue_requests', 'registrations', 'transactions', 'orders', 'payments',
    'blogs', 'partnerships', 'contact_messages', 'banners'
  ] LOOP 
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON public.%I; CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t, t); 
  END LOOP;
END $$;

-- activity_logs bersifat append-only (anti-tamper)
CREATE OR REPLACE FUNCTION public.block_log_mutation() 
RETURNS TRIGGER LANGUAGE plpgsql AS $$ 
BEGIN 
  RAISE EXCEPTION 'activity_logs bersifat append-only'; 
END $$;

DROP TRIGGER IF EXISTS activity_logs_immutable ON public.activity_logs;
CREATE TRIGGER activity_logs_immutable BEFORE UPDATE OR DELETE ON public.activity_logs FOR EACH ROW EXECUTE FUNCTION public.block_log_mutation();

-- Pembuatan profil otomatis dari Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone)
  VALUES (
    NEW.id, 
    NEW.email, 
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), 
    NEW.raw_user_meta_data->>'phone'
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  INSERT INTO public.user_roles (user_id, role_id) 
  SELECT NEW.id, id FROM public.roles WHERE name = 'participant'
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.sync_profile_email() 
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN 
  UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id; 
  RETURN NEW; 
END $$;

DROP TRIGGER IF EXISTS on_auth_user_email ON auth.users;
CREATE TRIGGER on_auth_user_email AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION public.sync_profile_email();

-- ==============================================================================
-- 10. REAL-TIME VIEWS UNTUK KATALOG & KETERSEDIAAN TIKET
-- ==============================================================================

CREATE OR REPLACE VIEW public.event_listing AS
SELECT 
  e.id, e.slug, e.title, e.summary, e.poster_path, e.poster_alt, e.event_type, e.venue_name, e.address,
  e.start_at, e.end_at, e.registration_opens_at, e.registration_closes_at, e.status, e.total_quota, e.max_per_user,
  c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
  (SELECT min(tc.price) FROM public.ticket_categories tc WHERE tc.event_id = e.id AND tc.is_active) AS min_price,
  GREATEST(e.total_quota - COALESCE((
    SELECT sum(qr.quantity) FROM public.quota_reservations qr
    WHERE qr.event_id = e.id AND (qr.status = 'confirmed' OR (qr.status = 'reserved' AND qr.expires_at > now()))
  ), 0), 0) AS available,
  e.allow_multiple_categories
FROM public.events e 
LEFT JOIN public.event_categories c ON c.id = e.category_id
WHERE e.status IN ('published', 'registration_closed', 'ongoing', 'completed');

CREATE OR REPLACE VIEW public.ticket_availability AS
SELECT 
  tc.id AS ticket_category_id, 
  tc.event_id,
  GREATEST(LEAST(
    tc.quota - COALESCE((
      SELECT sum(qr.quantity) FROM public.quota_reservations qr
      WHERE qr.ticket_category_id = tc.id AND (qr.status = 'confirmed' OR (qr.status = 'reserved' AND qr.expires_at > now()))
    ), 0),
    e.total_quota - COALESCE((
      SELECT sum(qr.quantity) FROM public.quota_reservations qr
      WHERE qr.event_id = e.id AND (qr.status = 'confirmed' OR (qr.status = 'reserved' AND qr.expires_at > now()))
    ), 0)
  ), 0) AS available
FROM public.ticket_categories tc 
JOIN public.events e ON e.id = tc.event_id
WHERE tc.is_active AND e.status IN ('published', 'registration_closed', 'ongoing');

-- ==============================================================================
-- 11. RPC FUNCTIONS: ANTREAN, KUOTA, & PEMBAYARAN ATOMIK
-- ==============================================================================

-- Hak Akses User Aktif
CREATE OR REPLACE FUNCTION public.my_access() 
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'roles', COALESCE((SELECT jsonb_agg(r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid()), '[]'::jsonb),
    'permissions', COALESCE((SELECT jsonb_agg(DISTINCT p.code) FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = auth.uid()), '[]'::jsonb));
$$;

-- Masuk Antrean Pendaftaran
CREATE OR REPLACE FUNCTION public.request_registration_queue(p_user UUID, p_event UUID, p_category UUID, p_qty INT, p_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE 
  v_hash TEXT; 
  v_key TEXT; 
  q queue_requests; 
  ev events; 
  tc ticket_categories; 
  v_user_taken INT;
BEGIN
  v_key := p_user::text || ':' || p_key;
  v_hash := encode(sha256(convert_to(p_event::text || p_category::text || p_qty::text, 'UTF8')), 'hex');
  
  SELECT * INTO q FROM queue_requests WHERE request_key = v_key;
  IF FOUND THEN
    IF q.payload_hash <> v_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN jsonb_build_object('queue_request_id', q.id, 'status', q.status, 'replayed', true);
  END IF;

  IF (SELECT account_status FROM profiles WHERE id = p_user) IS DISTINCT FROM 'active' THEN 
    RAISE EXCEPTION 'ACCOUNT_SUSPENDED'; 
  END IF;

  SELECT * INTO ev FROM events WHERE id = p_event AND status = 'published';
  IF NOT FOUND OR now() < ev.registration_opens_at OR now() > ev.registration_closes_at THEN 
    RAISE EXCEPTION 'REGISTRATION_CLOSED'; 
  END IF;

  SELECT * INTO tc FROM ticket_categories WHERE id = p_category AND event_id = p_event AND is_active;
  IF NOT FOUND OR (tc.sales_start_at IS NOT NULL AND now() < tc.sales_start_at) OR (tc.sales_end_at IS NOT NULL AND now() > tc.sales_end_at) THEN 
    RAISE EXCEPTION 'INVALID_CATEGORY'; 
  END IF;

  IF NOT COALESCE(ev.allow_multiple_categories, false) THEN
    IF EXISTS (
      SELECT 1 FROM registrations
      WHERE user_id = p_user AND event_id = p_event AND ticket_category_id <> p_category
        AND registration_status IN ('draft', 'awaiting_payment', 'confirmed')
    ) OR EXISTS (
      SELECT 1 FROM queue_requests
      WHERE user_id = p_user AND event_id = p_event AND ticket_category_id <> p_category
        AND status IN ('queued', 'processing')
    ) THEN
      RAISE EXCEPTION 'CATEGORY_LIMIT_REACHED';
    END IF;
  END IF;

  SELECT * INTO q FROM queue_requests WHERE user_id = p_user AND event_id = p_event AND status IN ('queued', 'processing');
  IF FOUND THEN 
    RETURN jsonb_build_object('queue_request_id', q.id, 'status', q.status, 'replayed', true); 
  END IF;

  SELECT COALESCE(sum(quantity), 0) INTO v_user_taken 
  FROM registrations 
  WHERE user_id = p_user AND event_id = p_event AND registration_status IN ('draft', 'awaiting_payment', 'confirmed');
  
  IF v_user_taken + p_qty > ev.max_per_user THEN 
    RAISE EXCEPTION 'USER_LIMIT'; 
  END IF;

  BEGIN
    INSERT INTO queue_requests (request_key, idempotency_key, payload_hash, user_id, event_id, ticket_category_id, quantity)
    VALUES (v_key, p_key, v_hash, p_user, p_event, p_category, p_qty) RETURNING * INTO q;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO q FROM queue_requests WHERE request_key = v_key OR (user_id = p_user AND event_id = p_event AND status IN ('queued', 'processing')) LIMIT 1;
    RETURN jsonb_build_object('queue_request_id', q.id, 'status', q.status, 'replayed', true);
  END;

  INSERT INTO outbox_messages (aggregate_type, aggregate_id, event_type, payload) 
  VALUES ('queue_request', q.id, 'registration.requested',
    jsonb_build_object('message_id', q.message_id, 'event_type', 'registration.requested', 'schema_version', 1, 'occurred_at', now(), 'correlation_id', gen_random_uuid(),
      'data', jsonb_build_object('queue_request_id', q.id, 'user_id', p_user, 'event_id', p_event, 'ticket_category_id', p_category, 'quantity', p_qty, 'idempotency_key', p_key)));
  
  RETURN jsonb_build_object('queue_request_id', q.id, 'status', q.status, 'replayed', false);
END $$;

CREATE OR REPLACE FUNCTION public._reject_queue(p_id UUID, p_code TEXT) 
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q queue_requests;
BEGIN
  UPDATE queue_requests SET status = 'rejected', error_code = p_code, processed_at = now() WHERE id = p_id RETURNING * INTO q;
  INSERT INTO notifications (user_id, title, body, type, related_type, related_id)
  VALUES (q.user_id, 'Pendaftaran belum dapat diproses',
          CASE p_code 
            WHEN 'QUOTA_FULL' THEN 'Kuota sudah penuh.' 
            WHEN 'USER_LIMIT' THEN 'Batas pendaftaran per akun tercapai.' 
            WHEN 'CATEGORY_LIMIT_REACHED' THEN 'Akun Anda sudah memiliki pendaftaran di kategori lain.'
            ELSE 'Pendaftaran event sudah ditutup.' 
          END,
          'queue_rejected', 'queue_request', q.id);
  RETURN jsonb_build_object('status', 'rejected', 'error_code', p_code);
END $$;

-- Reservasi Kuota Secara Atomik (Lock Event & Kategori Tiket)
CREATE OR REPLACE FUNCTION public.reserve_quota(p_queue_request_id UUID) 
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE 
  q queue_requests; 
  ev events; 
  tc ticket_categories; 
  ev_taken INT; 
  tc_taken INT; 
  user_taken INT; 
  reg registrations; 
  v_minutes INT;
BEGIN
  SELECT * INTO q FROM queue_requests WHERE id = p_queue_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_REQUEST_NOT_FOUND'; END IF;
  
  IF q.status IN ('accepted', 'rejected', 'failed', 'expired') THEN
    RETURN jsonb_build_object('status', q.status, 'error_code', q.error_code, 'registration_id', (SELECT id FROM registrations WHERE queue_request_id = q.id), 'replayed', true);
  END IF;

  UPDATE queue_requests SET status = 'processing', processing_started_at = COALESCE(processing_started_at, now()) WHERE id = q.id;
  SELECT * INTO ev FROM events WHERE id = q.event_id FOR UPDATE;
  SELECT * INTO tc FROM ticket_categories WHERE id = q.ticket_category_id FOR UPDATE;

  IF ev.status <> 'published' OR now() < ev.registration_opens_at OR now() > ev.registration_closes_at OR NOT tc.is_active THEN 
    RETURN _reject_queue(q.id, 'REGISTRATION_CLOSED'); 
  END IF;

  IF NOT COALESCE(ev.allow_multiple_categories, false) THEN
    IF EXISTS (
      SELECT 1 FROM registrations
      WHERE user_id = q.user_id AND event_id = ev.id AND ticket_category_id <> tc.id
        AND registration_status IN ('draft', 'awaiting_payment', 'confirmed')
    ) THEN
      RETURN _reject_queue(q.id, 'CATEGORY_LIMIT_REACHED');
    END IF;
  END IF;

  SELECT COALESCE(sum(quantity), 0) INTO ev_taken FROM quota_reservations 
  WHERE event_id = ev.id AND (status = 'confirmed' OR (status = 'reserved' AND expires_at > now()));
  
  SELECT COALESCE(sum(quantity), 0) INTO tc_taken FROM quota_reservations 
  WHERE ticket_category_id = tc.id AND (status = 'confirmed' OR (status = 'reserved' AND expires_at > now()));
  
  SELECT COALESCE(sum(quantity), 0) INTO user_taken FROM registrations 
  WHERE user_id = q.user_id AND event_id = ev.id AND registration_status IN ('draft', 'awaiting_payment', 'confirmed');
  
  IF user_taken + q.quantity > ev.max_per_user THEN 
    RETURN _reject_queue(q.id, 'USER_LIMIT'); 
  END IF;

  IF ev.total_quota - ev_taken < q.quantity OR tc.quota - tc_taken < q.quantity THEN 
    RETURN _reject_queue(q.id, 'QUOTA_FULL'); 
  END IF;

  SELECT COALESCE((value #>> '{}')::int, 30) INTO v_minutes FROM app_settings WHERE key = 'reservation_minutes';

  INSERT INTO registrations (
    registration_code, user_id, event_id, ticket_category_id, queue_request_id, 
    quantity, subtotal, total_amount, participant_name, email, phone, event_category, event_title
  )
  VALUES (
    'REG-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)), 
    q.user_id, ev.id, tc.id, q.id, q.quantity, tc.price * q.quantity, tc.price * q.quantity,
    (SELECT full_name FROM profiles WHERE id = q.user_id),
    (SELECT email FROM profiles WHERE id = q.user_id),
    (SELECT phone FROM profiles WHERE id = q.user_id),
    tc.name, ev.title
  )
  RETURNING * INTO reg;

  INSERT INTO quota_reservations (registration_id, event_id, ticket_category_id, quantity, expires_at)
  VALUES (reg.id, ev.id, tc.id, q.quantity, now() + make_interval(mins => COALESCE(v_minutes, 30)));

  UPDATE queue_requests SET status = 'accepted', processed_at = now() WHERE id = q.id;

  INSERT INTO notifications (user_id, title, body, type, related_type, related_id)
  VALUES (q.user_id, 'Kuota berhasil diamankan', 'Lengkapi formulir sebelum batas waktu reservasi berakhir.', 'queue_accepted', 'registration', reg.id);

  RETURN jsonb_build_object('status', 'accepted', 'registration_id', reg.id);
END $$;

-- Penerbitan Tiket Otomatis
CREATE OR REPLACE FUNCTION public._issue_tickets(p_registration UUID) 
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE 
  reg registrations; 
  v_name TEXT;
BEGIN
  SELECT * INTO reg FROM registrations WHERE id = p_registration;
  IF EXISTS (SELECT 1 FROM tickets WHERE registration_id = reg.id) THEN RETURN; END IF;
  
  v_name := COALESCE(reg.participant_name, (SELECT full_name FROM profiles WHERE id = reg.user_id), 'Peserta');
  
  INSERT INTO tickets (registration_id, ticket_code, attendee_name)
  SELECT reg.id, 'TKT-' || upper(substr(md5(random()::text || clock_timestamp()::text || g::text), 1, 10)), v_name 
  FROM generate_series(1, reg.quantity) g;

  IF reg.user_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, title, body, type, related_type, related_id)
    VALUES (reg.user_id, 'Pendaftaran terkonfirmasi', 'Tiket Anda sudah terbit dan siap digunakan.', 'registration_confirmed', 'registration', reg.id);
  END IF;
END $$;

-- Penyerahan Formulir Registrasi
CREATE OR REPLACE FUNCTION public.submit_registration_answers(p_user UUID, p_registration UUID, p_answers JSONB) 
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE 
  reg registrations; 
  res quota_reservations; 
  f RECORD;
  k TEXT;
BEGIN
  SELECT * INTO reg FROM registrations WHERE id = p_registration AND (user_id = p_user OR p_user IS NULL) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF reg.registration_status NOT IN ('draft', 'awaiting_payment') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  
  SELECT * INTO res FROM quota_reservations WHERE registration_id = reg.id AND status = 'reserved' AND expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_EXPIRED'; END IF;

  -- Simpan jawaban formulir standar dan dinamis ke registration_answers
  FOR k IN SELECT jsonb_object_keys(p_answers) LOOP
    INSERT INTO registration_answers (registration_id, field_key, field_label_snapshot, answer)
    VALUES (
      reg.id, 
      k, 
      CASE k
        WHEN 'full_name' THEN 'Nama Lengkap (Sesuai KTP/ID)'
        WHEN 'phone' THEN 'Nomor WhatsApp / HP'
        WHEN 'jersey_size' THEN 'Ukuran Baju / Size Jersey'
        WHEN 'emergency_name' THEN 'Nama Kontak Darurat'
        WHEN 'emergency_phone' THEN 'Nomor Telepon Kontak Darurat'
        ELSE COALESCE((SELECT label FROM event_form_fields WHERE event_id = reg.event_id AND field_key = k LIMIT 1), k)
      END,
      p_answers -> k
    )
    ON CONFLICT (registration_id, field_key) DO UPDATE SET answer = EXCLUDED.answer, field_label_snapshot = EXCLUDED.field_label_snapshot;
  END LOOP;

  -- Jika event gratis (Rp 0), langsung konfirmasi
  IF reg.total_amount = 0 THEN
    UPDATE quota_reservations SET status = 'confirmed', confirmed_at = now() WHERE id = res.id;
    UPDATE registrations SET registration_status = 'confirmed', payment_status = 'paid', confirmed_at = now(), updated_at = now() WHERE id = reg.id;
    PERFORM _issue_tickets(reg.id);
    RETURN jsonb_build_object('next', 'status');
  END IF;

  UPDATE registrations SET registration_status = 'awaiting_payment', updated_at = now() WHERE id = reg.id;
  RETURN jsonb_build_object('next', 'payment');
END $$;

-- Persiapan Transaksi Pembayaran (Midtrans / QRIS)
CREATE OR REPLACE FUNCTION public.prepare_payment(p_user UUID, p_registration UUID) 
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE 
  reg registrations; 
  res quota_reservations; 
  tc ticket_categories; 
  t transactions; 
  v_amount NUMERIC; 
  v_order TEXT;
BEGIN
  SELECT * INTO reg FROM registrations WHERE id = p_registration AND (user_id = p_user OR p_user IS NULL) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF reg.registration_status <> 'awaiting_payment' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  
  SELECT * INTO res FROM quota_reservations WHERE registration_id = reg.id AND status = 'reserved' AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_EXPIRED'; END IF;

  IF reg.ticket_category_id IS NOT NULL THEN
    SELECT * INTO tc FROM ticket_categories WHERE id = reg.ticket_category_id;
    v_amount := tc.price * reg.quantity;
  ELSE
    v_amount := COALESCE(reg.total_amount, 0);
  END IF;

  SELECT * INTO t FROM transactions WHERE registration_id = reg.id AND transaction_status = 'pending' FOR UPDATE;
  IF FOUND THEN
    IF t.snap_token IS NOT NULL OR t.raw_status IS NOT NULL THEN
      RETURN jsonb_build_object('order_id', t.order_id, 'amount', t.gross_amount, 'snap_token', t.snap_token, 'redirect_url', t.snap_redirect_url, 'expires_at', res.expires_at, 'reused', true);
    END IF;
    UPDATE transactions SET transaction_status = 'cancelled', raw_status = 'superseded_no_token', updated_at = now() WHERE id = t.id;
  END IF;

  v_order := 'EVT-' || upper(substr(replace(reg.id::text, '-', ''), 1, 10)) || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  
  INSERT INTO transactions (registration_id, order_id, gross_amount, expiry_time) 
  VALUES (reg.id, v_order, v_amount, res.expires_at);
  
  UPDATE registrations SET payment_status = 'pending', total_amount = v_amount, updated_at = now() WHERE id = reg.id;
  
  RETURN jsonb_build_object('order_id', v_order, 'amount', v_amount, 'expires_at', res.expires_at, 'reused', false);
END $$;

CREATE OR REPLACE FUNCTION public.attach_snap(p_order_id TEXT, p_token TEXT, p_redirect TEXT) 
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE transactions SET snap_token = p_token, snap_redirect_url = p_redirect WHERE order_id = p_order_id AND transaction_status = 'pending';
$$;

-- ==============================================================================
-- 12. RPC EKSTENSI: SISTEM QRIS MANDIRI, KODE UNIK & VERIFIKASI KASIR
-- ==============================================================================

-- Alokasi Kode Unik 3 Digit (Anti Bentrok Transfer Nominal)
CREATE OR REPLACE FUNCTION public.allocate_qris_unique_code(p_base_amount NUMERIC, p_window_minutes INT DEFAULT 15)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_used_codes INT[];
  v_candidate INT;
  v_attempts INT := 0;
BEGIN
  -- Ambil semua kode unik yang saat ini sedang aktif (pending < 15 menit) pada nominal dasar yang sama
  SELECT COALESCE(array_agg(unique_code), '{}') INTO v_used_codes
  FROM transactions
  WHERE base_amount = p_base_amount
    AND transaction_status = 'pending'
    AND unique_code > 0
    AND expiry_time > now();

  -- Pilih angka acak 100 - 999
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

-- Penyelesaian Mutasi QRIS Otomatis (Dari Android Forwarder / QRISGate)
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
  -- Cari transaksi pending atau expired yang cocok dengan nominal (utamakan pending)
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

  -- Validasi apakah pembayaran mutasi sudah kadaluarsa
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

    IF res.id IS NOT NULL AND res.status = 'reserved' THEN
      UPDATE quota_reservations 
      SET status = 'expired', released_at = now(), release_reason = 'late_payment_expired' 
      WHERE id = res.id;
    END IF;

    UPDATE registrations 
    SET payment_status = 'paid', 
        registration_status = 'cancelled',
        admin_note = 'Pembayaran QRIS mutasi diterima SETELAH batas waktu kadaluarsa (Telat bayar). Tiket TIDAK diterbitkan. Perlu refund manual ke peserta.',
        updated_at = now()
    WHERE id = reg.id;

    INSERT INTO activity_logs (actor_type, action, resource_type, resource_id, reason, after_data)
    VALUES ('system', 'late_payment_no_ticket', 'transaction', t.id::text, p_source, jsonb_build_object('amount', v_target_amt, 'order_id', t.order_id));

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

-- Verifikasi Manual Kasir / Admin (Dari Layar Shopee Partner / Bukti Transfer)
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
  SELECT * INTO t FROM transactions WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;

  SELECT * INTO reg FROM registrations WHERE id = t.registration_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REGISTRATION_NOT_FOUND'; END IF;
  IF reg.payment_status = 'paid' THEN RAISE EXCEPTION 'ORDER_ALREADY_PAID'; END IF;

  UPDATE transactions 
  SET transaction_status = 'paid', paid_at = now(), updated_at = now()
  WHERE id = t.id;

  UPDATE quota_reservations 
  SET status = 'confirmed', confirmed_at = now() 
  WHERE registration_id = reg.id AND status = 'reserved';

  UPDATE registrations 
  SET payment_status = 'paid', registration_status = 'confirmed', confirmed_at = now(),
      admin_note = p_notes, updated_at = now()
  WHERE id = reg.id;

  PERFORM _issue_tickets(reg.id);

  INSERT INTO activity_logs (actor_user_id, actor_type, action, resource_type, resource_id, reason)
  VALUES (p_actor, 'admin', 'manual_payment_verified', 'registration', reg.id::text, p_notes);

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', 'paid');
END $$;

-- ==============================================================================
-- 13. PEMROSESAN WEBHOOK MIDTRANS
-- ==============================================================================

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
    -- 5. ATAU status transaksi awal sebelum notifikasi sudah 'expired'
    v_is_late := (
      (t.expiry_time IS NOT NULL AND t.expiry_time < now())
      OR (res.id IS NOT NULL AND res.expires_at IS NOT NULL AND res.expires_at < now())
      OR (res.id IS NOT NULL AND res.status IN ('expired', 'released'))
      OR (reg.registration_status IN ('expired', 'cancelled'))
      OR (t.transaction_status = 'expired')
    );

    IF v_is_late THEN
      -- -----------------------------------------------------------------------
      -- KASUS A: PEMBAYARAN KADALUARSA (TELAT BAYAR)
      -- Uang tercatat masuk ke rekening, TAPI TIKET TIDAK BOLEH TERBIT!
      -- -----------------------------------------------------------------------
      UPDATE transactions SET 
        transaction_status = 'paid', 
        provider_transaction_id = COALESCE(provider_transaction_id, v_tid), 
        fraud_status = v_fraud,
        payment_type = COALESCE(p_payload ->> 'payment_type', payment_type), 
        raw_status = 'settlement_late_expired',
        transaction_time = COALESCE((p_payload ->> 'transaction_time')::timestamp at time zone 'Asia/Jakarta', transaction_time),
        paid_at = CASE WHEN paid_at IS NULL THEN now() ELSE paid_at END 
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

-- Pelepasan Otomatis Reservasi Kadaluarsa
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
  RETURN n;
END $$;

-- ==============================================================================
-- 14. ADMIN FUNCTIONS: DASHBOARD SUMMARY, RETRY QUEUE, CANCEL
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.admin_cancel_registration(p_actor UUID, p_registration UUID, p_reason TEXT) 
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE reg registrations;
BEGIN
  SELECT * INTO reg FROM registrations WHERE id = p_registration FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF reg.registration_status NOT IN ('draft', 'awaiting_payment') OR reg.payment_status = 'paid' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  
  UPDATE quota_reservations SET status = 'released', released_at = now(), release_reason = 'admin_cancel' WHERE registration_id = reg.id AND status = 'reserved';
  UPDATE registrations SET registration_status = 'cancelled', payment_status = CASE WHEN payment_status = 'pending' THEN 'cancelled' ELSE payment_status END, admin_note = left(p_reason, 500), updated_at = now() WHERE id = reg.id;
  
  INSERT INTO activity_logs (actor_user_id, action, resource_type, resource_id, before_data, after_data, reason)
  VALUES (p_actor, 'registration.cancel', 'registration', reg.id::text, jsonb_build_object('status', reg.registration_status), jsonb_build_object('status', 'cancelled'), p_reason);
  
  IF reg.user_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, title, body, type, related_type, related_id) VALUES (reg.user_id, 'Pendaftaran dibatalkan', 'Pendaftaran Anda dibatalkan oleh admin.', 'registration_cancelled', 'registration', reg.id);
  END IF;
  
  RETURN jsonb_build_object('status', 'cancelled');
END $$;

CREATE OR REPLACE FUNCTION public.admin_summary(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ) 
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v JSONB;
BEGIN
  SELECT jsonb_build_object(
    'events', (SELECT count(*) FROM events WHERE status <> 'archived'),
    'participants', (SELECT count(*) FROM profiles),
    'registrations', (SELECT count(*) FROM registrations WHERE created_at BETWEEN p_from AND p_to),
    'pending_payment', (SELECT count(*) FROM registrations WHERE registration_status = 'awaiting_payment'),
    'confirmed', (SELECT count(*) FROM registrations WHERE registration_status = 'confirmed' AND created_at BETWEEN p_from AND p_to),
    'revenue_paid', (SELECT COALESCE(sum(gross_amount), 0) FROM transactions WHERE transaction_status = 'paid' AND paid_at BETWEEN p_from AND p_to),
    'registrations_by_day', (SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d, 'count', c) ORDER BY d), '[]'::jsonb) FROM (SELECT created_at::date d, count(*) c FROM registrations WHERE created_at BETWEEN p_from AND p_to GROUP BY 1) x),
    'revenue_by_day', (SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d, 'amount', a) ORDER BY d), '[]'::jsonb) FROM (SELECT paid_at::date d, sum(gross_amount) a FROM transactions WHERE transaction_status = 'paid' AND paid_at BETWEEN p_from AND p_to GROUP BY 1) x),
    'top_events', (SELECT COALESCE(jsonb_agg(jsonb_build_object('title', title, 'confirmed', n) ORDER BY n DESC), '[]'::jsonb) FROM (SELECT e.title, count(r.id) n FROM events e JOIN registrations r ON r.event_id = e.id AND r.registration_status = 'confirmed' GROUP BY e.title ORDER BY n DESC LIMIT 5) x),
    'recent_activity', (SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) FROM (SELECT action, resource_type, resource_id, created_at FROM activity_logs ORDER BY created_at DESC LIMIT 8) a),
    'health', jsonb_build_object(
      'database', 'ok',
      'worker_last_seen', (SELECT max(last_seen) FROM worker_heartbeats),
      'queue_queued', (SELECT count(*) FROM queue_requests WHERE status = 'queued'),
      'queue_processing', (SELECT count(*) FROM queue_requests WHERE status = 'processing'),
      'queue_failed', (SELECT count(*) FROM queue_requests WHERE status = 'failed'),
      'outbox_pending', (SELECT count(*) FROM outbox_messages WHERE status <> 'published'),
      'webhook_last_valid', (SELECT max(received_at) FROM payment_notifications WHERE signature_valid),
      'webhook_invalid_24h', (SELECT count(*) FROM payment_notifications WHERE NOT signature_valid AND received_at > now() - interval '24 hours'),
      'stale_pending_tx', (SELECT count(*) FROM transactions WHERE transaction_status = 'pending' AND COALESCE(expiry_time, created_at + interval '1 hour') < now()))
  ) INTO v;
  RETURN v;
END $$;

-- Outbox Helpers untuk Worker RabbitMQ
CREATE OR REPLACE FUNCTION public.claim_outbox(p_limit INT DEFAULT 50) 
RETURNS SETOF outbox_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH c AS (
    SELECT id FROM outbox_messages 
    WHERE status IN ('pending', 'publishing') AND available_at <= now() 
    ORDER BY created_at LIMIT p_limit FOR UPDATE SKIP LOCKED
  )
  UPDATE outbox_messages o 
  SET status = 'publishing', attempts = o.attempts + 1, available_at = now() + interval '30 seconds'
  FROM c WHERE o.id = c.id RETURNING o.*;
END $$;

CREATE OR REPLACE FUNCTION public.mark_outbox_published(p_ids UUID[]) 
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE outbox_messages SET status = 'published', published_at = now() WHERE id = ANY(p_ids);
$$;

CREATE OR REPLACE FUNCTION public.mark_outbox_failed(p_id UUID, p_delay_seconds INT, p_error TEXT) 
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE outbox_messages SET status = 'pending', last_error = left(p_error, 300), available_at = now() + make_interval(secs => p_delay_seconds) WHERE id = p_id;
$$;

-- Hak Akses Eksekusi Fungsi RPC
REVOKE EXECUTE ON FUNCTION 
  public.request_registration_queue, public._reject_queue, public.reserve_quota, 
  public.claim_outbox, public.mark_outbox_published, public.mark_outbox_failed, 
  public._issue_tickets, public.submit_registration_answers, public.prepare_payment, 
  public.attach_snap, public.process_payment_notification, public.process_qris_mutation,
  public.verify_manual_payment, public.allocate_qris_unique_code, public.expire_reservations, 
  public.admin_cancel_registration, public.admin_summary
FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.my_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_qris_unique_code TO service_role;
GRANT EXECUTE ON FUNCTION public.process_qris_mutation TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_manual_payment TO service_role;

-- ==============================================================================
-- 15. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Service Role Key memiliki akses penuh tanpa batas
DROP POLICY IF EXISTS "Service role full access on profiles" ON public.profiles;
CREATE POLICY "Service role full access on profiles" ON public.profiles FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on events" ON public.events;
CREATE POLICY "Service role full access on events" ON public.events FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on ticket_categories" ON public.ticket_categories;
CREATE POLICY "Service role full access on ticket_categories" ON public.ticket_categories FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on registrations" ON public.registrations;
CREATE POLICY "Service role full access on registrations" ON public.registrations FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on transactions" ON public.transactions;
CREATE POLICY "Service role full access on transactions" ON public.transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on tickets" ON public.tickets;
CREATE POLICY "Service role full access on tickets" ON public.tickets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on orders" ON public.orders;
CREATE POLICY "Service role full access on orders" ON public.orders FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on payments" ON public.payments;
CREATE POLICY "Service role full access on payments" ON public.payments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Kebijakan Akses Publik & Peserta
DROP POLICY IF EXISTS "Public view published events" ON public.events;
CREATE POLICY "Public view published events" ON public.events FOR SELECT TO anon, authenticated
USING (status IN ('published', 'registration_closed', 'ongoing', 'completed'));

DROP POLICY IF EXISTS "Public view ticket categories" ON public.ticket_categories;
CREATE POLICY "Public view ticket categories" ON public.ticket_categories FOR SELECT TO anon, authenticated
USING (is_active = true);

DROP POLICY IF EXISTS "User view own profile" ON public.profiles;
CREATE POLICY "User view own profile" ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid());

DROP POLICY IF EXISTS "User update own profile" ON public.profiles;
CREATE POLICY "User update own profile" ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "User view own registrations" ON public.registrations;
CREATE POLICY "User view own registrations" ON public.registrations FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "User view own tickets" ON public.tickets;
CREATE POLICY "User view own tickets" ON public.tickets FOR SELECT TO authenticated
USING (registration_id IN (SELECT id FROM public.registrations WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "User view own notifications" ON public.notifications;
CREATE POLICY "User view own notifications" ON public.notifications FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- Storage Bucket untuk Upload Gambar & Media
INSERT INTO storage.buckets (id, name, public) 
VALUES ('media', 'media', true) 
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read media" ON storage.objects;
CREATE POLICY "Public read media" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'media');
