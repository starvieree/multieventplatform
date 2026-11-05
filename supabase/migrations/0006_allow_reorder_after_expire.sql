-- 0006_allow_reorder_after_expire.sql
-- Memastikan kuota dan pendaftaran kedaluwarsa otomatis dilepas secara real-time
-- dan peserta diizinkan mendaftar ulang jika pembayaran sebelumnya kedaluwarsa.

-- 1. Perbarui view event_listing agar selalu menghitung ketersediaan kuota secara real-time
create or replace view public.event_listing as
select e.id, e.slug, e.title, e.summary, e.poster_path, e.poster_alt, e.event_type, e.venue_name, e.address,
       e.start_at, e.end_at, e.registration_opens_at, e.registration_closes_at, e.status, e.total_quota, e.max_per_user,
       c.id as category_id, c.name as category_name, c.slug as category_slug,
       (select min(tc.price) from ticket_categories tc where tc.event_id = e.id and tc.is_active) as min_price,
       greatest(e.total_quota - coalesce((
         select sum(qr.quantity) from quota_reservations qr
         where qr.event_id = e.id
           and (qr.status = 'confirmed' or (qr.status = 'reserved' and qr.expires_at > now()))
       ), 0), 0) as available,
       e.allow_multiple_categories
from events e left join event_categories c on c.id = e.category_id
where e.status in ('published','registration_closed','ongoing','completed');

-- 2. Perbarui view ticket_availability agar ketersediaan per tiket juga real-time
create or replace view public.ticket_availability as
select tc.id as ticket_category_id, tc.event_id,
       greatest(least(
         tc.quota - coalesce((
           select sum(qr.quantity) from quota_reservations qr
           where qr.ticket_category_id = tc.id
             and (qr.status = 'confirmed' or (qr.status = 'reserved' and qr.expires_at > now()))
         ), 0),
         e.total_quota - coalesce((
           select sum(qr.quantity) from quota_reservations qr
           where qr.event_id = e.id
             and (qr.status = 'confirmed' or (qr.status = 'reserved' and qr.expires_at > now()))
         ), 0)
       ), 0) as available
from ticket_categories tc join events e on e.id = tc.event_id
where tc.is_active and e.status in ('published','registration_closed','ongoing');

