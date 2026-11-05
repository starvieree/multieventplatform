import { route, ApiError, audit } from '../../../../../lib/utils/api';
import { adminDb } from '../../../../../lib/supabase/server';
const LIMIT = 5000;
// CSV: sel yang diawali = + - @ diberi tanda kutip agar tidak dieksekusi sebagai formula spreadsheet (CSV injection).
const cell = (v: unknown) => { let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
const REPORTS: Record<string, { table: string; select: string; cols: [string, (r: any) => unknown][]; date: string }> = {
  registrations: { table: 'registrations', date: 'created_at', select: 'registration_code,registration_status,payment_status,quantity,total_amount,created_at,event:events(title),profile:profiles(full_name,email)',
    cols: [['kode', (r) => r.registration_code], ['event', (r) => r.event?.title], ['peserta', (r) => r.profile?.full_name], ['email', (r) => r.profile?.email], ['jumlah', (r) => r.quantity], ['status', (r) => r.registration_status], ['pembayaran', (r) => r.payment_status], ['total', (r) => r.total_amount], ['dibuat', (r) => r.created_at]] },
  payments: { table: 'transactions', date: 'created_at', select: 'order_id,transaction_status,gross_amount,payment_type,paid_at,created_at',
    cols: [['order_id', (r) => r.order_id], ['status', (r) => r.transaction_status], ['nominal', (r) => r.gross_amount], ['metode', (r) => r.payment_type], ['dibayar', (r) => r.paid_at], ['dibuat', (r) => r.created_at]] },
  participants: { table: 'profiles', date: 'created_at', select: 'full_name,email,phone,account_status,created_at',
    cols: [['nama', (r) => r.full_name], ['email', (r) => r.email], ['telepon', (r) => r.phone], ['status', (r) => r.account_status], ['bergabung', (r) => r.created_at]] },
};
export const GET = route({ auth: 'admin', perm: 'reports.view', rate: [10, 60_000] }, async ({ ctx, userId, rid }) => {
  const rep = REPORTS[ctx.params.type!];
  if (!rep) throw new ApiError(404, 'not_found', 'Laporan tidak ditemukan.');
  const u = ctx.url, from = u.searchParams.get('from'), to = u.searchParams.get('to');
  let q = adminDb().from(rep.table).select(rep.select);
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) q = q.gte(rep.date, `${from}T00:00:00+07:00`);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) q = q.lte(rep.date, `${to}T23:59:59+07:00`);
  const { data, error } = await q.order(rep.date, { ascending: false }).limit(LIMIT);
  if (error) throw new Error('DB_ERROR');
  await audit(adminDb(), { actor: userId, action: 'reports.export', type: ctx.params.type!, after: { rows: data?.length ?? 0, from, to }, rid });
  const csv = '\ufeff' + [rep.cols.map(([h]) => cell(h)).join(','), ...(data ?? []).map((r) => rep.cols.map(([, f]) => cell(f(r))).join(','))].join('\r\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${ctx.params.type}-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
});
