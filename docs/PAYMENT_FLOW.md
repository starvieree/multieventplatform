# PAYMENT_FLOW

```text
TUJUAN
Midtrans memproses pembayaran; webhook tervalidasi menjadi sumber konfirmasi.

ALUR
1. Peserta telah mendapat reservation dan mengisi formulir.
2. Backend memeriksa reservation masih aktif.
3. Backend menghitung nominal dari database.
4. Backend membuat order_id unik dan transaksi internal pending.
5. Backend memanggil Midtrans API menggunakan server key di server.
6. Simpan provider transaction reference, expiry, dan Snap token/redirect
   reference yang diperlukan.
7. Browser membuka UI pembayaran.
8. Peserta membayar.
9. Midtrans mengirim webhook ke backend.
10. Backend memvalidasi signature, order_id, gross_amount, transaction_id,
    status, dan relasi registration.
11. Simpan notifikasi dan proses status secara idempotent.
12. Jika paid valid: transaction paid, reservation confirmed, registration
    confirmed, ticket diterbitkan, notification dibuat.
13. Jika failed/cancel/expired: update status dan release reservation jika
    masih reserved serta tidak ada pembayaran valid.

STATUS MAPPING KONSEPTUAL
pending -> pending
settlement -> paid
capture + fraud_status accept -> paid
capture + challenge -> menunggu/ditinjau sesuai kebijakan
deny -> failed
cancel -> cancelled
expire -> expired
refund -> refunded
partial_refund -> partially_refunded
Mapping final wajib mengikuti dokumentasi Midtrans dan metode pembayaran.

WEBHOOK VALIDATION
- Signature valid.
- order_id ditemukan.
- gross_amount sama dengan nominal internal.
- provider transaction ID dicocokkan.
- status dikenali.
- transaksi terhubung dengan registration yang benar.
- deduplication key diperiksa.
Invalid webhook tidak mengubah transaksi.

IDEMPOTENCY
Webhook dapat dikirim berulang. Gunakan unique notification key bila tersedia,
row lock, unique ticket code, dan state transition. Jika transaksi sudah paid,
webhook paid berikutnya tidak membuat tiket baru. Jangan izinkan status final
mundur akibat notifikasi terlambat/tidak berurutan.

RACE EXPIRY
Expiry job dan webhook dapat berjalan bersamaan. Lock transaksi/reservation,
periksa state terkini, lalu lakukan transisi atomik. Jika status ambigu, lakukan
rekonsiliasi ke provider sebelum release.

RECONCILIATION
Cari transaksi pending terlalu lama, cek status provider melalui server,
bandingkan dengan database, catat hasil. Jangan mengubah status tanpa bukti.

ADMIN
Tampilkan order ID, registration, peserta, event, amount, method, provider status,
internal status, webhook history, signature result, error dan rekonsiliasi.
Tidak ada tombol paksa paid tanpa validasi.

TEST
Success, pending->settlement, deny, cancel, expire, refund, invalid signature,
amount mismatch, unknown order, duplicate/out-of-order webhook, expiry race,
API timeout, browser close, redirect before webhook.
```
