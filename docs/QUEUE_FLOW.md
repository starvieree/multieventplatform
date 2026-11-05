# QUEUE_FLOW

```text
TUJUAN
RabbitMQ menampung dan mendistribusikan request pendaftaran. PostgreSQL tetap
sumber kebenaran kuota.

ALUR
1. Peserta POST /registrations/queue.
2. Astro server memvalidasi session, event, kategori, waktu, quantity, batas akun.
3. Simpan queue_request dan outbox record dalam satu DB transaction (disarankan).
4. Publisher mengirim persistent message ke durable RabbitMQ queue.
5. Worker menerima message manual-ack.
6. Worker validasi schema dan idempotency.
7. Worker memanggil PostgreSQL RPC untuk memeriksa dan mereservasi kuota.
8. RPC mengunci inventory atau menjalankan conditional atomic update.
9. Jika kuota tersedia, buat reservation dan status accepted.
10. Jika penuh, status rejected/full.
11. Commit database.
12. Ack message setelah hasil tersimpan.
13. Peserta membaca status melalui endpoint status antrean.

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

EXPIRY
Reservation punya expires_at. Job hanya release jika masih reserved dan belum
paid/confirmed. Operasi release atomik/idempotent. Atasi race dengan webhook.

MONITOR ADMIN
Queue ready/unacked, consumer count, throughput, redelivery, DLQ, worker heartbeat,
wait time, processing duration, failed requests, reservation expiry backlog.

TEST
Normal, duplicate request, concurrent last-seat, worker crash before commit,
crash after commit before ack, DB timeout, broker restart, invalid message,
retry exhaustion, expiry, webhook bersamaan dengan expiry.
```
