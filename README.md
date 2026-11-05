# Platform Pendaftaran Multi-Event

Website lengkap (bukan landing page) sesuai 9 dokumen di `docs/`: katalog event, pendaftaran lewat antrean, pembayaran Midtrans, dashboard peserta, dan Admin Panel.
Desain mengikuti gaya **Software** (Host Grotesk + Instrument Sans, biru `#074ce0`, dua area gelap) — token ada di `apps/web/src/styles/global.css`.

## Stack
| Lapisan | Teknologi | Lokasi |
|---|---|---|
| Web (SSR) + API | Astro 5, `@astrojs/vercel` | `apps/web` |
| Database, Auth, Storage | Supabase (PostgreSQL + RLS) | `supabase/migrations` |
| Antrean | RabbitMQ (DLX + retry TTL) + transactional outbox | `apps/worker`, `infrastructure/docker` |
| Pembayaran | Midtrans Snap + webhook | `apps/web/src/lib/utils/midtrans.ts` |

## Menjalankan
1. Buat project Supabase, jalankan `supabase/migrations/0001…0004` berurutan (SQL editor atau `supabase db push`).
2. Salin `apps/web/.env.example` dan `apps/worker/.env.example` menjadi `.env`, isi nilainya.
3. `npm install` di root, lalu `npm run dev:web`.
4. Worker (VPS): `cd infrastructure/docker && RABBITMQ_PASS=... docker compose up -d --build`.
5. Jadikan akun pertama super admin (setelah akun itu mendaftar):
   ```sql
   insert into user_roles (user_id, role_id)
   select p.id, r.id from profiles p, roles r where p.email = 'anda@contoh.com' and r.name = 'super_admin';
   ```
6. Di dashboard Midtrans, isi Payment Notification URL: `https://DOMAIN/api/v1/webhooks/midtrans`.
7. Wajib sebelum go-live: `npm run test:concurrency -w apps/worker` (uji kuota terakhir) dan uji sandbox Midtrans (settlement, expire, deny, notifikasi ganda).

## Peta dokumen → implementasi
| Dokumen | Implementasi |
|---|---|
| PRD, DESIGN | Halaman publik `pages/*`, dashboard `pages/dashboard`, alur `pages/registration`, admin `pages/admin/dashboard` |
| ARCHITECTURE | Outbox (`outbox_messages`) → `apps/worker/src/publishers/outbox.ts` → RabbitMQ → `consumers/registration.ts` → RPC `reserve_quota` |
| DATABASE_SCHEMA | `0001_schema.sql` (23 tabel + `app_settings`, `worker_heartbeats`), `0003_rls_seed.sql` (RLS) |
| API_CONTRACT | `apps/web/src/pages/api/v1/**` (format `{success,data,meta}` / `{success:false,error,request_id}`) |
| QUEUE_FLOW | `0002_functions.sql` (`request_registration_queue`, `reserve_quota`), `apps/worker` |
| PAYMENT_FLOW | `prepare_payment`, `process_payment_notification`, `expire_reservations`, job rekonsiliasi |
| DEPLOYMENT | `docker-compose.yml`, `Dockerfile`, `.github/workflows/ci.yml`, `.env.example` |

## Keamanan yang diterapkan
- **AuthN/AuthZ:** sesi Supabase di cookie httpOnly; middleware memverifikasi `getUser()`; `/admin` tidak terlihat oleh non-admin (404); izin granular per resource (`has permission`) dicek di server pada setiap API dan halaman admin.
- **RLS:** peserta hanya `SELECT` data miliknya; tidak ada policy tulis untuk browser kecuali `profiles`(nama/telepon) dan `notifications.read_at`. `service_role` hanya di server/worker.
- **Kuota & uang:** nominal selalu dari database; kuota dihitung di PostgreSQL dengan lock `event → kategori`; tidak ada jalur API/admin untuk memaksa status `paid`.
- **Webhook:** signature SHA-512 (constant-time), cek nominal & ID transaksi, dedupe `notification_key`, status final tidak bisa mundur, payload disimpan tanpa data sensitif; notifikasi ber-signature invalid tidak memblokir notifikasi asli.
- **Idempotensi:** `request_key` unik per user, hash payload (409 bila berbeda), satu antrean aktif per user+event, satu transaksi pending per registrasi, `reserve_quota` aman dipanggil ulang.
- **Web:** CSP ketat (tanpa inline script), HSTS, `X-Frame-Options`, `nosniff`, Referrer/Permissions-Policy; cek `Origin` untuk semua API mutasi; validasi zod; `safeRedirect`; rate limit; honeypot form publik; markdown disanitasi; unggah gambar divalidasi magic-bytes; CSV ekspor anti-formula-injection; audit log append-only (trigger); error tanpa stack/secret + `request_id`.
- **Auth:** pesan login/lupa sandi/daftar generik (anti user-enumeration); akun ditangguhkan ditolak di login, RPC antrean, dan Supabase Auth (ban).

## Keputusan yang saya asumsikan (`docs/DECISIONS_TO_CONFIRM.md`) — silakan koreksi
Kuota dua level (total event + per kategori, keduanya dijaga); satu pendaftaran = satu kategori × jumlah (maks `max_per_user`, default 1 per akun); reservasi 30 menit (ubah di Pengaturan); setelah expired boleh daftar ulang bila kuota ada; event gratis langsung `confirmed` setelah formulir; admin boleh ubah kuota tetapi tidak di bawah reserved+confirmed; peserta tidak melihat nomor urut antrean (hanya status); tiket v1 berupa kode (tanpa QR); webhook lewat endpoint Astro; penyelenggara tunggal (organizer = teks).

## Penyimpangan dari dokumen (sengaja)
- Web tidak membuka koneksi AMQP (Vercel serverless): antrean dipublikasikan **worker** dari outbox. `RABBITMQ_URL` hanya untuk worker. Worker juga butuh `MIDTRANS_SERVER_KEY` untuk rekonsiliasi.
- Queue `reservation.expiry` diganti job terjadwal di worker (`expire_reservations`) — hasil sama, komponen lebih sedikit.
- Lampiran pada form partnership belum ada (v1.1). Endpoint status event digabung: `POST /admin/events/:id/status`.
- Rate limit bersifat per-instance; untuk produksi multi-instance tambahkan Vercel WAF/Upstash.
- Saya tidak dapat menjalankan `npm install`/build di lingkungan ini. Kode sudah lolos pengecekan sintaks, tetapi **jalankan `npm run typecheck && npm test && npm run build` dulu** dan perbaiki bila ada selisih versi paket.

## Checklist go-live singkat
Migrasi berjalan · RLS diverifikasi dengan akun peserta lain · super admin dibuat · env produksi (key Midtrans production, `MIDTRANS_IS_PRODUCTION=true`) · webhook URL terpasang · worker + RabbitMQ aktif dan heartbeat terlihat di dashboard admin · uji konkurensi lulus · uji sandbox pembayaran lulus · backup Supabase aktif · port RabbitMQ tidak terbuka publik.
