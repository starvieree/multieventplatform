# DESIGN_SECTION_TO_SECTION

```text
DESAIN UI/UX TERPERINCI

PRINSIP UMUM
Gunakan desain modern, konsisten, mobile-first. Navbar dan footer publik sama
pada semua halaman publik. Dashboard peserta dan Admin Panel memiliki layout
terpisah. Semua halaman mempunyai loading, empty, error, dan success state.
Status ditampilkan dengan teks dan badge, bukan warna saja.

A. WEBSITE PUBLIK

1. NAVBAR
Urutan: Logo | Beranda | Tentang | Event v | Partnership | Blog | Kontak |
Register | Login.
Logo menuju /. Event menuju /events; dropdown opsional Semua, Mendatang, Gratis,
Berbayar. Register tombol primer, Login sekunder. Mobile memakai drawer/hamburger.
Navbar boleh sticky. Semua link harus konsisten.

2. BERANDA (/)
Section 1 Hero:
- Headline manfaat platform.
- Deskripsi singkat.
- CTA Jelajahi Event dan Pelajari Platform.
- Visual event/ilustrasi.
- Search event opsional.

Section 2 Search:
- Input kata kunci.
- Filter kategori/tanggal.
- Tombol cari menuju /events dengan query parameter.

Section 3 Kategori:
- Grid kategori event.
- Klik kategori membuka katalog terfilter.

Section 4 Event Unggulan:
- Grid kartu event: poster, kategori, nama, tanggal, lokasi, harga, status,
  tombol Detail.
- Hanya event published yang tampil.

Section 5 Cara Kerja:
- Temukan event.
- Daftar dan isi data.
- Selesaikan pembayaran jika berbayar.
- Pantau status dan tiket.

Section 6 Keunggulan:
- Informasi terpusat.
- Pendaftaran terstruktur.
- Status dapat dipantau.
- Pembayaran terintegrasi.

Section 7 Statistik:
- Tampilkan hanya angka nyata dari database; jika belum ada data, tampilkan
  manfaat platform tanpa angka rekaan.

Section 8 Artikel Terbaru:
- Tiga artikel published dengan thumbnail, judul, tanggal, ringkasan, link.

Section 9 CTA:
- Ajak pengguna menjelajahi event atau membuat akun.

Section 10 Footer:
- Logo/deskripsi.
- Link Beranda, Tentang, Event, Partnership, Blog, Kontak.
- Privacy, Terms, kontak, sosial media, copyright.

3. TENTANG (/tentang)
Section 1 hero + breadcrumb.
Section 2 latar belakang masalah pendaftaran event.
Section 3 profil dan fungsi platform.
Section 4 visi dan misi.
Section 5 nilai/keunggulan.
Section 6 CTA ke katalog atau partnership.

4. KATALOG EVENT (/events)
Layout 2 Kolom:
- Kolom Kiri (Sidebar Sticky .events-aside):
  * Search kata kunci.
  * Filter kategori event.
  * Stack pemilihan rentang tanggal (dari & sampai).
  * Filter tipe harga (Semua, Gratis, Berbayar).
  * Tombol Reset Filter.
  * Mobile view: drawer accordion responsif.
- Kolom Kanan (Konten Utama .events-main):
  * Header katalog & indikator jumlah event ditemukan.
  * Grid Event Cards: poster, badge status, kategori, tanggal, lokasi, harga,
    dan Quota Loading Bar ("Sisa [X] slot" dengan warna oranye menyala jika sisa <= 20%).
  * Pagination numerik yang mempertahankan query parameter.
  * Empty state jika tidak ada event yang cocok.

5. DETAIL EVENT (/events/[slug])
Section 1 breadcrumb.
Section 2 hero poster, nama, kategori, tanggal, lokasi, status, harga, CTA Daftar.
Section 3 ringkasan penyelenggara, jadwal, deadline, lokasi, kuota total.
Section 4 deskripsi lengkap.
Section 5 persyaratan peserta & lokasi (peta Google Maps).
Section 6 FAQ accordion.
Section 7 event terkait.
Sidebar Pemesanan Tiket Sticky:
- Kotak status pendaftaran aktif / banner kedaluwarsa jika ada transaksi sebelumnya yang expired.
- List kategori tiket:
  * Badge "Terdaftar" untuk tiket yang telah diambil peserta.
  * Badge "Terkunci" ("Terkunci · Maks. 1 kategori per akun") untuk kategori lain jika event membatasi 1 kategori per akun.
  * Status sisa tiket per kategori real-time.
- Pemilihan jumlah tiket (1 s.d. sisa batas akun).
- Tombol aksi: "Daftar sekarang" / "Masuk untuk mendaftar" / "Lihat Pesanan Saya".
- Antrean dibuat aman secara server-side dengan kunci idempotensi baru per submit.

6. PARTNERSHIP (/partnership)
Section 1 hero dan CTA.
Section 2 target mitra: komunitas, organisasi, institusi, perusahaan.
Section 3 bentuk kerja sama.
Section 4 manfaat.
Section 5 alur pengajuan.
Section 6 formulir: organisasi, kontak, email, telepon, tipe, website, deskripsi,
lampiran opsional, persetujuan privasi.
Section 7 FAQ dan kontak.

7. BLOG (/blog)
Section 1 hero.
Section 2 artikel unggulan.
Section 3 pencarian dan filter kategori.
Section 4 grid artikel: thumbnail, kategori, judul, ringkasan, tanggal.
Section 5 pagination.

8. DETAIL BLOG (/blog/[slug])
Section 1 breadcrumb.
Section 2 judul, kategori, penulis, tanggal, cover.
Section 3 isi dengan heading terstruktur.
Section 4 media pendukung.
Section 5 artikel terkait.
Section 6 CTA katalog.
Section 7 metadata SEO dan Article schema.

9. KONTAK (/kontak)
Section 1 hero.
Section 2 email/telepon/alamat resmi.
Section 3 form nama, email, subjek, pesan, consent.
Section 4 FAQ.
Section 5 CTA partnership.
Tampilkan feedback terkirim/gagal dan proteksi spam dasar.

10. LOGIN (/login)
Logo, judul, email, password, toggle password, tombol login, lupa password,
link register, pesan error aman. Setelah login, redirect hanya ke path internal
yang telah divalidasi.

11. REGISTER (/register)
Nama, email, telepon jika diperlukan, password, konfirmasi, persetujuan Terms
dan Privacy, tombol daftar, link login. Tampilkan instruksi verifikasi email.

12. FORGOT/RESET PASSWORD
Forgot: input email, tombol kirim, pesan netral.
Reset: validasi session/token Supabase, password baru, konfirmasi, feedback.

13. PRIVACY DAN TERMS
Privacy menjelaskan data, tujuan, pihak ketiga, retensi, hak pengguna, kontak.
Terms menjelaskan akun, pendaftaran, pembayaran, pembatalan/refund, larangan,
batas tanggung jawab. Minta review pihak kompeten sebelum produksi.

B. PORTAL PESERTA

Navigasi Peserta (Header / Dropdown Profil):
Menu: Pesanan Saya (/pesanan), Tiket Saya (/tiket-saya), Notifikasi (/notifikasi),
Profil (/profil), Keamanan Akun (/profil/security), Keluar.
Rute legacy /dashboard/* otomatis dialihkan via HTTP 301 ke rute portal peserta.

1. PESANAN & TRANSAKSI (/pesanan)
- Section 1 "Pesanan Perlu Diselesaikan": Kartu sorotan untuk transaksi draft
  atau awaiting_payment yang reservasinya masih aktif, dilengkapi tombol
  "Lanjutkan Pembayaran" atau "Lengkapi Formulir" dan countdown batas waktu.
- Section 2 "Riwayat Pendaftaran": Filter status (Semua, Terkonfirmasi, Menunggu
  Pembayaran, Draf, Dibatalkan, Kedaluwarsa) dan tabel riwayat dengan kode pesanan,
  event, status pendaftaran, status pembayaran, total, tanggal, dan aksi detail.

2. DETAIL PESANAN (/pesanan/[id])
- Header kode pesanan dan badge status.
- Banner tindakan diperlukan (jika aktif) atau banner kedaluwarsa dengan tombol "Daftar Ulang".
- Banner penerbitan e-ticket jika pesanan telah terkonfirmasi.
- Grid 2 kolom:
  * Kolom Kiri: Rincian event, waktu, lokasi, dan jawaban formulir pendaftaran.
  * Kolom Kanan: Rincian tiket, subtotal, total nominal, timeline alur pendaftaran,
    dan riwayat transaksi pembayaran.

3. TIKET SAYA (/tiket-saya)
- Ringkasan wallet tiket aktif.
- Grid kartu e-ticket peserta: judul event, jadwal, kategori, kode tiket unik,
  badge status tiket, tombol buka e-ticket.

4. DETAIL E-TICKET (/tiket-saya/[id])
- Kartu e-ticket resmi siap cetak/scan.
- QR Code dinamis berbasis SVG dari kode tiket.
- Data pemegang tiket, nama event, lokasi, waktu, dan nomor registrasi.
- Tombol cetak / unduh tiket.

5. PROFIL & KEAMANAN (/profil, /profil/security)
- /profil: Kelola identitas peserta (nama lengkap, nomor telepon, email, avatar).
- /profil/security: Kelola keamanan akun, ganti password, dan proteksi sesi.

6. NOTIFIKASI (/notifikasi)
- Daftar pemberitahuan real-time: konfirmasi antrean, pengingat pembayaran,
  tiket terbit, dan pengumuman event. Tandai terbaca individual/semua.

7. ALUR TRANSAKSI AKTIF:
- Antrean (/registration/queue/[id]): Polling status antrean real-time.
- Formulir (/registration/[id]/form): Input field dinamis dengan double-submit protection.
  Jika waktu habis, muncul status box kedaluwarsa dengan tombol "Daftar Ulang".
- Pembayaran (/registration/[id]/payment): Rincian pembayaran Midtrans Snap.
  Jika waktu habis, muncul card waktu berakhir dengan tombol "Daftar Ulang" dan "Cek Status".
- Status Pendaftaran (/registration/[id]/status): Timeline visual, badge status,
  tombol "Lihat Tiket", "Daftar Ulang" (jika expired), dan "Detail Pendaftaran".

7. STATUS (/registration/[id]/status)
Tampilkan status dari database.
Pending: menunggu atau lanjut bayar.
Paid: konfirmasi dan tiket.
Expired/failed: penjelasan kebijakan.
Refresh meminta status server, bukan mempercayai query redirect.

8. TIKET (/dashboard/tickets dan /dashboard/tickets/[id])
Daftar tiket, event, kode, tanggal, status.
Detail berisi pemegang, kode unik, QR jika check-in tersedia, jadwal, venue,
print/download jika diimplementasikan. Hanya diterbitkan setelah confirmed.

9. PROFIL (/dashboard/profile)
Nama, email (perubahan mengikuti verifikasi), telepon, avatar opsional, simpan.

10. KEAMANAN (/dashboard/profile/security)
Ubah password via Supabase Auth. Jangan tampilkan password/hash.

11. NOTIFIKASI (/dashboard/notifications)
List, jenis, pesan, waktu, status baca, tandai dibaca. Hanya notifikasi sendiri.

C. ADMIN PANEL

Layout sidebar:
Dashboard, Event, Kategori, Peserta, Pendaftaran, Transaksi, Antrean,
Partnership, Blog, Banner, Pesan, Laporan, Admin/Hak Akses, Audit Log,
Pengaturan. Header: breadcrumb, notifikasi, profil, logout.

1. DASHBOARD ADMIN
Header dan filter periode.
KPI event, peserta, pendaftaran, pending payment, confirmed, revenue paid.
Grafik pendaftaran.
Grafik pendapatan hanya transaksi paid.
Performa event.
Aktivitas terbaru.
Health status Supabase, RabbitMQ, worker, webhook.

2. EVENT (/admin/dashboard/events)
Daftar dengan search, filter, tambah, tabel poster/nama/tanggal/kategori/kuota/
status/aksi.
Form dibagi tab:
- Informasi utama: nama, slug, kategori, ringkasan, deskripsi, organizer.
- Media: poster/banner, alt text, preview.
- Jadwal: mulai, selesai, buka/tutup pendaftaran, timezone.
- Lokasi: offline/online/hybrid, venue, alamat, link.
- Kuota/tiket: total, kategori, harga, quota, periode, batas akun.
- Form peserta: field, tipe, opsi, wajib, urutan, aturan validasi.
- Persyaratan/FAQ.
- SEO/publikasi: meta, OG, draft/published, preview.
Validasi perubahan kuota terhadap reserved dan confirmed.

3. KATEGORI
Daftar, tambah/edit, slug, deskripsi, icon, aktif/nonaktif. Jangan hapus kategori
yang masih dipakai tanpa migrasi.

4. PESERTA
Search/filter. List nama, email, telepon, join date, jumlah pendaftaran, status.
Detail profil, histori pendaftaran, transaksi yang diizinkan. Tidak menampilkan
password. Suspend/activate hanya dengan permission.

5. PENDAFTARAN
Search kode/nama/event, filter event/status/tanggal. Detail data, jawaban,
timeline, reservation, transaksi, webhook. Tidak ada pemeriksaan bukti transfer.
Perubahan admin wajib reason, permission, audit.

6. TRANSAKSI
List order ID, registration, peserta, event, nominal, metode, status, waktu.
Detail provider reference, webhook, signature validation, error, rekonsiliasi.
Tidak ada tombol paksa paid tanpa validasi provider.

7. MONITORING ANTREAN
Queue health: ready, unacked, consumers, throughput, failed, DLQ.
Metrics: wait time, processing time, success/failure.
Request log: request ID, event, waktu, status, retry, error.
Quota monitor: total, reserved, confirmed, available, expiry.
Retry/requeue hanya aman, idempotent, dan tercatat. Admin tidak mengubah kuota
dengan mengedit angka broker.

8. PARTNERSHIP
Daftar pengajuan, kontak, tanggal, status. Detail deskripsi/lampiran/catatan.
Status new/reviewing/approved/rejected.

9. BLOG
Daftar judul, penulis, kategori, status, tanggal.
Form judul, slug, excerpt, konten, thumbnail, kategori, meta, OG, preview,
draft/publish.

10. BANNER
Gambar desktop/mobile, alt, judul, deskripsi, CTA, periode, urutan, aktif.

11. PESAN KONTAK
List pesan dan status new/read/replied/closed. Detail isi dan catatan admin.

12. LAPORAN
Pendaftaran per event, peserta, transaksi, pendapatan paid, antrean.
Filter periode/event dan ekspor CSV sesuai permission.

13. ADMIN DAN PERMISSION
List admin, role, permission, status. Invite, ubah role, nonaktifkan. Least
privilege dan audit untuk perubahan role.

14. AUDIT LOG
Waktu, aktor, action, resource, before/after ringkas, reason, request ID.
Tidak dapat diedit admin biasa.

15. PENGATURAN
Umum: identitas, logo, kontak.
Pendaftaran: reservation duration, batas akun, timezone, kebijakan.
Integrasi: status Supabase/RabbitMQ/Midtrans tanpa menampilkan secret.
Notifikasi: template dan status kanal.

D. KOMPONEN REUSABLE
Button, Input, Select, Textarea, Modal, ConfirmDialog, Alert, Toast, Badge,
Breadcrumb, Pagination, DataTable, FilterBar, SearchInput, DateRangeFilter,
EmptyState, LoadingState, ErrorState, Skeleton, EventCard, ArticleCard,
StatCard, StatusTimeline, FileUploader, RichTextEditor.

E. DESIGN SYSTEM
Tetapkan token warna primer/sekunder/background/surface/border/success/warning/
danger/info. Tentukan typography scale, spacing, radius, shadow. Fokus keyboard
terlihat. Form memiliki label dan error. Tabel punya loading/empty/error.
Konfirmasi tindakan destruktif.
```
