// Uji "kuota terakhir": N akun berebut 1 kursi lewat reserve_quota paralel. Harapan: tepat 1 accepted, overselling = 0.
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const N = Number(process.env.N ?? 20);
const tag = Date.now().toString(36);

const { data: ev } = await db.from('events').insert({ title: `Uji ${tag}`, slug: `uji-${tag}`, status: 'published', start_at: new Date(Date.now() + 864e5).toISOString(), end_at: new Date(Date.now() + 9e7).toISOString(),
  registration_opens_at: new Date(Date.now() - 36e5).toISOString(), registration_closes_at: new Date(Date.now() + 36e5).toISOString(), total_quota: 1 }).select().single();
const { data: tc } = await db.from('ticket_categories').insert({ event_id: ev!.id, name: 'Reguler', price: 0, quota: 1 }).select().single();
const ids: string[] = [];
for (let i = 0; i < N; i++) {
  const { data: u } = await db.auth.admin.createUser({ email: `uji-${tag}-${i}@example.test`, password: crypto.randomUUID(), email_confirm: true });
  const { data } = await db.rpc('request_registration_queue', { p_user: u.user!.id, p_event: ev!.id, p_category: tc!.id, p_qty: 1, p_key: `k-${tag}-${i}` });
  ids.push((data as { queue_request_id: string }).queue_request_id);
}
const results = await Promise.all(ids.map((id) => db.rpc('reserve_quota', { p_queue_request_id: id })));
const accepted = results.filter((r) => (r.data as { status: string })?.status === 'accepted').length;
const { count } = await db.from('quota_reservations').select('*', { count: 'exact', head: true }).eq('event_id', ev!.id).in('status', ['reserved', 'confirmed']);
console.log({ requests: N, accepted, activeReservations: count, oversold: Math.max((count ?? 0) - 1, 0) });
if (accepted !== 1 || count !== 1) { console.error('GAGAL: terjadi oversell atau tidak ada pemenang'); process.exit(1); }
console.log('LULUS: kuota terakhir hanya terambil satu kali.');