-- 3. Perbarui fungsi reserve_quota agar hanya menghitung reservasi yang belum kedaluwarsa
create or replace function public.reserve_quota(p_queue_request_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare q queue_requests; ev events; tc ticket_categories; ev_taken int; tc_taken int; user_taken int; reg registrations; v_minutes int;
begin
  select * into q from queue_requests where id = p_queue_request_id for update;
  if not found then raise exception 'QUEUE_REQUEST_NOT_FOUND'; end if;
  if q.status in ('accepted','rejected','failed','expired') then
    return jsonb_build_object('status', q.status, 'error_code', q.error_code, 'registration_id', (select id from registrations where queue_request_id = q.id), 'replayed', true);
  end if;
  update queue_requests set status = 'processing', processing_started_at = coalesce(processing_started_at, now()) where id = q.id;
  select * into ev from events where id = q.event_id for update;
  select * into tc from ticket_categories where id = q.ticket_category_id for update;
  if ev.status <> 'published' or now() < ev.registration_opens_at or now() > ev.registration_closes_at or not tc.is_active then return _reject_queue(q.id, 'REGISTRATION_CLOSED'); end if;

  select coalesce(sum(quantity), 0) into ev_taken from quota_reservations where event_id = ev.id and (status = 'confirmed' or (status = 'reserved' and expires_at > now()));
  select coalesce(sum(quantity), 0) into tc_taken from quota_reservations where ticket_category_id = tc.id and (status = 'confirmed' or (status = 'reserved' and expires_at > now()));
  select coalesce(sum(r.quantity), 0) into user_taken from registrations r where r.user_id = q.user_id and r.event_id = ev.id and (r.registration_status = 'confirmed' or (r.registration_status in ('draft','awaiting_payment') and exists (select 1 from quota_reservations qr where qr.registration_id = r.id and qr.status = 'reserved' and qr.expires_at > now())));

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

-- 4. Perbarui request_registration_queue agar otomatis membersihkan pendaftaran kedaluwarsa & mengizinkan order baru
create or replace function public.request_registration_queue(p_user uuid, p_event uuid, p_category uuid, p_qty int, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_hash text; v_key text; q queue_requests; ev events; tc ticket_categories; v_user_taken int;
begin
  -- Proaktif: perbarui status reservasi kedaluwarsa
  perform public.expire_reservations();

  v_key := p_user::text || ':' || p_key;
  v_hash := encode(sha256(convert_to(p_event::text || p_category::text || p_qty::text, 'UTF8')), 'hex');

  select * into q from queue_requests where request_key = v_key;
  if found then
    -- Jika pendaftaran sebelumnya sudah expired / cancelled, jangan replay yang expired
    if exists (
      select 1 from registrations r
      where r.queue_request_id = q.id and r.registration_status in ('expired', 'cancelled')
    ) then
      null; -- izinkan membuat antrean baru
    else
      if q.payload_hash <> v_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      return jsonb_build_object('queue_request_id', q.id, 'status', q.status, 'replayed', true);
    end if;
  end if;

  if (select account_status from profiles where id = p_user) is distinct from 'active' then raise exception 'ACCOUNT_SUSPENDED'; end if;
  select * into ev from events where id = p_event and status = 'published';
  if not found or now() < ev.registration_opens_at or now() > ev.registration_closes_at then raise exception 'REGISTRATION_CLOSED'; end if;
  select * into tc from ticket_categories where id = p_category and event_id = p_event and is_active;
  if not found or (tc.sales_start_at is not null and now() < tc.sales_start_at) or (tc.sales_end_at is not null and now() > tc.sales_end_at) then raise exception 'INVALID_CATEGORY'; end if;

  -- Jika event TIDAK mengizinkan multi kategori (default: batasi 1 kategori per akun),
  -- pastikan user tidak memiliki pendaftaran AKTIF di kategori lain
  if not coalesce(ev.allow_multiple_categories, false) then
    if exists (
      select 1 from registrations r
      where r.user_id = p_user
        and r.event_id = p_event
        and r.ticket_category_id <> p_category
        and (
          r.registration_status = 'confirmed'
          or (
            r.registration_status in ('draft','awaiting_payment')
            and exists (
              select 1 from quota_reservations qr
              where qr.registration_id = r.id and qr.status = 'reserved' and qr.expires_at > now()
            )
          )
        )
    ) or exists (
      select 1 from queue_requests
      where user_id = p_user
        and event_id = p_event
        and ticket_category_id <> p_category
        and status in ('queued','processing')
    ) then
      raise exception 'CATEGORY_LIMIT';
    end if;
  end if;

  select * into q from queue_requests where user_id = p_user and event_id = p_event and status in ('queued','processing');
  if found then return jsonb_build_object('queue_request_id', q.id, 'status', q.status, 'replayed', true); end if;

  -- Hitung kuota yang sedang aktif dipakai user
  select coalesce(sum(r.quantity), 0) into v_user_taken from registrations r
  where r.user_id = p_user and r.event_id = p_event
    and (
      r.registration_status = 'confirmed'
      or (
        r.registration_status in ('draft','awaiting_payment')
        and exists (
          select 1 from quota_reservations qr
          where qr.registration_id = r.id and qr.status = 'reserved' and qr.expires_at > now()
        )
      )
    );
  if v_user_taken + p_qty > ev.max_per_user then raise exception 'USER_LIMIT'; end if;

  begin
    insert into queue_requests (request_key, idempotency_key, payload_hash, user_id, event_id, ticket_category_id, quantity)
    values (v_key, p_key, v_hash, p_user, p_event, p_category, p_qty) returning * into q;
  exception when unique_violation then
    select * into q from queue_requests where request_key = v_key or (user_id = p_user and event_id = p_event and status in ('queued','processing')) limit 1;
    if q.status in ('queued','processing') then
      return jsonb_build_object('queue_request_id', q.id, 'status', q.status, 'replayed', true);
    end if;
    -- Buat key unik baru jika key lama bentrok dengan pendaftaran yang sudah expired
    insert into queue_requests (request_key, idempotency_key, payload_hash, user_id, event_id, ticket_category_id, quantity)
    values (v_key || ':' || gen_random_uuid()::text, p_key, v_hash, p_user, p_event, p_category, p_qty) returning * into q;
  end;

  insert into outbox_messages (aggregate_type, aggregate_id, event_type, payload) values ('queue_request', q.id, 'registration.requested',
    jsonb_build_object('message_id', q.message_id, 'event_type', 'registration.requested', 'schema_version', 1, 'occurred_at', now(), 'correlation_id', gen_random_uuid(),
      'data', jsonb_build_object('queue_request_id', q.id, 'user_id', p_user, 'event_id', p_event, 'ticket_category_id', p_category, 'quantity', p_qty, 'idempotency_key', p_key)));
  return jsonb_build_object('queue_request_id', q.id, 'status', q.status, 'replayed', false);
end $$;

