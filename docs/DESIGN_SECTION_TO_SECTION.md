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
Section 1 judul, deskripsi, breadcrumb.
Section 2 search dan filter kategori, lokasi, tanggal, gratis/berbayar, status.
Section 3 chip filter aktif dan reset.
Section 4 grid event card dengan poster, judul, tanggal, lokasi, harga, status,
tombol detail.
Section 5 pagination yang mempertahankan query filter.
Section 6 empty state dan tombol reset.

5. DETAIL EVENT (/events/[slug])
Section 1 breadcrumb.
Section 2 hero poster, nama, kategori, tanggal, lokasi, status, harga, CTA Daftar.
Section 3 ringkasan penyelenggara, jadwal, deadline, lokasi, kuota.
Section 4 deskripsi lengkap.
Section 5 agenda/jadwal.
Section 6 kategori tiket: nama, benefit, harga, periode, ketersediaan.
Section 7 persyaratan peserta.
Section 8 lokasi/peta jika ada.
Section 9 FAQ.
Section 10 event terkait.
Section 11 CTA pendaftaran.
Tombol daftar memeriksa event dan login. Jika belum login, arahkan ke login
dengan redirect internal yang tervalidasi. Setelah login, kembalikan ke event.
Request antrean hanya dibuat server-side.

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

B. DASHBOARD PESERTA

Layout:
Sidebar: Dashboard, Pendaftaran Saya, Tiket Saya, Notifikasi, Profil, Keamanan,
Keluar. Header berisi breadcrumb, notifikasi, profil. Mobile memakai drawer.

1. DASHBOARD (/dashboard)
Greeting nama peserta.
KPI: total pendaftaran, menunggu pembayaran, confirmed, tiket aktif.
Pendaftaran terbaru dengan event, tanggal, status, aksi.
Rekomendasi event yang masih dibuka.
Preview notifikasi.

2. PENDAFTARAN SAYA (/dashboard/registrations)
Filter status registration/payment dan pencarian.
Tabel/kartu: kode, event, tanggal, kategori, registration status, payment status,
aksi detail/lanjut bayar/lihat tiket.

3. DETAIL PENDAFTARAN (/dashboard/registrations/[id])
Header kode dan status.
Timeline request, antrean, reservasi, form, transaksi, hasil.
Data peserta dan jawaban form.
Kategori tiket dan nominal.
Order ID, status, expiry, tombol lanjut bayar jika valid.
Bantuan jika status belum berubah.

4. ANTREAN (/registration/queue/[id])
Status queued/processing/accepted/full/failed.
Nomor antrean hanya jika dihitung akurat.
Progress dan estimasi hanya jika berdasarkan metrik nyata.
Ringkasan event.
Jika accepted: lanjut formulir. Jika full: kembali ke katalog. Jika queued:
jangan membuat request baru.

5. FORM PENDAFTARAN (/registration/[id]/form)
Stepper antrean -> data -> pembayaran -> selesai.
Ringkasan event/tiket.
Form identitas dan field dinamis.
Review jawaban.
Persetujuan ketentuan.
Submit dengan loading dan double-submit protection.
Form terkait registration yang telah sah.

6. PEMBAYARAN (/registration/[id]/payment)
Ringkasan event, kategori, jumlah, harga, total.
Status pending, order ID, deadline.
Tombol membuka Snap/redirect Midtrans.
Tidak ada upload bukti transfer.
Jika halaman pembayaran ditutup, peserta dapat kembali ke detail dan lanjut
selama transaksi masih berlaku.

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
