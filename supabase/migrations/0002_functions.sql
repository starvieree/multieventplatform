-- 0002_functions.sql — operasi atomik (kuota, pembayaran, outbox). PostgreSQL = sumber kebenaran.
-- Urutan lock: transaksi -> registrasi -> event -> kategori tiket -> reservasi (konsisten).

create function public.my_access() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'roles', coalesce((select jsonb_agg(r.name) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = auth.uid()), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(distinct p.code) from user_roles ur join role_permissions rp on rp.role_id = ur.role_id join permissions p on p.id = rp.permission_id where ur.user_id = auth.uid()), '[]'::jsonb));
$$;

-- ---------- ketersediaan publik (agregat saja; view dijalankan sebagai owner, tidak membuka data pribadi) ----------
create view public.event_listing as
select e.id, e.slug, e.title, e.summary, e.poster_path, e.poster_alt, e.event_type, e.venue_name, e.address,
       e.start_at, e.end_at, e.registration_opens_at, e.registration_closes_at, e.status, e.total_quota, e.max_per_user,
       c.id as category_id, c.name as category_name, c.slug as category_slug,
       (select min(tc.price) from ticket_categories tc where tc.event_id = e.id and tc.is_active) as min_price,
       greatest(e.total_quota - coalesce((select sum(qr.quantity) from quota_reservations qr where qr.event_id = e.id and qr.status in ('reserved','confirmed')), 0), 0) as available
from events e left join event_categories c on c.id = e.category_id
where e.status in ('published','registration_closed','ongoing','completed');

create view public.ticket_availability as
select tc.id as ticket_category_id, tc.event_id,
       greatest(least(tc.quota - coalesce((select sum(qr.quantity) from quota_reservations qr where qr.ticket_category_id = tc.id and qr.status in ('reserved','confirmed')), 0),
                      e.total_quota - coalesce((select sum(qr.quantity) from quota_reservations qr where qr.event_id = e.id and qr.status in ('reserved','confirmed')), 0)), 0) as available
from ticket_categories tc join events e on e.id = tc.event_id
where tc.is_active and e.status in ('published','registration_closed','ongoing');

