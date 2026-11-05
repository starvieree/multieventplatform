// Status ditampilkan sebagai teks + badge (bukan warna saja). tone: ok | wait | bad | muted
type T = 'ok' | 'wait' | 'bad' | 'muted';
export const STATUS: Record<string, [string, T]> = {
  draft: ['Draf', 'muted'], published: ['Dibuka', 'ok'], registration_closed: ['Pendaftaran ditutup', 'muted'], ongoing: ['Berlangsung', 'ok'], completed: ['Selesai', 'muted'], archived: ['Diarsipkan', 'muted'],
  queued: ['Dalam antrean', 'wait'], processing: ['Diproses', 'wait'], accepted: ['Kuota diamankan', 'ok'], rejected: ['Ditolak', 'bad'], failed: ['Gagal', 'bad'],
  reserved: ['Direservasi', 'wait'], confirmed: ['Terkonfirmasi', 'ok'], released: ['Dilepas', 'muted'], expired: ['Kedaluwarsa', 'bad'],
  awaiting_payment: ['Menunggu pembayaran', 'wait'], cancelled: ['Dibatalkan', 'bad'],
  pending: ['Menunggu', 'wait'], paid: ['Lunas', 'ok'], refunded: ['Dikembalikan', 'muted'], partially_refunded: ['Dikembalikan sebagian', 'muted'],
  active: ['Aktif', 'ok'], suspended: ['Ditangguhkan', 'bad'], used: ['Terpakai', 'muted'], void: ['Tidak berlaku', 'bad'],
  new: ['Baru', 'wait'], reviewing: ['Ditinjau', 'wait'], approved: ['Disetujui', 'ok'], read: ['Dibaca', 'muted'], replied: ['Dibalas', 'ok'], closed: ['Ditutup', 'muted'],
};
export const statusLabel = (s?: string | null) => (s ? STATUS[s]?.[0] ?? s : '—');
export const statusTone = (s?: string | null): T => (s ? STATUS[s]?.[1] ?? 'muted' : 'muted');
export const ERROR_TEXT: Record<string, string> = {
  QUOTA_FULL: 'Kuota sudah penuh.', USER_LIMIT: 'Batas pendaftaran per akun untuk event ini sudah tercapai.', REGISTRATION_CLOSED: 'Pendaftaran event ini sedang tidak dibuka.',
  RETRY_EXHAUSTED: 'Permintaan tidak dapat diproses. Silakan coba daftar lagi.',
};
