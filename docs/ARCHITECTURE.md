# ARCHITECTURE

```text
1. KOMPONEN
Astro: rendering, routing, UI, server endpoints/BFF, validasi, pemanggilan service.
Supabase: PostgreSQL, Auth, Storage, RLS, SQL functions/RPC.
RabbitMQ: broker dan distribusi message.
Worker TypeScript: consumer, idempotency, retry, reservation expiry.
Midtrans: payment API dan webhook.
Vercel: Astro hosting.
VPS/container: RabbitMQ dan worker persisten.

2. ALUR
Public read: Browser -> Astro -> Supabase -> PostgreSQL.
Auth: Browser/Astro -> Supabase Auth -> session; server memeriksa session dan role.
Registration: Browser -> Astro endpoint -> validasi -> queue request/outbox ->
RabbitMQ -> worker -> PostgreSQL RPC atomik -> status dibaca peserta.
Payment: Astro server -> Midtrans create transaction -> simpan transaksi ->
browser membuka pembayaran -> Midtrans webhook -> validasi -> PostgreSQL
transaction -> update payment/registration/reservation/ticket.

3. PRINSIP
- PostgreSQL sumber kebenaran data dan kuota.
- RabbitMQ bukan mekanisme locking kuota.
- Worker tidak menyimpan business state utama di memori.
- Semua proses dapat diulang dengan aman melalui idempotency.
- Operasi multi-tabel penting dilakukan dalam satu transaksi database.
- Gunakan unique constraint sebagai pertahanan terakhir terhadap duplikasi.
- Pertimbangkan transactional outbox agar penyimpanan request dan publish message
  dapat direkonsiliasi.
- Webhook diproses idempotent.
- Redirect browser bukan bukti pembayaran.

4. KUOTA & ATURAN KATEGORI (HIGH-CONCURRENCY TICKET WAR)
Gunakan SELECT FOR UPDATE pada baris inventory (event dan ticket_categories).
Di dalam transaction: validasi event/tiket, hitung kuota aktif (status = 'confirmed'
atau (status = 'reserved' AND expires_at > now())), validasi allow_multiple_categories,
buat reservation, commit. Untuk kuota event sekaligus kuota kategori, kunci dan
validasi keduanya dengan urutan konsisten.
Skalabilitas: Pada saat war tiket (contoh 1.000 peserta masuk bersamaan), RabbitMQ
menyerap antrean secara non-blocking. Worker memproses pesan secara paralel. Selama
kuota tersedia, sistem mengalokasikan slot sementara secara simultan ke peserta
(bukan antrean lambat 1-per-1). Peserta yang lolos mendapatkan jendela waktu 30 menit
untuk pembayaran.

5. FRONTEND & NAVIGASI MOBILE
Astro merender antarmuka publik responsif mobile-first. Navigasi menggunakan sticky
navbar terpadu dengan hamburger drawer menu (tanpa floating bottom bar). Seluruh tautan
utama ditata rata kiri, diikuti profil akun dan logout di bagian bawah drawer,
menghadirkan konsistensi visual modern dan ruang pandang viewport mobile yang optimal.

6. WORKER
Worker Node.js/TypeScript berjalan sebagai service/container di VPS. Gunakan
durable queue, persistent message, manual ack, prefetch terbatas, retry terbatas,
dead-letter queue, graceful shutdown, heartbeat, dan structured logs.
Vercel serverless bukan tempat menjalankan consumer persisten.

7. EXPIRY & RE-REGISTRASI
Reservation memiliki expires_at. View inventori menghitung sisa slot secara real-time
sehingga kuota kedaluwarsa seketika kembali ke pool publik tanpa jeda.
Job expiry dan fungsi request_registration_queue membersihkan baris expired.
Peserta yang reservasinya kedaluwarsa berhak mendaftar ulang secara bersih;
status expired tidak memblokir kuota akun peserta.
Operasi release dan confirm atomik melalui PostgreSQL row locks.

8. SECURITY
RLS aktif; authorization server-side; service_role dan Midtrans server key
hanya server-side; validasi input; rate limit; file upload validation; audit log;
secret tidak ditulis ke log; redirect internal divalidasi.

9. DEPLOYMENT
Astro ke Vercel; Supabase hosted; RabbitMQ dan worker ke VPS/container;
Midtrans webhook melalui Astro server endpoint atau Supabase Edge Function.
Pilih satu endpoint utama, jangan memproses notifikasi dua kali.
```
