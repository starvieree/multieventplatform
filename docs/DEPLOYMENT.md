# DEPLOYMENT

```text
ENVIRONMENT
Development: Astro lokal, Supabase dev/local, RabbitMQ Docker, worker lokal,
Midtrans Sandbox.
Staging: project Supabase dan broker terpisah, domain staging, sandbox.
Production: Astro Vercel, Supabase production, RabbitMQ/worker VPS, Midtrans
Production. Jangan mencampur credential antar environment.

ENV EXAMPLE WEB (server-only kecuali PUBLIC)
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MIDTRANS_SERVER_KEY=
MIDTRANS_CLIENT_KEY=
MIDTRANS_IS_PRODUCTION=false
RABBITMQ_URL=

ENV WORKER
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
RABBITMQ_URL=
WORKER_CONCURRENCY=
LOG_LEVEL=

Jangan commit .env. Service role, Midtrans server key, dan RabbitMQ URL tidak
boleh masuk browser bundle.

ASTRO
Gunakan SSR/server output untuk route session/private. Pasang adapter Vercel
sesuai versi Astro. Set environment variables. Pastikan cookie/session, auth
redirect URL, dan webhook endpoint benar. Route admin harus punya authorization
server-side, bukan hanya menyembunyikan menu.

SUPABASE
Pisahkan project dev/staging/prod. Terapkan SQL migrations berurutan. Aktifkan
RLS dan policy. Buat Storage bucket dan policy. Atur Auth Site URL/redirect.
Atur email provider bila diperlukan. Backup dan retention. Jangan ubah schema
production secara manual tanpa migration.

RABBITMQ
Jalankan VPS/container dengan persistent volume, user khusus, durable queues,
persistent messages, DLX, retry. Batasi management port. Gunakan TLS bila
melewati jaringan tidak tepercaya. Monitor disk/memory alarm.

WORKER
Build TypeScript. Jalankan sebagai service/container dengan restart policy,
graceful shutdown, health check, heartbeat, structured logging, prefetch dan
concurrency terukur. Worker harus menangani disconnect/reconnect.

MIDTRANS
Gunakan Sandbox sebelum Production. Set webhook HTTPS, callback/redirect,
server key aman. Webhook harus dapat diakses provider dan memvalidasi signature.

CI/CD
Install -> lint -> typecheck -> unit test -> integration test -> build Astro ->
build worker -> deploy staging -> smoke test -> approval -> production.
Migration dilakukan terkontrol dan kompatibel.

MONITORING
Astro: error rate, response time, deploy.
Supabase: query latency, connections, Auth/RLS errors, storage.
RabbitMQ: ready/unacked, consumers, redelivery, DLQ, memory/disk.
Worker: heartbeat, latency, retry, crash.
Payment: create transaction failures, webhook valid/invalid, pending lama,
status mismatch, reconciliation.

CHECKLIST GO LIVE
[ ] RLS diuji.
[ ] Service role tidak ada di client.
[ ] Admin authorization server-side.
[ ] Queue durable dan message persistent.
[ ] Worker auto restart.
[ ] Kuota diuji concurrent.
[ ] Queue idempotency diuji.
[ ] Expiry race diuji.
[ ] Midtrans sandbox berhasil.
[ ] Signature webhook diuji.
[ ] Duplicate webhook diuji.
[ ] Amount mismatch ditolak.
[ ] Redirect tidak menjadi sumber status.
[ ] Backup dan restore diuji.
[ ] Log bebas secret.
[ ] HTTPS, domain, callback, Auth redirect benar.
```
