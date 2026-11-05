const TZ = 'Asia/Jakarta';
export const rupiah = (n: number | string | null | undefined) =>
  n == null ? '—' : Number(n) === 0 ? 'Gratis' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(n));
export const fmtDate = (d?: string | null, time = false) =>
  d ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', ...(time ? { timeStyle: 'short' } : {}), timeZone: TZ }).format(new Date(d)) : '—';
export const mediaUrl = (path?: string | null) => (path ? `${import.meta.env.PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${path}` : null);
export const toInputDateTime = (d?: string | null) => (d ? new Date(new Date(d).getTime() + 7 * 3600e3).toISOString().slice(0, 16) : '');
export const fromInputDateTime = (s?: string | null) => (s ? new Date(s + ':00+07:00').toISOString() : null);
export const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
