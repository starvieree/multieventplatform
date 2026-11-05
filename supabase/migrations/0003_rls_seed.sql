-- 0003_rls_seed.sql — RLS, hak akses tabel, seed role/permission/pengaturan.
-- Prinsip: browser hanya boleh SELECT data miliknya / data publik. Semua mutasi lewat server (service_role) atau RPC.

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- publik
grant select on public.event_categories, public.ticket_categories, public.event_form_fields, public.blogs, public.banners, public.event_listing, public.ticket_availability to anon, authenticated;
create policy cat_public on public.event_categories for select using (is_active);
create policy ticket_public on public.ticket_categories for select using (is_active and exists (select 1 from public.events e where e.id = event_id and e.status in ('published','registration_closed','ongoing','completed')));
create policy fields_auth on public.event_form_fields for select to authenticated using (is_active and exists (select 1 from public.events e where e.id = event_id and e.status = 'published'));
create policy blogs_public on public.blogs for select using (status = 'published' and published_at <= now());
create policy banners_public on public.banners for select using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at >= now()));

-- milik sendiri
grant select on public.profiles, public.user_roles, public.registrations, public.registration_answers, public.quota_reservations, public.queue_requests,
  public.transactions, public.tickets, public.notifications to authenticated;
grant update (full_name, phone, avatar_path) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy profiles_own_select on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_own_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy user_roles_own on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy reg_own on public.registrations for select to authenticated using (user_id = auth.uid());
create policy ans_own on public.registration_answers for select to authenticated using (exists (select 1 from public.registrations r where r.id = registration_id and r.user_id = auth.uid()));
create policy res_own on public.quota_reservations for select to authenticated using (exists (select 1 from public.registrations r where r.id = registration_id and r.user_id = auth.uid()));
create policy queue_own on public.queue_requests for select to authenticated using (user_id = auth.uid());
create policy tx_own on public.transactions for select to authenticated using (exists (select 1 from public.registrations r where r.id = registration_id and r.user_id = auth.uid()));
create policy tickets_own on public.tickets for select to authenticated using (exists (select 1 from public.registrations r where r.id = registration_id and r.user_id = auth.uid()));
create policy notif_own_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_own_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Tanpa policy (ditolak untuk browser): roles, permissions, role_permissions, events (dibaca lewat event_listing), partnerships, contact_messages,
-- payment_notifications, activity_logs, outbox_messages, app_settings, worker_heartbeats. Server memakai service_role setelah cek permission.

grant select on public.events to authenticated, anon;
create policy events_public on public.events for select using (status in ('published','registration_closed','ongoing','completed'));

-- seed
insert into public.roles (name, description) values ('participant', 'Peserta'), ('admin', 'Admin operasional'), ('super_admin', 'Super admin');
insert into public.permissions (code, description) values
  ('events.manage','Kelola event & tiket'),('categories.manage','Kelola kategori'),('participants.view','Lihat peserta'),('participants.suspend','Suspend/aktifkan peserta'),
  ('registrations.view','Lihat pendaftaran'),('registrations.adjust','Penyesuaian pendaftaran'),('transactions.view','Lihat transaksi'),('queues.view','Lihat antrean'),
  ('queues.manage','Retry/requeue antrean'),('partnerships.manage','Kelola partnership'),('blogs.manage','Kelola blog'),('banners.manage','Kelola banner'),
  ('messages.manage','Kelola pesan kontak'),('reports.view','Laporan & ekspor'),('admins.manage','Kelola admin & hak akses'),('audit.view','Lihat audit log'),('settings.manage','Kelola pengaturan');
insert into public.role_permissions select r.id, p.id from public.roles r cross join public.permissions p where r.name = 'super_admin';
insert into public.role_permissions select r.id, p.id from public.roles r join public.permissions p on p.code in
  ('events.manage','categories.manage','participants.view','registrations.view','transactions.view','queues.view','partnerships.manage','blogs.manage','banners.manage','messages.manage','reports.view')
  where r.name = 'admin';
insert into public.app_settings (key, value) values
  ('site', '{"name":"Platform Event","email":"halo@example.com","phone":"","address":"","instagram":""}'),
  ('reservation_minutes', '30'), ('default_max_per_user', '1'), ('timezone', '"Asia/Jakarta"'),
  ('policy', '{"cancellation":"Pendaftaran berbayar yang sudah dikonfirmasi tidak dapat dibatalkan sendiri; hubungi penyelenggara.","refund":"Kebijakan refund mengikuti ketentuan masing-masing event."}');
