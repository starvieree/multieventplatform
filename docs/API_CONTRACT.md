# API_CONTRACT

```text
BASE: /api/v1. HTTPS. JSON. Session Supabase diverifikasi server. User ID
diambil dari session, bukan body. Semua admin endpoint memeriksa permission.

FORMAT SUKSES:
{success:true,data:{...},meta:{...}}
FORMAT ERROR:
{success:false,error:{code:"...",message:"...",details:{}},request_id:"..."}

PUBLIC
GET /events?q=&category=&location=&date_from=&date_to=&price_type=&page=&limit=
GET /events/:slug
GET /event-categories
GET /blogs?page=&category=&q=
GET /blogs/:slug
POST /contact-messages
POST /partnership-applications

AUTH
Gunakan Supabase Auth sign-up/sign-in/sign-out/reset/verify. Astro memvalidasi
session pada route privat. Jangan membangun penyimpanan password sendiri.

PARTICIPANT
GET /me
PATCH /me
GET /me/registrations
GET /me/registrations/:id
POST /registrations/queue
Body: event_id, ticket_category_id, quantity, idempotency_key.
Server validasi session/event/kategori/periode/quantity, menyimpan request dan
menerbitkan message melalui outbox/publisher. Return 202 dan queue_request_id.
GET /queue-requests/:id
POST /registrations/:id/answers
POST /registrations/:id/payment-session
GET /registrations/:id/payment-status
GET /me/tickets
GET /me/tickets/:id
GET /me/notifications
PATCH /me/notifications/:id/read

MIDTRANS
POST /webhooks/midtrans
Validasi signature, order_id, gross_amount, transaction_id, status, keterkaitan
registration. Simpan notification dan update secara idempotent. Invalid webhook
tidak boleh mengubah transaksi.

ADMIN
GET /admin/dashboard/summary
GET/POST /admin/events (Body event menyertakan allow_multiple_categories boolean)
GET/PATCH /admin/events/:id
POST /admin/events/:id/publish
POST /admin/events/:id/archive
GET/POST /admin/event-categories
GET/PATCH /admin/event-categories/:id
GET /admin/participants
GET /admin/participants/:id
PATCH /admin/participants/:id/status
GET /admin/registrations
GET /admin/registrations/:id
POST /admin/registrations/:id/admin-adjustment
GET /admin/transactions
GET /admin/transactions/:id
GET /admin/transactions/:id/notifications
GET /admin/queues/overview
GET /admin/queues/requests
GET /admin/queues/dead-letter
POST /admin/queues/requests/:id/retry
POST /admin/queues/dead-letter/:id/requeue
GET/PATCH /admin/partnerships
GET/POST/PATCH /admin/blogs
GET/POST/PATCH /admin/banners
GET/PATCH /admin/contact-messages
GET/POST/PATCH /admin/admins
GET /admin/activity-logs
GET/PATCH /admin/settings
GET /admin/reports/registrations
GET /admin/reports/revenue
GET /admin/reports/queue

Tidak menyediakan endpoint umum untuk mengubah transaksi menjadi paid secara
manual. Adjustment harus memiliki permission, alasan, dan audit log.

HTTP STATUS & BUSINESS ERROR CODES
- 200: sukses
- 201: dibuat (created)
- 202: antrean pendaftaran diterima (accepted)
- 400: request invalid / format salah
- 401: unauthenticated (belum login)
- 403: forbidden (tidak ada izin)
- 404: data tidak ditemukan
- 409: conflict (kuota penuh, IDEMPOTENCY_CONFLICT, RESERVATION_EXPIRED, INVALID_STATE)
- 422: validasi bisnis gagal:
  * USER_LIMIT: Batas akumulasi pendaftaran tiket per akun tercapai (max_per_user).
  * CATEGORY_LIMIT: Event membatasi 1 kategori tiket per akun dan peserta sudah terdaftar di kategori lain.
  * REGISTRATION_CLOSED: Periode pendaftaran belum dibuka atau sudah ditutup.
  * INVALID_CATEGORY: Kategori tiket tidak aktif atau di luar periode penjualan.
  * QUOTA_FULL: Kuota tiket sudah habis.
  * QUOTA_BELOW_USED: Admin mencoba menurunkan kuota di bawah jumlah yang sudah terpakai.
- 429: rate limit terlampaui
- 500: error internal server
- 503: dependency eksternal tidak tersedia

IDEMPOTENCY & SIKLUS HIDUP ANTREAN
- Queue request key unik berbasis (user_id + idempotency_key).
- Mencegah klik ganda / reload berulang saat transaksi sedang aktif.
- Jika pendaftaran sebelumnya telah KEDALUWARSA (expired) atau DIBATALKAN (cancelled),
  sistem tidak akan mereplay pendaftaran yang mati tersebut. Browser mengirimkan
  kunci antrean baru (fresh UUID) sehingga peserta dapat mendaftar ulang secara bersih.
- Payment session Midtrans dan notifikasi webhook juga deduplicated idempotent.
```
