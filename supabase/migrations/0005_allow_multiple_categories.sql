-- 0005_allow_multiple_categories.sql
-- Menambahkan opsi pembatasan 1 kategori per akun vs izinkan multi kategori per event

alter table public.events
  add column if not exists allow_multiple_categories boolean not null default false;

-- Perbarui view event_listing untuk menyertakan allow_multiple_categories di akhir kolom
create or replace view public.event_listing as
select e.id, e.slug, e.title, e.summary, e.poster_path, e.poster_alt, e.event_type, e.venue_name, e.address,
       e.start_at, e.end_at, e.registration_opens_at, e.registration_closes_at, e.status, e.total_quota, e.max_per_user,
       c.id as category_id, c.name as category_name, c.slug as category_slug,
       (select min(tc.price) from ticket_categories tc where tc.event_id = e.id and tc.is_active) as min_price,
       greatest(e.total_quota - coalesce((select sum(qr.quantity) from quota_reservations qr where qr.event_id = e.id and qr.status in ('reserved','confirmed')), 0), 0) as available,
       e.allow_multiple_categories
from events e left join event_categories c on c.id = e.category_id
where e.status in ('published','registration_closed','ongoing','completed');

-- Perbarui request_registration_queue untuk menegakkan aturan allow_multiple_categories
create or replace function public.request_registration_queue(p_user uuid, p_event uuid, p_category uuid, p_qty int, p_key text)
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

  -- Jika event TIDAK mengizinkan multi kategori (default: batasi 1 kategori per akun),
  -- pastikan user belum mendaftar di kategori lain pada event ini
  if not coalesce(ev.allow_multiple_categories, false) then
    if exists (
      select 1 from registrations
      where user_id = p_user
        and event_id = p_event
        and ticket_category_id <> p_category
        and registration_status in ('draft','awaiting_payment','confirmed')
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

-- Perbarui fungsi admin_save_event untuk menyimpan allow_multiple_categories
create or replace function public.admin_save_event(p_actor uuid, p_id uuid, p_event jsonb, p_tickets jsonb, p_fields jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; r jsonb; v_used int; v_tc_used int; v_keep uuid[] := '{}'; v_tcid uuid;
begin
  if v_id is null then
    insert into events (category_id, organizer_name, title, slug, summary, description, poster_path, banner_path, poster_alt, event_type, venue_name, address, online_url, timezone,
      start_at, end_at, registration_opens_at, registration_closes_at, total_quota, max_per_user, allow_multiple_categories, requirements, faq, meta_title, meta_description, og_image_path, created_by)
    values ((p_event ->> 'category_id')::uuid, p_event ->> 'organizer_name', p_event ->> 'title', p_event ->> 'slug', p_event ->> 'summary', p_event ->> 'description', p_event ->> 'poster_path',
      p_event ->> 'banner_path', p_event ->> 'poster_alt', coalesce(p_event ->> 'event_type', 'offline'), p_event ->> 'venue_name', p_event ->> 'address', p_event ->> 'online_url',
      coalesce(p_event ->> 'timezone', 'Asia/Jakarta'), (p_event ->> 'start_at')::timestamptz, (p_event ->> 'end_at')::timestamptz, (p_event ->> 'registration_opens_at')::timestamptz,
      (p_event ->> 'registration_closes_at')::timestamptz, (p_event ->> 'total_quota')::int, coalesce((p_event ->> 'max_per_user')::int, 1),
      coalesce((p_event ->> 'allow_multiple_categories')::boolean, false),
      p_event ->> 'requirements',
      coalesce(p_event -> 'faq', '[]'::jsonb), p_event ->> 'meta_title', p_event ->> 'meta_description', p_event ->> 'og_image_path', p_actor) returning id into v_id;
  else
    select coalesce(sum(quantity), 0) into v_used from quota_reservations where event_id = v_id and status in ('reserved','confirmed');
    if (p_event ->> 'total_quota')::int < v_used then raise exception 'QUOTA_BELOW_USED'; end if;
    update events set category_id = (p_event ->> 'category_id')::uuid, organizer_name = p_event ->> 'organizer_name', title = p_event ->> 'title', slug = p_event ->> 'slug',
      summary = p_event ->> 'summary', description = p_event ->> 'description', poster_path = p_event ->> 'poster_path', banner_path = p_event ->> 'banner_path', poster_alt = p_event ->> 'poster_alt',
      event_type = coalesce(p_event ->> 'event_type', event_type), venue_name = p_event ->> 'venue_name', address = p_event ->> 'address', online_url = p_event ->> 'online_url',
      timezone = coalesce(p_event ->> 'timezone', timezone), start_at = (p_event ->> 'start_at')::timestamptz, end_at = (p_event ->> 'end_at')::timestamptz,
      registration_opens_at = (p_event ->> 'registration_opens_at')::timestamptz, registration_closes_at = (p_event ->> 'registration_closes_at')::timestamptz,
      total_quota = (p_event ->> 'total_quota')::int, max_per_user = coalesce((p_event ->> 'max_per_user')::int, max_per_user),
      allow_multiple_categories = coalesce((p_event ->> 'allow_multiple_categories')::boolean, false),
      requirements = p_event ->> 'requirements',
      faq = coalesce(p_event -> 'faq', faq), meta_title = p_event ->> 'meta_title', meta_description = p_event ->> 'meta_description', og_image_path = p_event ->> 'og_image_path'
    where id = v_id;
  end if;

  -- Kategori tiket
  for r in select * from jsonb_array_elements(coalesce(p_tickets, '[]'::jsonb)) loop
    v_tcid := null;
    if (r ->> 'id') is not null and (r ->> 'id') <> '' then v_tcid := (r ->> 'id')::uuid; end if;
    if v_tcid is not null then
      select coalesce(sum(quantity), 0) into v_tc_used from quota_reservations where ticket_category_id = v_tcid and status in ('reserved','confirmed');
      if (r ->> 'quota')::int < v_tc_used then raise exception 'QUOTA_BELOW_USED'; end if;
      update ticket_categories set name = r ->> 'name', description = r ->> 'description', price = (r ->> 'price')::numeric,
        quota = (r ->> 'quota')::int, sales_start_at = (r ->> 'sales_start_at')::timestamptz, sales_end_at = (r ->> 'sales_end_at')::timestamptz,
        is_active = coalesce((r ->> 'is_active')::boolean, true) where id = v_tcid and event_id = v_id;
      v_keep := array_append(v_keep, v_tcid);
    else
      insert into ticket_categories (event_id, name, description, price, quota, sales_start_at, sales_end_at, is_active)
      values (v_id, r ->> 'name', r ->> 'description', (r ->> 'price')::numeric, (r ->> 'quota')::int,
        (r ->> 'sales_start_at')::timestamptz, (r ->> 'sales_end_at')::timestamptz, coalesce((r ->> 'is_active')::boolean, true))
      returning id into v_tcid;
      v_keep := array_append(v_keep, v_tcid);
    end if;
  end loop;

  -- Nonaktifkan tiket yang dihapus dari formulir bila ada pemakaian
  update ticket_categories set is_active = false where event_id = v_id and not (id = any(v_keep))
    and exists (select 1 from quota_reservations qr where qr.ticket_category_id = ticket_categories.id);
  delete from ticket_categories where event_id = v_id and not (id = any(v_keep))
    and not exists (select 1 from quota_reservations qr where qr.ticket_category_id = ticket_categories.id);

  -- Form fields
  delete from event_form_fields where event_id = v_id;
  for r in select * from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb)) loop
    insert into event_form_fields (event_id, field_key, label, field_type, options, is_required, sort_order)
    values (v_id, r ->> 'field_key', r ->> 'label', r ->> 'field_type', coalesce(r -> 'options', '[]'::jsonb),
      coalesce((r ->> 'is_required')::boolean, false), coalesce((r ->> 'sort_order')::int, 0));
  end loop;

  return v_id;
end $$;
