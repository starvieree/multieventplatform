import { route, ApiError, audit } from '../../../../../lib/utils/api';
import { adminDb } from '../../../../../lib/supabase/server';

const LIMIT = 5000;
// CSV: sel yang diawali = + - @ diberi tanda kutip agar tidak dieksekusi sebagai formula spreadsheet (CSV injection).
const cell = (v: unknown) => {
  let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

const REG_SELECT = 'id,registration_code,order_id,registration_status,status,payment_status,quantity,subtotal,total_amount,amount,admin_note,participant_name,email,phone,event_title,event_category,payment_type,midtrans_transaction_id,created_at,confirmed_at,event:events(id,title),ticket_category:ticket_categories(id,name,price),profile:profiles(id,full_name,email,phone),tickets:tickets(id,ticket_code,attendee_name,status,checked_in_at),transactions:transactions(id,order_id,provider,payment_type,gross_amount,transaction_status,paid_at,created_at),answers:registration_answers(field_label_snapshot,answer)';

const REG_HEADERS = [
  'kode_order',
  'event',
  'kategori_tiket',
  'nama_pemesan',
  'email_pemesan',
  'telepon_pemesan',
  'nomor_tiket',
  'kode_tiket',
  'nama_peserta',
  'status_tiket',
  'waktu_check_in',
  'status_pendaftaran',
  'status_pembayaran',
  'order_id_transaksi',
  'metode_pembayaran',
  'status_transaksi',
  'nominal_transaksi',
  'total_pesanan',
  'waktu_lunas',
  'waktu_order',
  'jawaban_formulir'
];

function formatRegistrationRows(data: any[]): (string | number)[][] {
  const result: (string | number)[][] = [];

  for (const reg of data) {
    const kodeOrder = reg.registration_code || reg.order_id || '—';
    const eventTitle = reg.event?.title || reg.event_title || '—';
    const kategoriTiket = reg.ticket_category?.name || reg.event_category || '—';
    const namaPemesan = reg.profile?.full_name || reg.participant_name || '—';
    const emailPemesan = reg.profile?.email || reg.email || '—';
    const teleponPemesan = reg.profile?.phone || reg.phone || '—';
    const statusPendaftaran = reg.registration_status || reg.status || '—';
    const statusPembayaran = reg.payment_status || (reg.status === 'confirmed' ? 'paid' : reg.status) || '—';
    const totalPesanan = reg.total_amount ?? reg.amount ?? 0;
    const waktuOrder = reg.created_at || '—';

    // Format formulir kustom jika ada
    let jawabanFormulir = '—';
    if (Array.isArray(reg.answers) && reg.answers.length > 0) {
      jawabanFormulir = reg.answers
        .map((a: any) => `${a.field_label_snapshot || 'Field'}: ${typeof a.answer === 'object' ? JSON.stringify(a.answer) : a.answer}`)
        .join(' | ');
    }

    // Transaksi terkait (ambil yang paling baru)
    const txList = Array.isArray(reg.transactions) ? [...reg.transactions] : [];
    txList.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    const latestTx = txList[0];

    const orderIdTransaksi = latestTx?.order_id || reg.midtrans_transaction_id || reg.order_id || '—';
    const metodePembayaran = latestTx?.payment_type || reg.payment_type || '—';
    const statusTransaksi = latestTx?.transaction_status || (statusPembayaran === 'paid' ? 'settlement' : statusPembayaran) || '—';
    const nominalTransaksi = latestTx?.gross_amount ?? totalPesanan;
    const waktuLunas = latestTx?.paid_at || reg.confirmed_at || (statusPembayaran === 'paid' ? waktuOrder : '—');

    const tickets = Array.isArray(reg.tickets) ? reg.tickets : [];
    if (tickets.length > 0) {
      tickets.forEach((t: any, idx: number) => {
        result.push([
          kodeOrder,
          eventTitle,
          kategoriTiket,
          namaPemesan,
          emailPemesan,
          teleponPemesan,
          tickets.length > 1 ? `Tiket ${idx + 1} dari ${tickets.length}` : 'Tiket 1 dari 1',
          t.ticket_code || '—',
          t.attendee_name || namaPemesan,
          t.status || 'active',
          t.checked_in_at || '—',
          statusPendaftaran,
          statusPembayaran,
          orderIdTransaksi,
          metodePembayaran,
          statusTransaksi,
          nominalTransaksi,
          totalPesanan,
          waktuLunas,
          waktuOrder,
          jawabanFormulir
        ]);
      });
    } else {
      result.push([
        kodeOrder,
        eventTitle,
        kategoriTiket,
        namaPemesan,
        emailPemesan,
        teleponPemesan,
        '—',
        '—',
        namaPemesan,
        statusPendaftaran === 'cancelled' ? 'Batal' : 'Belum Terbit',
        '—',
        statusPendaftaran,
        statusPembayaran,
        orderIdTransaksi,
        metodePembayaran,
        statusTransaksi,
        nominalTransaksi,
        totalPesanan,
        waktuLunas,
        waktuOrder,
        jawabanFormulir
      ]);
    }
  }

  return result;
}

const OTHER_REPORTS: Record<string, { table: string; select: string; cols: [string, (r: any) => unknown][]; date: string }> = {
  payments: {
    table: 'transactions',
    date: 'created_at',
    select: 'order_id,transaction_status,gross_amount,payment_type,paid_at,created_at,registration:registrations(event:events(title))',
    cols: [
      ['order_id', (r) => r.order_id],
      ['event', (r) => r.registration?.event?.title ?? '—'],
      ['status_transaksi', (r) => r.transaction_status],
      ['nominal', (r) => r.gross_amount],
      ['metode_bayar', (r) => r.payment_type],
      ['waktu_lunas', (r) => r.paid_at],
      ['waktu_transaksi', (r) => r.created_at]
    ]
  },
  participants: {
    table: 'profiles',
    date: 'created_at',
    select: 'full_name,email,phone,account_status,created_at',
    cols: [
      ['nama_pengguna', (r) => r.full_name],
      ['email', (r) => r.email],
      ['telepon', (r) => r.phone],
      ['status_akun', (r) => r.account_status],
      ['tanggal_bergabung', (r) => r.created_at]
    ]
  }
};

export const GET = route({ auth: 'admin', rate: [30, 60_000] }, async ({ ctx, userId, rid }) => {
  const type = ctx.params.type!;
  const { permissions = [], roles = [] } = ctx.locals;
  const isSuper = roles.includes('super_admin');
  const canReport = permissions.includes('reports.view');
  const canReg = permissions.includes('registrations.view');

  if (!isSuper && !canReport && !(type === 'registrations' && canReg)) {
    throw new ApiError(403, 'forbidden', 'Anda tidak memiliki izin untuk mengunduh laporan ini.');
  }

  const u = ctx.url;
  const from = u.searchParams.get('from');
  const to = u.searchParams.get('to');
  const eventId = u.searchParams.get('event_id');
  const status = u.searchParams.get('status');
  const searchQuery = u.searchParams.get('q');

  let csvContent = '';
  let filename = `${type}-${new Date().toISOString().slice(0, 10)}.csv`;
  let rowCount = 0;

  if (type === 'registrations') {
    let q = adminDb().from('registrations').select(REG_SELECT);

    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) q = q.gte('created_at', `${from}T00:00:00+07:00`);
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) q = q.lte('created_at', `${to}T23:59:59+07:00`);
    if (eventId) q = q.eq('event_id', eventId);
    if (status) q = q.or(`registration_status.eq.${status},status.eq.${status}`);
    if (searchQuery) {
      const s = searchQuery.trim();
      if (s) q = q.or(`registration_code.ilike.%${s}%,order_id.ilike.%${s}%,participant_name.ilike.%${s}%`);
    }

    const { data, error } = await q.order('created_at', { ascending: false }).limit(LIMIT);
    if (error) {
      console.error('[REGISTRATIONS_EXPORT_ERROR]', error);
      throw new Error('DB_ERROR');
    }

    const rows = formatRegistrationRows(data ?? []);
    rowCount = rows.length;

    const fnPrefix = ['data-peserta-transaksi'];
    if (eventId) fnPrefix.push('per-event');
    if (status) fnPrefix.push(status);
    fnPrefix.push(new Date().toISOString().slice(0, 10));
    filename = `${fnPrefix.join('-')}.csv`;

    csvContent = '\ufeff' + [
      REG_HEADERS.map((h) => cell(h)).join(','),
      ...rows.map((r) => r.map((c) => cell(c)).join(','))
    ].join('\r\n');
  } else {
    const rep = OTHER_REPORTS[type];
    if (!rep) throw new ApiError(404, 'not_found', 'Laporan tidak ditemukan.');

    let selectQuery = rep.select;
    if (type === 'payments' && eventId) {
      selectQuery = 'order_id,transaction_status,gross_amount,payment_type,paid_at,created_at,registration:registrations!inner(event_id,event:events(title))';
    }

    let q = adminDb().from(rep.table).select(selectQuery);
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) q = q.gte(rep.date, `${from}T00:00:00+07:00`);
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) q = q.lte(rep.date, `${to}T23:59:59+07:00`);
    if (eventId && type === 'payments') q = q.eq('registration.event_id', eventId);

    const { data, error } = await q.order(rep.date, { ascending: false }).limit(LIMIT);
    if (error) throw new Error('DB_ERROR');
    rowCount = data?.length ?? 0;

    filename = `${type}-${eventId ? 'event-' : ''}${new Date().toISOString().slice(0, 10)}.csv`;
    csvContent = '\ufeff' + [
      rep.cols.map(([h]) => cell(h)).join(','),
      ...(data ?? []).map((r) => rep.cols.map(([, f]) => cell(f(r))).join(','))
    ].join('\r\n');
  }

  await audit(adminDb(), {
    actor: userId,
    action: 'reports.export',
    type,
    after: { rows: rowCount, from, to, eventId, status, q: searchQuery },
    rid
  });

  return new Response(csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store'
    }
  });
});
