-- 0001_schema.sql — tabel inti (DATABASE_SCHEMA). Semua PK UUID, waktu timestamptz (UTC).
-- Tidak memakai pgcrypto: hash memakai sha256() bawaan PostgreSQL.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text, full_name text, phone text, avatar_path text,
  account_status text not null default 'active' check (account_status in ('active','suspended')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.roles (id uuid primary key default gen_random_uuid(), name text not null unique check (name in ('participant','admin','super_admin')), description text);
create table public.permissions (id uuid primary key default gen_random_uuid(), code text not null unique, description text);
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  assigned_by uuid references public.profiles(id), created_at timestamptz not null default now(),
  unique (user_id, role_id)
);
create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.event_categories (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  description text, icon text, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.events (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.event_categories(id),
  organizer_name text, title text not null, slug text not null unique, summary text, description text,
  poster_path text, banner_path text, poster_alt text,
  event_type text not null default 'offline' check (event_type in ('offline','online','hybrid')),
  venue_name text, address text, online_url text, timezone text not null default 'Asia/Jakarta',
  start_at timestamptz not null, end_at timestamptz not null,
  registration_opens_at timestamptz not null, registration_closes_at timestamptz not null,
  total_quota int not null check (total_quota >= 0),
  max_per_user int not null default 1 check (max_per_user > 0),
  requirements text, faq jsonb not null default '[]'::jsonb,
  meta_title text, meta_description text, og_image_path text,
  status text not null default 'draft' check (status in ('draft','published','registration_closed','ongoing','completed','archived')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (end_at >= start_at), check (registration_closes_at >= registration_opens_at)
);
create table public.ticket_categories (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null, description text,
  price numeric(12,2) not null default 0 check (price >= 0),
  quota int not null check (quota >= 0),
  sales_start_at timestamptz, sales_end_at timestamptz, max_per_user int check (max_per_user > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.event_form_fields (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  field_key text not null, label text not null,
  field_type text not null check (field_type in ('text','textarea','number','email','tel','select','checkbox','date')),
  options jsonb not null default '[]'::jsonb, is_required boolean not null default false,
  sort_order int not null default 0, validation_rules jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  unique (event_id, field_key)
);

create table public.queue_requests (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique,           -- user_id:idempotency_key
  idempotency_key text not null, payload_hash text not null,
  user_id uuid not null references public.profiles(id),
  event_id uuid not null references public.events(id),
  ticket_category_id uuid not null references public.ticket_categories(id),
  quantity int not null check (quantity > 0),
  status text not null default 'queued' check (status in ('queued','processing','accepted','rejected','failed','expired')),
  message_id uuid unique default gen_random_uuid(),
  retry_count int not null default 0, error_code text, error_message text,
  queued_at timestamptz not null default now(), processing_started_at timestamptz, processed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index queue_one_active_per_user_event on public.queue_requests (user_id, event_id) where status in ('queued','processing');

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  registration_code text not null unique,
  user_id uuid not null references public.profiles(id),
  event_id uuid not null references public.events(id),
  ticket_category_id uuid not null references public.ticket_categories(id),
  queue_request_id uuid unique references public.queue_requests(id),
  quantity int not null check (quantity > 0),
  subtotal numeric(12,2) not null check (subtotal >= 0), total_amount numeric(12,2) not null check (total_amount >= 0),
  registration_status text not null default 'draft' check (registration_status in ('draft','awaiting_payment','confirmed','cancelled','expired')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','expired','cancelled','refunded','partially_refunded')),
  admin_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), confirmed_at timestamptz
);
create index on public.registrations (user_id, created_at desc);
create index on public.registrations (event_id, registration_status);

create table public.registration_answers (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  field_key text not null, field_label_snapshot text not null, answer jsonb,
  created_at timestamptz not null default now(),
  unique (registration_id, field_key)
);
create table public.quota_reservations (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  event_id uuid not null references public.events(id),
  ticket_category_id uuid not null references public.ticket_categories(id),
  quantity int not null check (quantity > 0),
  status text not null default 'reserved' check (status in ('reserved','confirmed','released','expired')),
  reserved_at timestamptz not null default now(), expires_at timestamptz not null,
  confirmed_at timestamptz, released_at timestamptz, release_reason text
);
create index on public.quota_reservations (event_id, status, expires_at);
create unique index one_live_reservation_per_registration on public.quota_reservations (registration_id) where status in ('reserved','confirmed');

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id),
  order_id text not null unique, provider text not null default 'midtrans', provider_transaction_id text,
  gross_amount numeric(12,2) not null check (gross_amount >= 0), currency text not null default 'IDR',
  payment_type text, snap_token text, snap_redirect_url text,
  transaction_status text not null default 'pending' check (transaction_status in ('pending','paid','failed','expired','cancelled','refunded','partially_refunded')),
  fraud_status text, transaction_time timestamptz, expiry_time timestamptz, paid_at timestamptz, raw_status text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index one_pending_tx_per_registration on public.transactions (registration_id) where transaction_status = 'pending';
create table public.payment_notifications (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid references public.transactions(id), provider text not null default 'midtrans',
  notification_key text unique, order_id text, provider_transaction_id text,
  received_at timestamptz not null default now(), signature_valid boolean not null,
  processing_status text not null default 'received', status_code text,
  payload_redacted jsonb, processing_error text
);
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id),
  ticket_code text not null unique, attendee_name text,
  status text not null default 'active' check (status in ('active','used','void')),
  issued_at timestamptz not null default now(), checked_in_at timestamptz, metadata jsonb not null default '{}'::jsonb
);

create table public.blogs (
  id uuid primary key default gen_random_uuid(), title text not null, slug text not null unique,
  excerpt text, content text not null default '', thumbnail_path text, category text,
  author_id uuid references public.profiles(id),
  status text not null default 'draft' check (status in ('draft','published')), published_at timestamptz,
  meta_title text, meta_description text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.partnerships (
  id uuid primary key default gen_random_uuid(), organization_name text not null, contact_name text not null,
  email text not null, phone text, organization_type text, website text, description text,
  attachment_path text, status text not null default 'new' check (status in ('new','reviewing','approved','rejected')),
  internal_note text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.contact_messages (
  id uuid primary key default gen_random_uuid(), name text not null, email text not null, subject text not null, message text not null,
  status text not null default 'new' check (status in ('new','read','replied','closed')),
  internal_note text, assigned_admin_id uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.banners (
  id uuid primary key default gen_random_uuid(), title text not null, description text,
  image_path text, mobile_image_path text, alt_text text, cta_label text, cta_url text,
  starts_at timestamptz, ends_at timestamptz, sort_order int not null default 0, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, body text, type text not null default 'info', related_type text, related_id uuid,
  read_at timestamptz, created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(), actor_user_id uuid, actor_type text not null default 'admin',
  action text not null, resource_type text, resource_id text, before_data jsonb, after_data jsonb,
  reason text, request_id text, created_at timestamptz not null default now()
);
create table public.outbox_messages (
  id uuid primary key default gen_random_uuid(), aggregate_type text not null, aggregate_id uuid not null,
  event_type text not null, payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','publishing','published')),
  attempts int not null default 0, last_error text,
  available_at timestamptz not null default now(), published_at timestamptz, created_at timestamptz not null default now()
);
create index on public.outbox_messages (status, available_at);
create table public.app_settings (key text primary key, value jsonb not null, updated_by uuid, updated_at timestamptz not null default now());
create table public.worker_heartbeats (worker_id text primary key, last_seen timestamptz not null default now(), stats jsonb not null default '{}'::jsonb);

-- updated_at otomatis
create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['profiles','event_categories','events','ticket_categories','queue_requests','registrations','transactions','blogs','partnerships','contact_messages','banners']
  loop execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t); end loop;
end $$;

-- activity_logs append-only
create function public.block_log_mutation() returns trigger language plpgsql as $$ begin raise exception 'activity_logs bersifat append-only'; end $$;
create trigger activity_logs_immutable before update or delete on public.activity_logs for each row execute function public.block_log_mutation();

-- profil otomatis saat user Supabase Auth dibuat / email berubah
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone');
  insert into public.user_roles (user_id, role_id) select new.id, id from public.roles where name = 'participant';
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create function public.sync_profile_email() returns trigger language plpgsql security definer set search_path = public as $$
begin update public.profiles set email = new.email where id = new.id; return new; end $$;
create trigger on_auth_user_email after update of email on auth.users for each row execute function public.sync_profile_email();

insert into storage.buckets (id, name, public) values ('media', 'media', true) on conflict (id) do nothing;
