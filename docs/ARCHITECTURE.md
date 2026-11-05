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

4. KUOTA
Gunakan SELECT FOR UPDATE pada baris inventory atau conditional atomic UPDATE.
Di dalam transaction: validasi event/tiket, hitung kuota, buat reservation,
commit. Untuk kuota event sekaligus kuota kategori, kunci dan validasi keduanya
dengan urutan konsisten. Uji request paralel.

5. WORKER
Worker Node.js/TypeScript berjalan sebagai service/container di VPS. Gunakan
durable queue, persistent message, manual ack, prefetch terbatas, retry terbatas,
dead-letter queue, graceful shutdown, heartbeat, dan structured logs.
Vercel serverless bukan tempat menjalankan consumer persisten.

6. EXPIRY
Reservation memiliki expires_at. Job expiry hanya release jika status masih
reserved dan pembayaran belum paid. Operasi release dan confirm harus atomik.
Atur race antara expiry job dan webhook dengan row lock/state transition.

7. SECURITY
RLS aktif; authorization server-side; service_role dan Midtrans server key
hanya server-side; validasi input; rate limit; file upload validation; audit log;
secret tidak ditulis ke log; redirect internal divalidasi.

8. DEPLOYMENT
Astro ke Vercel; Supabase hosted; RabbitMQ dan worker ke VPS/container;
Midtrans webhook melalui Astro server endpoint atau Supabase Edge Function.
Pilih satu endpoint utama, jangan memproses notifikasi dua kali.
```
