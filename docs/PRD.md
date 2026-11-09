# PRD

```text
PLATFORM PENDAFTARAN MULTI-EVENT

1. LATAR BELAKANG
Platform mengelola banyak event dalam satu website. Sistem dirancang untuk
mengatasi lonjakan pendaftaran, menjaga kuota agar tidak oversold, dan
mengotomatisasi konfirmasi pembayaran. Proses lama menggunakan QRIS statis,
unggah bukti transfer, dan pemeriksaan manual. Masalah yang terjadi: peserta
dapat keluar saat membayar, kembali ke beranda, kehilangan konteks pendaftaran,
tidak dapat melanjutkan unggah bukti, dan berpotensi mengulang pendaftaran.

2. TUJUAN
- Menyediakan katalog dan pendaftaran multi-event.
- Mengelola antrean menggunakan RabbitMQ.
- Menjaga kuota melalui transaksi atomik PostgreSQL Supabase.
- Mengotomatisasi pembayaran dan konfirmasi melalui Midtrans webhook.
- Menyediakan dashboard peserta dan Admin Panel.
- Menyediakan monitoring antrean, transaksi, kuota, dan audit aktivitas.

3. STACK
- Astro: website publik, autentikasi UI, dashboard peserta, Admin Panel, server
  endpoints/BFF.
- Supabase: PostgreSQL, Auth, Storage, RLS, database functions/RPC.
- RabbitMQ: message broker antrean pendaftaran.
- Worker Node.js/TypeScript: consumer RabbitMQ dan pekerjaan latar belakang.
- Midtrans: payment gateway dan notifikasi webhook.
- Vercel: deployment Astro.
- VPS/container: RabbitMQ dan worker persisten.

4. PENGGUNA
Pengunjung: melihat event, blog, informasi, mengirim kontak/partnership.
Peserta: mengelola profil, antrean, pendaftaran, pembayaran, tiket.
Admin: mengelola event, peserta, pendaftaran, transaksi, antrean, konten, laporan.
Super Admin: mengelola admin, permission, konfigurasi, dan integrasi.

5. FITUR
Publik:
- Header Navigasi Adaptif:
  * Desktop: Sticky navbar dengan logo, link menu utama (Beranda, Tentang, Event dropdown, Partnership, Blog, Kontak), shortcut pesanan & popover notifikasi, dan menu profil / tombol autentikasi.
  * Mobile: Navbar atas dengan logo, shortcut pesanan aktif, dan tombol hamburger drawer menu. Seluruh menu utama tertata rata kiri, bagian profil di bagian bawah drawer, dan tombol logout di posisi paling bawah. Floating bottom navigation ditiadakan demi kenyamanan visual dan area pandang layar sentuh yang lebih luas.
- Beranda, Tentang, Event, Detail Event, Partnership.
- Blog & Wawasan: Artikel seputar war tiket, AI, promotor, dan panduan event lengkap dengan kartu utama (lead article), grid artikel responsif, pencarian, dan filter kategori berbasis database Supabase.
- Kontak: Informasi dan formulir pengiriman pertanyaan/bantuan dengan FormField placeholder type-safe.
- Login, Register, Forgot Password, Reset Password.
- Privacy Policy dan Terms.

Peserta:
- Pesanan & Transaksi (/pesanan, /pesanan/:id) dengan pemantauan keranjang aktif.
- Tiket Saya (/tiket-saya, /tiket-saya/:id) lengkap dengan QR Code e-ticket.
- Profil (/profil) dan Keamanan Akun (/profil/security).
- Notifikasi (/notifikasi).
- Alur Pendaftaran & Antrean:
  * Antrean (/registration/queue/:id): Menampung lonjakan ribuan request serentak ke RabbitMQ, mengalokasikan slot sementara (temporary reservation) secara paralel hingga batas kuota yang tersedia.
  * Formulir Dinamis (/registration/:id/form): Pengisian data peserta dengan batas waktu reservasi 30 menit.
  * Pembayaran Snap (/registration/:id/payment): Integrasi Midtrans Snap otomatis tanpa unggah bukti transfer manual.
  * Status Pendaftaran (/registration/:id/status): Visualisasi real-time status transaksi dan tiket terbit.

Admin:
- Dashboard statistik.
- CRUD Event dan Kategori.
- Peserta dan Pendaftaran.
- Transaksi Midtrans.
- Monitoring RabbitMQ dan kuota.
- Partnership, Blog, Banner, Pesan Kontak.
- Laporan, Admin/Permission, Audit Log, Pengaturan.

6. ALUR AS-IS
Pilih event -> isi identitas -> tampil QRIS statis -> peserta membayar melalui
aplikasi -> kembali ke website -> unggah bukti -> admin memeriksa -> valid:
peserta terdaftar; tidak valid: bukti ditolak.
Tambahkan cabang peserta meninggalkan website dan kembali diarahkan ke beranda,
sehingga tidak dapat melanjutkan unggah bukti. Jika mengulang, identitas
transaksi/QRIS dapat berbeda. As-Is tetap QRIS statis dan pemeriksaan manual;
jangan masukkan Midtrans.

7. ALUR TO-BE
Pilih event -> login -> request antrean -> RabbitMQ -> worker -> database
memeriksa dan mereservasi kuota secara atomik -> peserta mengisi formulir ->
backend membuat transaksi Midtrans -> peserta membayar -> Midtrans webhook ->
backend validasi signature/order/nominal/status -> database memperbarui transaksi
dan pendaftaran secara idempotent -> tiket diterbitkan.
Jika kuota habis, request ditolak. Jika pembayaran gagal/expired, reservasi
dilepaskan sesuai state dan kebijakan. Tidak ada upload bukti transfer.

8. ATURAN BISNIS
- Setiap event memiliki slug, jadwal, periode pendaftaran, kuota, status.
- Event dapat memiliki beberapa kategori tiket dengan harga/kuota tersendiri.
- Event status: draft, published, registration_closed, ongoing, completed,
  archived.
- Queue status: queued, processing, accepted, rejected, failed, expired.
- Reservation status: reserved, confirmed, released, expired.
- Registration status: draft, awaiting_payment, confirmed, cancelled, expired.
- Payment status: pending, paid, failed, expired, cancelled, refunded.
- Status event, antrean, reservasi, pendaftaran, pembayaran harus terpisah.
- Pembatasan Kategori Tiket: Setiap event memiliki flag allow_multiple_categories.
  Jika false (default), akun hanya boleh mendaftar 1 kategori tiket per event.
  Jika true, akun diizinkan mendaftar lebih dari 1 kategori tiket (multi-track).
- Batas akumulasi tiket per akun tetap dibatasi oleh max_per_user.
- Kuota tersedia dihitung dinamis secara real-time:
  available = total - confirmed - (reserved aktif di mana expires_at > now()).
- Pelepasan Kuota & Re-registrasi: Saat batas waktu pembayaran/reservasi habis,
  kuota otomatis kembali ke publik secara real-time, dan peserta yang kedaluwarsa
  diizinkan untuk mendaftar ulang selama kuota masih tersedia.
- Perubahan reserved menjadi confirmed tidak boleh dihitung dua kali.
- Event gratis (total_amount = 0) langsung confirmed dan terbit tiket tanpa Midtrans.
- Request antrean, transaksi, webhook, dan penerbitan tiket harus idempotent.
- Nominal pembayaran dihitung backend dari database, bukan dipercaya dari browser.
- Browser redirect bukan bukti pembayaran.
- Admin tidak boleh mengubah transaksi menjadi paid tanpa verifikasi backend.
- Peserta hanya dapat membaca/mengubah data miliknya.
- Data sensitif dan secret tidak boleh masuk log atau bundle browser.

9. KEBUTUHAN NON-FUNGSIONAL
Keamanan: Auth, RLS, permission, validasi server, rate limit, secret management.
Konsistensi: atomic quota, transaction, unique constraint, idempotency.
Ketersediaan: durable message, retry, DLQ, worker restart.
Performa: pagination, index, monitoring latency/throughput.
Maintainability: pemisahan UI, service, worker, database migration.
SEO: metadata, canonical, sitemap, robots, structured data untuk halaman publik.
Responsiveness dan accessibility pada desktop/mobile.

10. KRITERIA PENERIMAAN
- Login mengembalikan peserta ke event yang dipilih.
- Klik daftar berulang tidak membuat antrean ganda.
- Dua request tidak dapat mengambil kuota terakhir bersamaan.
- Message duplikat tidak membuat reservasi/pendaftaran ganda.
- Worker restart tidak menghilangkan pesan durable yang belum selesai.
- Webhook invalid tidak mengubah transaksi.
- Webhook duplikat tidak membuat tiket ganda.
- Peserta hanya melihat data sendiri.
- Semua tindakan admin penting tercatat.
- Tidak ada upload bukti pada alur To-Be.

11. METRIK EVALUASI
Queue wait time, processing time, throughput, success/failure rate, retry,
duplicate handling, dead-letter count, overselling count, webhook latency,
webhook valid/invalid, dan konsistensi status transaksi.
```