-- ---------- antrean ----------
create function public.request_registration_queue(p_user uuid, p_event uuid, p_category uuid, p_qty int, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_hash text; v_key text; q queue_requests; ev events; tc ticket_categories; v_user_taken int;
begin
  v_key := p_user::text || ':' || p_key;
  v_hash := encode(sha256(convert_to(p_event::text || p_category::text || p_qty::text, 'UTF8')), 'hex');
  select * into q from queue_requests where request_key = v_key;
  if found then
    if q.payload_hash <> v_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('queue_request_id', q.id, 'status', q.status, 'replayed', true);
  end if;
  if (select account_status from profiles where id = p_user) is distinct from 'active' then raise exception 'ACCOUNT_SUSPENDED'; end if;
  select * into ev from events where id = p_event and status = 'published';
  if not found or now() < ev.registration_opens_at or now() > ev.registration_closes_at then raise exception 'REGISTRATION_CLOSED'; end if;
  select * into tc from ticket_categories where id = p_category and event_id = p_event and is_active;
  if not found or (tc.sales_start_at is not null and now() < tc.sales_start_at) or (tc.sales_end_at is not null and now() > tc.sales_end_at) then raise exception 'INVALID_CATEGORY'; end if;
  select * into q from queue_requests where user_id = p_user and event_id = p_event and status in ('queued','processing');
  if found then return jsonb_build_object('queue_request_id', q.id, 'status', q.status, 'replayed', true); end if;
  select coalesce(sum(quantity), 0) into v_user_taken from registrations where user_id = p_user and event_id = p_event and registration_status in ('draft','awaiting_payment','confirmed');
  if v_user_taken + p_qty > ev.max_per_user then raise exception 'USER_LIMIT'; end if;
  begin
    insert into queue_requests (request_key, idempotency_key, payload_hash, user_id, event_id, ticket_category_id, quantity)
    values (v_key, p_key, v_hash, p_user, p_event, p_category, p_qty) returning * into q;
  exception when unique_violation then
    select * into q from queue_requests where request_key = v_key or (user_id = p_user and event_id = p_event and status in ('queued','processing')) limit 1;
    return jsonb_build_object('queue_request_id', q.id, 'status', q.status, 'replayed', true);
  end;
  insert into outbox_messages (aggregate_type, aggregate_id, event_type, payload) values ('queue_request', q.id, 'registration.requested',
    jsonb_build_object('message_id', q.message_id, 'event_type', 'registration.requested', 'schema_version', 1, 'occurred_at', now(), 'correlation_id', gen_random_uuid(),
      'data', jsonb_build_object('queue_request_id', q.id, 'user_id', p_user, 'event_id', p_event, 'ticket_category_id', p_category, 'quantity', p_qty, 'idempotency_key', p_key)));
  return jsonb_build_object('queue_request_id', q.id, 'status', q.status, 'replayed', false);
end $$;

create function public._reject_queue(p_id uuid, p_code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare q queue_requests;
begin
  update queue_requests set status = 'rejected', error_code = p_code, processed_at = now() where id = p_id returning * into q;
  insert into notifications (user_id, title, body, type, related_type, related_id)
  values (q.user_id, 'Pendaftaran belum dapat diproses',
          case p_code when 'QUOTA_FULL' then 'Kuota sudah penuh.' when 'USER_LIMIT' then 'Batas pendaftaran per akun tercapai.' else 'Pendaftaran event sudah ditutup.' end,
          'queue_rejected', 'queue_request', q.id);
  return jsonb_build_object('status', 'rejected', 'error_code', p_code);
end $$;

create function public.reserve_quota(p_queue_request_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare q queue_requests; ev events; tc ticket_categories; ev_taken int; tc_taken int; user_taken int; reg registrations; v_minutes int;
begin
  select * into q from queue_requests where id = p_queue_request_id for update;
  if not found then raise exception 'QUEUE_REQUEST_NOT_FOUND'; end if;
  if q.status in ('accepted','rejected','failed','expired') then
    return jsonb_build_object('status', q.status, 'error_code', q.error_code, 'registration_id', (select id from registrations where queue_request_id = q.id), 'replayed', true);
  end if;
  update queue_requests set status = 'processing', processing_started_at = coalesce(processing_started_at, now()) where id = q.id;
  select * into ev from events where id = q.event_id for update;               -- lock event lalu kategori
  select * into tc from ticket_categories where id = q.ticket_category_id for update;
  if ev.status <> 'published' or now() < ev.registration_opens_at or now() > ev.registration_closes_at or not tc.is_active then return _reject_queue(q.id, 'REGISTRATION_CLOSED'); end if;
  select coalesce(sum(quantity), 0) into ev_taken from quota_reservations where event_id = ev.id and status in ('reserved','confirmed');
  select coalesce(sum(quantity), 0) into tc_taken from quota_reservations where ticket_category_id = tc.id and status in ('reserved','confirmed');
  select coalesce(sum(quantity), 0) into user_taken from registrations where user_id = q.user_id and event_id = ev.id and registration_status in ('draft','awaiting_payment','confirmed');
  if user_taken + q.quantity > ev.max_per_user then return _reject_queue(q.id, 'USER_LIMIT'); end if;
  if ev.total_quota - ev_taken < q.quantity or tc.quota - tc_taken < q.quantity then return _reject_queue(q.id, 'QUOTA_FULL'); end if;
  select coalesce((value #>> '{}')::int, 30) into v_minutes from app_settings where key = 'reservation_minutes';
  insert into registrations (registration_code, user_id, event_id, ticket_category_id, queue_request_id, quantity, subtotal, total_amount)
  values ('REG-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)), q.user_id, ev.id, tc.id, q.id, q.quantity, tc.price * q.quantity, tc.price * q.quantity)
  returning * into reg;
  insert into quota_reservations (registration_id, event_id, ticket_category_id, quantity, expires_at)
  values (reg.id, ev.id, tc.id, q.quantity, now() + make_interval(mins => coalesce(v_minutes, 30)));
  update queue_requests set status = 'accepted', processed_at = now() where id = q.id;
  insert into notifications (user_id, title, body, type, related_type, related_id)
  values (q.user_id, 'Kuota berhasil diamankan', 'Lengkapi formulir sebelum batas waktu reservasi berakhir.', 'queue_accepted', 'registration', reg.id);
  return jsonb_build_object('status', 'accepted', 'registration_id', reg.id);
end $$;

create function public.mark_queue_failed(p_id uuid, p_code text, p_message text) returns void language sql security definer set search_path = public as $$
  update queue_requests set status = 'failed', error_code = p_code, error_message = left(p_message, 500), processed_at = now(), retry_count = retry_count + 1
  where id = p_id and status in ('queued','processing');
$$;

-- ---------- outbox ----------
create function public.claim_outbox(p_limit int default 50) returns setof outbox_messages language plpgsql security definer set search_path = public as $$
begin
  return query
  with c as (select id from outbox_messages where status in ('pending','publishing') and available_at <= now() order by created_at limit p_limit for update skip locked)
  update outbox_messages o set status = 'publishing', attempts = o.attempts + 1, available_at = now() + interval '30 seconds'
  from c where o.id = c.id returning o.*;
end $$;
create function public.mark_outbox_published(p_ids uuid[]) returns void language sql security definer set search_path = public as $$
  update outbox_messages set status = 'published', published_at = now() where id = any(p_ids);
$$;
create function public.mark_outbox_failed(p_id uuid, p_delay_seconds int, p_error text) returns void language sql security definer set search_path = public as $$
  update outbox_messages set status = 'pending', last_error = left(p_error, 300), available_at = now() + make_interval(secs => p_delay_seconds) where id = p_id;
$$;

-- ---------- formulir & tiket ----------
create function public._issue_tickets(p_registration uuid) returns void language plpgsql security definer set search_path = public as $$
declare reg registrations; v_name text;
begin
  select * into reg from registrations where id = p_registration;
  if exists (select 1 from tickets where registration_id = reg.id) then return; end if;   -- idempotent
  select full_name into v_name from profiles where id = reg.user_id;
  insert into tickets (registration_id, ticket_code, attendee_name)
  select reg.id, 'TKT-' || upper(substr(md5(random()::text || clock_timestamp()::text || g::text), 1, 10)), v_name from generate_series(1, reg.quantity) g;
  insert into notifications (user_id, title, body, type, related_type, related_id)
  values (reg.user_id, 'Pendaftaran terkonfirmasi', 'Tiket Anda sudah terbit.', 'registration_confirmed', 'registration', reg.id);
end $$;

create function public.submit_registration_answers(p_user uuid, p_registration uuid, p_answers jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare reg registrations; res quota_reservations; f record;
begin
  select * into reg from registrations where id = p_registration and user_id = p_user for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if reg.registration_status not in ('draft','awaiting_payment') then raise exception 'INVALID_STATE'; end if;
  select * into res from quota_reservations where registration_id = reg.id and status = 'reserved' and expires_at > now() for update;
  if not found then raise exception 'RESERVATION_EXPIRED'; end if;
  for f in select * from event_form_fields where event_id = reg.event_id and is_active loop
    if p_answers ? f.field_key then
      insert into registration_answers (registration_id, field_key, field_label_snapshot, answer) values (reg.id, f.field_key, f.label, p_answers -> f.field_key)
      on conflict (registration_id, field_key) do update set answer = excluded.answer, field_label_snapshot = excluded.field_label_snapshot;
    end if;
  end loop;
  if reg.total_amount = 0 then   -- event gratis: langsung confirmed setelah form & reservasi valid
    update quota_reservations set status = 'confirmed', confirmed_at = now() where id = res.id;
    update registrations set registration_status = 'confirmed', payment_status = 'paid', confirmed_at = now() where id = reg.id;
    perform _issue_tickets(reg.id);
    return jsonb_build_object('next', 'status');
  end if;
  update registrations set registration_status = 'awaiting_payment' where id = reg.id;
  return jsonb_build_object('next', 'payment');
end $$;

-- ---------- pembayaran ----------
create function public.prepare_payment(p_user uuid, p_registration uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare reg registrations; res quota_reservations; tc ticket_categories; t transactions; v_amount numeric; v_order text;
begin
  select * into reg from registrations where id = p_registration and user_id = p_user for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if reg.registration_status <> 'awaiting_payment' then raise exception 'INVALID_STATE'; end if;
  select * into res from quota_reservations where registration_id = reg.id and status = 'reserved' and expires_at > now();
  if not found then raise exception 'RESERVATION_EXPIRED'; end if;
  select * into tc from ticket_categories where id = reg.ticket_category_id;
  v_amount := tc.price * reg.quantity;                      -- nominal selalu dari database
  select * into t from transactions where registration_id = reg.id and transaction_status = 'pending' for update;
  if found then
    if t.snap_token is not null then
      return jsonb_build_object('order_id', t.order_id, 'amount', t.gross_amount, 'snap_token', t.snap_token, 'redirect_url', t.snap_redirect_url, 'expires_at', res.expires_at, 'reused', true);
    end if;
    update transactions set transaction_status = 'cancelled', raw_status = 'superseded_no_token' where id = t.id;
  end if;
  v_order := 'EVT-' || upper(substr(replace(reg.id::text, '-', ''), 1, 10)) || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  insert into transactions (registration_id, order_id, gross_amount, expiry_time) values (reg.id, v_order, v_amount, res.expires_at);
  update registrations set payment_status = 'pending', total_amount = v_amount where id = reg.id;
  return jsonb_build_object('order_id', v_order, 'amount', v_amount, 'expires_at', res.expires_at, 'reused', false);
end $$;

create function public.attach_snap(p_order_id text, p_token text, p_redirect text) returns void language sql security definer set search_path = public as $$
  update transactions set snap_token = p_token, snap_redirect_url = p_redirect where order_id = p_order_id and transaction_status = 'pending';
$$;

create function public.process_payment_notification(p_payload jsonb, p_signature_valid boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order text := p_payload ->> 'order_id'; v_status text := p_payload ->> 'transaction_status'; v_code text := p_payload ->> 'status_code';
  v_tid text := p_payload ->> 'transaction_id'; v_fraud text := p_payload ->> 'fraud_status'; v_gross numeric; v_key text; v_nid uuid; v_new text;
  t transactions; reg registrations; res quota_reservations; ev events; tc ticket_categories; ev_taken int; tc_taken int;
  v_redacted jsonb := p_payload - 'signature_key' - 'va_numbers' - 'permata_va_number' - 'bill_key' - 'masked_card' - 'card_type';
begin
  if not p_signature_valid then
    insert into payment_notifications (order_id, provider_transaction_id, signature_valid, processing_status, status_code, payload_redacted)
    values (left(v_order, 100), v_tid, false, 'rejected_signature', v_code, v_redacted);
    return jsonb_build_object('result', 'invalid_signature');
  end if;
  begin v_gross := (p_payload ->> 'gross_amount')::numeric; exception when others then v_gross := null; end;
  v_key := encode(sha256(convert_to(concat_ws('|', v_order, v_status, v_code, p_payload ->> 'gross_amount', v_tid, p_payload ->> 'transaction_time'), 'UTF8')), 'hex');
  insert into payment_notifications (notification_key, order_id, provider_transaction_id, signature_valid, status_code, payload_redacted)
  values (v_key, v_order, v_tid, true, v_code, v_redacted) on conflict (notification_key) do nothing returning id into v_nid;
  if v_nid is null then return jsonb_build_object('result', 'duplicate'); end if;

  select * into t from transactions where order_id = v_order for update;
  if not found then update payment_notifications set processing_status = 'unknown_order' where id = v_nid; return jsonb_build_object('result', 'unknown_order'); end if;
  update payment_notifications set transaction_id = t.id where id = v_nid;
  if v_gross is distinct from t.gross_amount or (t.provider_transaction_id is not null and v_tid is not null and t.provider_transaction_id <> v_tid) then
    update payment_notifications set processing_status = 'rejected_mismatch' where id = v_nid; return jsonb_build_object('result', 'mismatch');
  end if;
  v_new := case
    when v_status = 'settlement' then 'paid'
    when v_status = 'capture' and coalesce(v_fraud, 'accept') = 'accept' then 'paid'
    when v_status in ('capture','pending') then 'pending'
    when v_status = 'deny' then 'failed' when v_status = 'cancel' then 'cancelled' when v_status = 'expire' then 'expired'
    when v_status = 'refund' then 'refunded' when v_status = 'partial_refund' then 'partially_refunded' else null end;
  if v_new is null then update payment_notifications set processing_status = 'ignored_unknown_status' where id = v_nid; return jsonb_build_object('result', 'ignored'); end if;
  -- status final tidak boleh mundur (notifikasi terlambat / tidak berurutan)
  if t.transaction_status in ('refunded','failed','cancelled','expired') or (t.transaction_status = 'paid' and v_new not in ('paid','refunded','partially_refunded')) or (t.transaction_status = 'partially_refunded' and v_new <> 'refunded') then
    update payment_notifications set processing_status = 'ignored_out_of_order' where id = v_nid; return jsonb_build_object('result', 'ignored_out_of_order');
  end if;
  update transactions set transaction_status = v_new, provider_transaction_id = coalesce(provider_transaction_id, v_tid), fraud_status = v_fraud,
    payment_type = coalesce(p_payload ->> 'payment_type', payment_type), raw_status = v_status,
    transaction_time = coalesce((p_payload ->> 'transaction_time')::timestamp at time zone 'Asia/Jakarta', transaction_time),
    paid_at = case when v_new = 'paid' and paid_at is null then now() else paid_at end where id = t.id;

  select * into reg from registrations where id = t.registration_id for update;
  if v_new = 'paid' then
    select * into res from quota_reservations where registration_id = reg.id order by reserved_at desc limit 1 for update;
    if res.status = 'reserved' then update quota_reservations set status = 'confirmed', confirmed_at = now() where id = res.id;
    elsif res.status in ('released','expired') then   -- pembayaran valid datang setelah reservasi dilepas: ambil kembali hanya bila kuota masih ada
      select * into ev from events where id = res.event_id for update; select * into tc from ticket_categories where id = res.ticket_category_id for update;
      select coalesce(sum(quantity), 0) into ev_taken from quota_reservations where event_id = ev.id and status in ('reserved','confirmed');
      select coalesce(sum(quantity), 0) into tc_taken from quota_reservations where ticket_category_id = tc.id and status in ('reserved','confirmed');
      if ev.total_quota - ev_taken >= res.quantity and tc.quota - tc_taken >= res.quantity then
        update quota_reservations set status = 'confirmed', confirmed_at = now(), released_at = null, release_reason = null where id = res.id;
      else
        update registrations set registration_status = 'cancelled', payment_status = 'paid', admin_note = 'Pembayaran valid diterima setelah kuota dilepas dan kuota habis; perlu refund.' where id = reg.id;
        insert into activity_logs (actor_type, action, resource_type, resource_id, reason) values ('system', 'late_payment_requires_refund', 'registration', reg.id::text, t.order_id);
        update payment_notifications set processing_status = 'processed_needs_refund' where id = v_nid;
        return jsonb_build_object('result', 'paid_no_quota');
      end if;
    end if;
    update registrations set registration_status = 'confirmed', payment_status = 'paid', confirmed_at = coalesce(confirmed_at, now()) where id = reg.id;
    perform _issue_tickets(reg.id);
  elsif v_new in ('failed','cancelled','expired') then
    if not exists (select 1 from transactions where registration_id = reg.id and transaction_status = 'paid') then
      update quota_reservations set status = case when v_new = 'expired' then 'expired' else 'released' end, released_at = now(), release_reason = 'payment_' || v_new
      where registration_id = reg.id and status = 'reserved';
      update registrations set payment_status = v_new, registration_status = case when registration_status in ('draft','awaiting_payment') then (case when v_new = 'expired' then 'expired' else 'cancelled' end) else registration_status end where id = reg.id;
    end if;
  elsif v_new in ('refunded','partially_refunded') then
    update registrations set payment_status = v_new where id = reg.id;
    if v_new = 'refunded' then
      update tickets set status = 'void' where registration_id = reg.id and status = 'active';
      update quota_reservations set status = 'released', released_at = now(), release_reason = 'refunded' where registration_id = reg.id and status = 'confirmed';
      update registrations set registration_status = 'cancelled' where id = reg.id;
    end if;
  end if;
  update payment_notifications set processing_status = 'processed' where id = v_nid;
  return jsonb_build_object('result', 'processed', 'status', v_new);
end $$;

-- ---------- expiry & rekonsiliasi ----------
create function public.expire_reservations() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with exp as (
    select qr.id, qr.registration_id from quota_reservations qr join registrations r on r.id = qr.registration_id
    where qr.status = 'reserved' and qr.expires_at < now()
      and not exists (select 1 from transactions t where t.registration_id = r.id and (t.transaction_status = 'paid' or (t.transaction_status = 'pending' and coalesce(t.expiry_time, qr.expires_at) > now() - interval '5 minutes')))
    for update of r, qr skip locked),
  upd as (update quota_reservations q set status = 'expired', released_at = now(), release_reason = 'reservation_expired' from exp where q.id = exp.id returning q.registration_id),
  reg as (update registrations r set registration_status = 'expired', payment_status = case when r.payment_status = 'pending' then 'expired' else r.payment_status end
          from upd where r.id = upd.registration_id and r.registration_status in ('draft','awaiting_payment') returning r.id)
  select count(*) into n from upd;
  return n;
end $$;

create function public.stale_pending_transactions() returns table (order_id text) language sql security definer set search_path = public as $$
  select t.order_id from transactions t where t.transaction_status = 'pending'
    and coalesce(t.expiry_time, t.created_at + interval '1 hour') < now() - interval '2 minutes' limit 50;
$$;

-- ---------- admin ----------
create function public.admin_retry_queue(p_actor uuid, p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare q queue_requests;
begin
  select * into q from queue_requests where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if q.status <> 'failed' then raise exception 'INVALID_STATE'; end if;
  update queue_requests set status = 'queued', error_code = null, error_message = null, processed_at = null where id = q.id;
  insert into outbox_messages (aggregate_type, aggregate_id, event_type, payload) values ('queue_request', q.id, 'registration.requested',
    jsonb_build_object('message_id', q.message_id, 'event_type', 'registration.requested', 'schema_version', 1, 'occurred_at', now(), 'correlation_id', gen_random_uuid(),
      'data', jsonb_build_object('queue_request_id', q.id, 'user_id', q.user_id, 'event_id', q.event_id, 'ticket_category_id', q.ticket_category_id, 'quantity', q.quantity, 'idempotency_key', q.idempotency_key)));
  insert into activity_logs (actor_user_id, action, resource_type, resource_id, before_data, after_data) values (p_actor, 'queue.retry', 'queue_request', q.id::text, jsonb_build_object('status', 'failed'), jsonb_build_object('status', 'queued'));
  return jsonb_build_object('status', 'queued');
end $$;

create function public.admin_save_event(p_actor uuid, p_id uuid, p_event jsonb, p_tickets jsonb, p_fields jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; r jsonb; v_used int; v_tc_used int; v_keep uuid[] := '{}'; v_tcid uuid;
begin
  if v_id is null then
    insert into events (category_id, organizer_name, title, slug, summary, description, poster_path, banner_path, poster_alt, event_type, venue_name, address, online_url, timezone,
      start_at, end_at, registration_opens_at, registration_closes_at, total_quota, max_per_user, requirements, faq, meta_title, meta_description, og_image_path, created_by)
    values ((p_event ->> 'category_id')::uuid, p_event ->> 'organizer_name', p_event ->> 'title', p_event ->> 'slug', p_event ->> 'summary', p_event ->> 'description', p_event ->> 'poster_path',
      p_event ->> 'banner_path', p_event ->> 'poster_alt', coalesce(p_event ->> 'event_type', 'offline'), p_event ->> 'venue_name', p_event ->> 'address', p_event ->> 'online_url',
      coalesce(p_event ->> 'timezone', 'Asia/Jakarta'), (p_event ->> 'start_at')::timestamptz, (p_event ->> 'end_at')::timestamptz, (p_event ->> 'registration_opens_at')::timestamptz,
      (p_event ->> 'registration_closes_at')::timestamptz, (p_event ->> 'total_quota')::int, coalesce((p_event ->> 'max_per_user')::int, 1), p_event ->> 'requirements',
      coalesce(p_event -> 'faq', '[]'::jsonb), p_event ->> 'meta_title', p_event ->> 'meta_description', p_event ->> 'og_image_path', p_actor) returning id into v_id;
  else
    select coalesce(sum(quantity), 0) into v_used from quota_reservations where event_id = v_id and status in ('reserved','confirmed');
    if (p_event ->> 'total_quota')::int < v_used then raise exception 'QUOTA_BELOW_USED'; end if;
    update events set category_id = (p_event ->> 'category_id')::uuid, organizer_name = p_event ->> 'organizer_name', title = p_event ->> 'title', slug = p_event ->> 'slug',
      summary = p_event ->> 'summary', description = p_event ->> 'description', poster_path = p_event ->> 'poster_path', banner_path = p_event ->> 'banner_path', poster_alt = p_event ->> 'poster_alt',
      event_type = coalesce(p_event ->> 'event_type', event_type), venue_name = p_event ->> 'venue_name', address = p_event ->> 'address', online_url = p_event ->> 'online_url',
      timezone = coalesce(p_event ->> 'timezone', timezone), start_at = (p_event ->> 'start_at')::timestamptz, end_at = (p_event ->> 'end_at')::timestamptz,
      registration_opens_at = (p_event ->> 'registration_opens_at')::timestamptz, registration_closes_at = (p_event ->> 'registration_closes_at')::timestamptz,
      total_quota = (p_event ->> 'total_quota')::int, max_per_user = coalesce((p_event ->> 'max_per_user')::int, max_per_user), requirements = p_event ->> 'requirements',
      faq = coalesce(p_event -> 'faq', faq), meta_title = p_event ->> 'meta_title', meta_description = p_event ->> 'meta_description', og_image_path = p_event ->> 'og_image_path'
    where id = v_id;
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_tickets, '[]'::jsonb)) loop
    if nullif(r ->> 'id', '') is not null then
      v_tcid := (r ->> 'id')::uuid;
      select coalesce(sum(quantity), 0) into v_tc_used from quota_reservations where ticket_category_id = v_tcid and status in ('reserved','confirmed');
      if (r ->> 'quota')::int < v_tc_used then raise exception 'QUOTA_BELOW_USED'; end if;
      update ticket_categories set name = r ->> 'name', description = r ->> 'description', price = (r ->> 'price')::numeric, quota = (r ->> 'quota')::int,
        sales_start_at = nullif(r ->> 'sales_start_at', '')::timestamptz, sales_end_at = nullif(r ->> 'sales_end_at', '')::timestamptz, is_active = coalesce((r ->> 'is_active')::boolean, true)
      where id = v_tcid and event_id = v_id;
    else
      insert into ticket_categories (event_id, name, description, price, quota, sales_start_at, sales_end_at, is_active)
      values (v_id, r ->> 'name', r ->> 'description', (r ->> 'price')::numeric, (r ->> 'quota')::int, nullif(r ->> 'sales_start_at', '')::timestamptz, nullif(r ->> 'sales_end_at', '')::timestamptz, coalesce((r ->> 'is_active')::boolean, true))
      returning id into v_tcid;
    end if;
    v_keep := v_keep || v_tcid;
  end loop;
  update ticket_categories set is_active = false where event_id = v_id and id <> all(v_keep) and exists (select 1 from registrations where ticket_category_id = ticket_categories.id);
  delete from ticket_categories where event_id = v_id and id <> all(v_keep) and not exists (select 1 from registrations where ticket_category_id = ticket_categories.id);
  delete from event_form_fields where event_id = v_id;
  for r in select * from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb)) loop
    insert into event_form_fields (event_id, field_key, label, field_type, options, is_required, sort_order, validation_rules)
    values (v_id, r ->> 'field_key', r ->> 'label', coalesce(r ->> 'field_type', 'text'), coalesce(r -> 'options', '[]'::jsonb), coalesce((r ->> 'is_required')::boolean, false), coalesce((r ->> 'sort_order')::int, 0), coalesce(r -> 'validation_rules', '{}'::jsonb));
  end loop;
  return v_id;
end $$;

create function public.admin_summary(p_from timestamptz, p_to timestamptz) returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'events', (select count(*) from events where status <> 'archived'),
    'participants', (select count(*) from profiles),
    'registrations', (select count(*) from registrations where created_at between p_from and p_to),
    'pending_payment', (select count(*) from registrations where registration_status = 'awaiting_payment'),
    'confirmed', (select count(*) from registrations where registration_status = 'confirmed' and created_at between p_from and p_to),
    'revenue_paid', (select coalesce(sum(gross_amount), 0) from transactions where transaction_status = 'paid' and paid_at between p_from and p_to),
    'registrations_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'count', c) order by d), '[]'::jsonb) from (select created_at::date d, count(*) c from registrations where created_at between p_from and p_to group by 1) x),
    'revenue_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'amount', a) order by d), '[]'::jsonb) from (select paid_at::date d, sum(gross_amount) a from transactions where transaction_status = 'paid' and paid_at between p_from and p_to group by 1) x),
    'top_events', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'confirmed', n) order by n desc), '[]'::jsonb) from (select e.title, count(r.id) n from events e join registrations r on r.event_id = e.id and r.registration_status = 'confirmed' group by e.title order by n desc limit 5) x),
    'recent_activity', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from (select action, resource_type, resource_id, created_at from activity_logs order by created_at desc limit 8) a),
    'health', jsonb_build_object(
      'database', 'ok',
      'worker_last_seen', (select max(last_seen) from worker_heartbeats),
      'queue_queued', (select count(*) from queue_requests where status = 'queued'),
      'queue_processing', (select count(*) from queue_requests where status = 'processing'),
      'queue_failed', (select count(*) from queue_requests where status = 'failed'),
      'outbox_pending', (select count(*) from outbox_messages where status <> 'published'),
      'webhook_last_valid', (select max(received_at) from payment_notifications where signature_valid),
      'webhook_invalid_24h', (select count(*) from payment_notifications where not signature_valid and received_at > now() - interval '24 hours'),
      'stale_pending_tx', (select count(*) from transactions where transaction_status = 'pending' and coalesce(expiry_time, created_at + interval '1 hour') < now())))
  into v;
  return v;
end $$;

-- fungsi internal hanya boleh dipanggil service_role (server/worker), bukan browser
revoke execute on function public.request_registration_queue, public._reject_queue, public.reserve_quota, public.mark_queue_failed, public.claim_outbox, public.mark_outbox_published,
  public.mark_outbox_failed, public._issue_tickets, public.submit_registration_answers, public.prepare_payment, public.attach_snap, public.process_payment_notification,
  public.expire_reservations, public.stale_pending_transactions, public.admin_retry_queue, public.admin_save_event, public.admin_summary from public, anon, authenticated;
grant execute on function public.my_access() to authenticated;
