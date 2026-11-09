# DATABASE_SCHEMA

```text
Semua primary key UUID; timestamp gunakan timestamptz UTC. Rancangan berikut
perlu diwujudkan sebagai SQL migrations dan diuji.

1. profiles
id PK/FK auth.users.id, full_name, phone, avatar_path, account_status,
created_at, updated_at. Password dikelola Supabase Auth.

2. roles
id, name unique (participant/admin/super_admin), description.

3. user_roles
id, user_id FK profiles, role_id FK roles, assigned_by, created_at;
unique(user_id, role_id).

4. permissions
id, code unique, description.

5. role_permissions
role_id FK, permission_id FK; composite primary key.

6. event_categories
id, name, slug unique, description, icon, is_active, timestamps.

7. events
id, category_id FK, organizer_name, title, slug unique, summary, description,
poster_path, banner_path, poster_alt, event_type, venue_name, address, online_url,
start_at, end_at, registration_opens_at, registration_closes_at, total_quota,
max_per_user, allow_multiple_categories boolean default false, requirements,
faq JSONB, meta_title, meta_description, og_image_path, status, created_by, timestamps.
Status draft/published/registration_closed/ongoing/completed/archived.
Check quota >= 0 dan end_at >= start_at.
allow_multiple_categories: jika false (default), akun dibatasi 1 kategori tiket
per event. Jika true, akun diizinkan mendaftar lebih dari 1 kategori tiket (multi-track).

8. ticket_categories
id, event_id FK, name, description, price numeric, quota, sales_start_at,
sales_end_at, max_per_user, is_active, timestamps. Check price/quota >= 0.

9. event_form_fields
id, event_id FK, field_key, label, field_type, options JSONB, is_required,
sort_order, validation_rules JSONB, is_active. Unique(event_id, field_key).

10. registrations
id, registration_code unique, user_id FK, event_id FK, ticket_category_id FK,
queue_request_id, quantity, subtotal, total_amount, registration_status,
payment_status, created_at, updated_at, confirmed_at.
Status registration dipisah dari payment. Check quantity > 0 dan amount >= 0.

11. registration_answers
id, registration_id FK, field_key, field_label_snapshot, answer JSONB, created_at.
Unique(registration_id, field_key).

12. queue_requests
id, request_key unique, user_id, event_id, ticket_category_id, quantity, status,
message_id unique nullable, retry_count, error_code, error_message, queued_at,
processing_started_at, processed_at, timestamps.

13. quota_reservations
id, registration_id FK, event_id FK, ticket_category_id FK, quantity, status,
reserved_at, expires_at, confirmed_at, released_at, release_reason.
Status reserved/confirmed/released/expired. Index event/status/expires_at.

14. transactions
id, registration_id FK, order_id unique, provider, provider_transaction_id,
gross_amount, currency, payment_type, transaction_status, fraud_status,
transaction_time, expiry_time, paid_at, raw_status, timestamps.
Jangan menyimpan credential provider.

15. payment_notifications
id, transaction_id FK nullable, provider, notification_key unique nullable,
order_id, provider_transaction_id, received_at, signature_valid,
processing_status, status_code, payload_redacted JSONB, processing_error.

16. tickets
id, registration_id FK, ticket_code unique, attendee_name, status, issued_at,
checked_in_at, metadata JSONB.

17. blogs
id, title, slug unique, excerpt, content, thumbnail_path, category, author_id,
author_name, reading_time, status, published_at, meta_title, meta_description, timestamps.
Status draft/published/archived. Menyimpan konten wawasan, panduan tiket, dan cerita event.

18. partnerships
id, organization_name, contact_name, email, phone, organization_type, website,
description, attachment_path, status, internal_note, timestamps.

19. contact_messages
id, name, email, subject, message, status, assigned_admin_id, timestamps.

20. banners
id, title, description, image_path, mobile_image_path, alt_text, cta_label,
cta_url, starts_at, ends_at, sort_order, is_active, timestamps.

21. notifications
id, user_id FK, title, body, type, related_type, related_id, read_at, created_at.

22. activity_logs
id, actor_user_id, actor_type, action, resource_type, resource_id, before_data,
after_data, reason, request_id, created_at. Lindungi dari update/delete biasa.

23. outbox_messages (disarankan)
id, aggregate_type, aggregate_id, event_type, payload JSONB, status, attempts,
available_at, published_at, created_at.

RELASI
profiles 1:N registrations; events 1:N registrations; events 1:N ticket_categories;
events 1:N event_form_fields; registrations 1:N answers/reservations/transactions;
transactions 1:N payment_notifications; registrations 1:N tickets.
profiles M:N roles melalui user_roles; roles M:N permissions.

KUOTA & REAL-TIME INVENTORY
- available = total_quota - (confirmed + (reserved AND expires_at > now()))
- View publik:
  * event_listing: menghitung sisa slot event secara real-time.
  * ticket_availability: menghitung sisa slot per kategori tiket secara real-time.
- Self-Healing: Begitu reservasi lewat dari batas waktu (expires_at < now()),
  kuota otomatis kembali ke publik detik itu juga tanpa harus menunggu cron worker.
- Proaktif cleanup: fungsi request_registration_queue otomatis memanggil
  expire_reservations() untuk memperbarui baris kedaluwarsa.
- Re-registration: Pendaftaran berstatus expired/cancelled tidak dihitung ke
  dalam USER_LIMIT maupun CATEGORY_LIMIT, sehingga peserta dapat mendaftar ulang
  selama kuota publik masih tersedia.

RLS
profiles: user baca/update sendiri.
registrations/answers: user hanya data miliknya.
transactions/tickets: hanya pemilik dapat membaca.
events/blog published: publik dapat membaca.
Mutasi event/blog: admin dengan permission.
payment_notifications, queue internals, activity_logs: akses terbatas.
Role tidak dapat diubah peserta.
Status payment tidak dapat diubah client.
```
