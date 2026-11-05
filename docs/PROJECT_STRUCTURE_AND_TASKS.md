# PROJECT_STRUCTURE_AND_TASKS

```text
STRUKTUR REPOSITORY

multi-event-platform/
  apps/
    web/
      public/
      src/
        components/
          common/
          public/
          auth/
          participant/
          admin/
          seo/
        layouts/
        pages/
          events/
          blog/
          dashboard/
          registration/
          admin/
        lib/
          supabase/
          services/
          validations/
          utils/
        styles/
        types/
        middleware.ts
      astro.config.mjs
      package.json
    worker/
      src/
        consumers/
        publishers/
        services/
        messaging/
        jobs/
        utils/
        index.ts
      package.json
  supabase/
    migrations/
    functions/
      midtrans-webhook/
    tests/
    seed.sql
  infrastructure/
    docker/
      docker-compose.yml
  docs/
    PRD
    DESIGN_SECTION_TO_SECTION
    ARCHITECTURE
    DATABASE_SCHEMA
    API_CONTRACT
    QUEUE_FLOW
    PAYMENT_FLOW
    DEPLOYMENT
  .gitignore
  README

Catatan:
- Astro dan worker berbagi satu database dan business rules.
- Jangan membuat dua implementasi kuota yang berbeda.
- Gunakan SQL RPC untuk operasi atomik yang dipakai worker dan server.
- Worker terpisah karena perlu proses persisten; bukan backend web kedua.

PEMBAGIAN DEVELOPER

DEVELOPER 1 — ANTREAN DAN KUOTA
Fokus RabbitMQ, producer/consumer, queue request, idempotency, atomic quota
reservation, locking, reservation expiry, retry/DLX, monitoring antrean,
concurrency test, throughput, wait time, overselling.
Judul: "Implementasi Arsitektur Event-Driven untuk Pengelolaan Antrean dan
Konsistensi Kuota pada Sistem Pendaftaran Multi-Event."

DEVELOPER 2 — PEMBAYARAN
Fokus Midtrans create transaction, order ID, signature validation, webhook,
status mapping, payment idempotency, registration/payment consistency,
ticket issuance, reconciliation, payment test.
Judul: "Implementasi Payment Gateway Midtrans untuk Otomatisasi Konfirmasi dan
Konsistensi Transaksi pada Sistem Pendaftaran Multi-Event."

KERJA BERSAMA
Database inti, Auth/RLS, event, ticket category, registration state machine,
API contract, dashboard, Admin Panel, integration test, deployment.

URUTAN IMPLEMENTASI
1. Fondasi: repo, Astro, Supabase, migrations, Auth, RLS, layout.
2. Event: CRUD, kategori, tiket, katalog, detail.
3. Registration: form dinamis, model registration, queue request.
4. Queue: RabbitMQ, publisher, worker, atomic quota, retry, monitoring, test.
5. Payment: Midtrans sandbox, create transaction, webhook, idempotency, ticket.
6. Dashboard/admin: peserta, transaksi, queue, audit, reports.
7. Quality: security, RLS, concurrency, end-to-end, staging, deployment.

METRIK DEVELOPER 1
Throughput, queue wait, processing time, success/failure, retry, duplicate,
dead-letter, overselling count, reservation correctness.

METRIK DEVELOPER 2
Create transaction success, webhook latency, valid/invalid handling, duplicate
webhook, amount mismatch rejection, payment-registration consistency,
duplicate ticket count.

DEFINITION OF DONE
Implementasi, server validation, authorization/RLS, loading/error/empty states,
test relevan, audit untuk tindakan admin, dokumentasi terbarui, tidak ada secret
di repository/client bundle.
```
