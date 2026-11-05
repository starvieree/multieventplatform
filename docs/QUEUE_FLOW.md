# QUEUE_FLOW

```text
TUJUAN
RabbitMQ menampung dan mendistribusikan request pendaftaran. PostgreSQL tetap
sumber kebenaran kuota.

ALUR
1. Peserta POST /registrations/queue dengan event_id, ticket_category_id, quantity, idempotency_key (UUID baru per submit).
2. Astro server & database function request_registration_queue:
   a. Menjalankan auto-expire pendaftaran kedaluwarsa via expire_reservations().
   b. Memvalidasi session, status akun, periode event, dan status tiket.
   c. Memvalidasi aturan multi-kategori: jika allow_multiple_categories = false, tolak jika user telah memiliki pendaftaran aktif di kategori lain (CATEGORY_LIMIT).
   d. Memvalidasi batas tiket per akun: akumulasi tiket aktif + quantity tidak boleh melebihi max_per_user (USER_LIMIT).
3. Simpan queue_request dan outbox record dalam satu DB transaction.
4. Publisher mengirim persistent message ke durable RabbitMQ queue.
5. Worker menerima message manual-ack.
6. Worker validasi schema dan idempotency.
7. Worker memanggil PostgreSQL RPC reserve_quota untuk memeriksa dan mereservasi kuota.
8. RPC mengunci inventory (SELECT FOR UPDATE) pada event dan ticket_category.
9. Hanya menghitung kuota aktif (status = confirmed ATAU status = reserved dengan expires_at > now()).
10. Jika kuota tersedia, buat registration + quota_reservation (30 menit) dan status accepted.
11. Jika penuh, status rejected/full.
12. Commit database.
13. Ack message setelah hasil tersimpan.
14. Peserta membaca status melalui endpoint status antrean (/registration/queue/:id).

MESSAGE CONTOH
{
 "message_id":"uuid",
 "event_type":"registration.requested",
 "schema_version":1,
 "occurred_at":"ISO-8601",
 "correlation_id":"uuid",
 "data":{
   "queue_request_id":"uuid",
   "user_id":"uuid",
   "event_id":"uuid",
   "ticket_category_id":"uuid",
   "quantity":1,
   "idempotency_key":"string"
 }
}
Jangan masukkan password, secret, atau identitas sensitif yang tidak diperlukan.

QUEUE KONSEPTUAL
registration.requests
registration.retry
registration.dead
reservation.expiry

KONFIGURASI
Durable queue, persistent message, manual ack, prefetch terbatas, DLX,
retry/backoff, monitoring. Nilai retry/concurrency ditentukan dari pengujian.

ACK/RETRY
Ack setelah commit sukses.
Retry untuk error sementara dengan batas.
Dead-letter untuk payload invalid atau kegagalan permanen.
Hindari requeue tanpa batas.

CONCURRENCY
Beberapa consumer dapat memproses bersamaan. RabbitMQ tidak menjamin FIFO global
dalam semua konfigurasi. Database locking, atomic update, unique constraint,
dan idempotency wajib. Uji dua peserta memperebutkan satu kuota.

EXPIRY & REAL-TIME RE-REGISTRATION
- Reservation memiliki expires_at.
- View inventori publik (event_listing & ticket_availability) mengecek expires_at > now(),
  sehingga kuota yang kedaluwarsa seketika kembali ke publik tanpa delay.
- Background job memanggil expire_reservations() untuk menandai baris expired.
- Peserta yang transaksinya kedaluwarsa diperbolehkan membuat antrean baru dan
  mendaftar ulang secara bersih dengan fresh UUID.
- Operasi release dan confirm atomik, aman dari race condition dengan webhook.

MONITOR ADMIN
Queue ready/unacked, consumer count, throughput, redelivery, DLQ, worker heartbeat,
wait time, processing duration, failed requests, reservation expiry backlog.

TEST
Normal, duplicate request, concurrent last-seat, worker crash before commit,
crash after commit before ack, DB timeout, broker restart, invalid message,
retry exhaustion, expiry, webhook bersamaan dengan expiry.
```
