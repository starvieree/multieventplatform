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
GET/POST /admin/events
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

HTTP STATUS
200 sukses; 201 dibuat; 202 antrean diterima; 400 request invalid; 401 belum
login; 403 forbidden; 404 tidak ditemukan/tidak dapat diakses; 409 conflict/
kuota penuh/idempotency conflict; 422 validasi bisnis; 429 rate limit;
500 error server; 503 dependency tidak tersedia.

IDEMPOTENCY
Queue request key unik. Key sama + payload sama mengembalikan hasil lama.
Key sama + payload berbeda menghasilkan conflict. Payment session dan webhook
juga deduplicated. Gunakan unique constraint database.
```
