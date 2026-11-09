# DECISIONS_TO_CONFIRM (STATUS: FINAL & TERKONFIRMASI)

```text
STATUS KEPUTUSAN ARSITEKTUR & ATURAN BISNIS

1. Kuota hanya di level event atau juga per kategori tiket?
   STATUS: TERKONFIRMASI.
   Keduanya membatasi (two-tier inventory). Validasi kuota event dan kategori tiket
   dijalankan atomik dalam satu transaksi PostgreSQL (SELECT FOR UPDATE).

2. Satu registration boleh berisi beberapa peserta/tiket?
   STATUS: TERKONFIRMASI.
   Satu pendaftaran dapat memilih quantity tiket (1 s.d. max_per_user).

3. Satu akun boleh mendaftar berapa kali untuk event yang sama & berapa kategori tiket?
   STATUS: TERKONFIRMASI (Opsi 2 - Fleksibel per Event).
   Default: 1 akun dibatasi hanya boleh mendaftar 1 kategori tiket (allow_multiple_categories = false)
   untuk mencegah penimbunan dan calo tiket (cocok untuk seminar, konser).
   Admin dapat mengaktifkan allow_multiple_categories = true jika event memiliki sesi paralel/multi-track/workshop.
   Batas akumulasi tiket per akun tetap dibatasi oleh max_per_user.

4. Berapa lama reservation berlaku?
   STATUS: TERKONFIRMASI.
   Default 30 menit (dikonfigurasi via app_settings 'reservation_minutes').

5. Setelah transaksi expired, apakah peserta boleh membuat transaksi baru?
   STATUS: TERKONFIRMASI.
   YA, 100% DIPERBOLEHKAN. Begitu pembayaran/reservasi kedaluwarsa, kuota langsung
   kembali ke publik, pendaftaran lama berstatus expired, dan peserta diizinkan
   mendaftar ulang dengan kunci baru selama kuota masih tersedia.

6. Apakah event gratis langsung confirmed setelah form dan reservasi valid?
   STATUS: TERKONFIRMASI.
   YA. Jika total_amount = 0, pendaftaran langsung terbit tiket (confirmed)
   tanpa melalui pembayaran Midtrans.

7. Apakah admin boleh mengubah kuota saat pendaftaran sedang berlangsung?
   STATUS: TERKONFIRMASI.
   Boleh menaikkan kuota kapan saja; dilarang menurunkan kuota di bawah jumlah
   tiket yang sudah direservasi/terkonfirmasi (QUOTA_BELOW_USED).

8. Apakah posisi antrean ditampilkan atau hanya status?
   STATUS: TERKONFIRMASI.
   Status antrean ditampilkan secara real-time (queued -> processing -> accepted/rejected/failed).

9. Portal Peserta vs Admin Dashboard:
   STATUS: TERKONFIRMASI.
   Dipisahkan total.
   - Portal Peserta: /pesanan, /tiket-saya, /profil, /notifikasi.
   - Admin Panel: /admin/dashboard/* (hanya untuk pengguna dengan role admin/super_admin).
   - Rute legacy /dashboard/* untuk peserta diarahkan HTTP 301 ke /pesanan atau /tiket-saya.

10. Apakah QR ticket/check-in termasuk versi pertama?
    STATUS: TERKONFIRMASI.
    E-Ticket terbit dengan ticket_code unik dan QR Code dinamis berbasis SVG di /tiket-saya/:id.

11. Webhook Midtrans:
    STATUS: TERKONFIRMASI.
    Menggunakan Astro server endpoint /api/v1/webhooks/midtrans dengan validasi
    SHA-512 signature, deduplikasi idempotent, dan audit logging.

12. Desain Navigasi Versi Mobile (Bottom Nav vs Hamburger Drawer):
    STATUS: TERKONFIRMASI.
    Menggunakan model Hamburger Drawer di top navbar. Teks navigasi mempertahankan
    label asli (Beranda, Tentang, Event, Partnership, Blog, Kontak) dan ditata rata kiri.
    Profil pengguna diposisikan di bagian bawah drawer, dan tombol Logout di posisi paling bawah.
    Floating Bottom Navigation ditiadakan permanen untuk efisiensi ruang pandang mobile.

13. Konsep Antrean pada Trafik Tinggi (1.000 Peserta Bersamaan):
    STATUS: TERKONFIRMASI.
    Sistem menyerap ribuan request secara serentak ke RabbitMQ tanpa membebani frontend.
    Alokasi slot sementara dijalankan secara paralel melalui transaksi atomik PostgreSQL
    hingga batas kuota yang tersedia (bukan antrean buatan lambat 1-per-1). Peserta
    yang mendapat slot reservasi dapat melanjutkan ke form dan pembayaran secara bersamaan.

14. Penyimpanan Konten Blog:
    STATUS: TERKONFIRMASI.
    Artikel disimpan langsung di tabel `blogs` Supabase dengan skema lengkap (slug, excerpt,
    content, category, author_name, reading_time). Telah tersedia 4 artikel seeded awal
    yang dapat diakses di portal /blog.
```
