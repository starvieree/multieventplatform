# Uji kuota (wajib sebelum go-live)
Jalankan `npm run test:concurrency -w apps/worker` (lihat apps/worker/scripts/concurrency-test.ts). Skrip membuat event dengan kuota 1,
menembak N panggilan `reserve_quota` paralel dari N akun, lalu memastikan tepat 1 reservasi aktif dan overselling = 0.
