import { route, ok, ApiError, dbError } from '../../../../../lib/utils/api';
import { adminDb } from '../../../../../lib/supabase/server';
import { createSnapTransaction } from '../../../../../lib/utils/midtrans';
// Nominal & order_id ditentukan database; browser tidak mengirim harga apa pun.
export const POST = route({ auth: 'user', rate: [10, 60_000] }, async ({ ctx, userId }) => {
  const db = adminDb();
  const { data, error } = await db.rpc('prepare_payment', { p_user: userId, p_registration: ctx.params.id });
  if (error) dbError(error);
  const p = data as { order_id: string; amount: number; snap_token?: string; redirect_url?: string; expires_at: string };
  let { snap_token, redirect_url } = p;
  if (!snap_token) {
    const { data: r } = await db.from('registrations').select('quantity, ticket:ticket_categories(name), event:events(title), profile:profiles(full_name,email)').eq('id', ctx.params.id!).single();
    const row = r as any;
    try {
      const snap = await createSnapTransaction({ orderId: p.order_id, amount: p.amount, qty: row.quantity, email: row.profile.email ?? ctx.locals.user!.email!, name: row.profile.full_name ?? 'Peserta',
        itemName: `${row.event.title} - ${row.ticket.name}`, minutes: Math.ceil((+new Date(p.expires_at) - Date.now()) / 60_000), finishUrl: new URL(`/registration/${ctx.params.id}/status`, ctx.site).toString() });
      snap_token = snap.token; redirect_url = snap.redirect_url;
      await db.rpc('attach_snap', { p_order_id: p.order_id, p_token: snap_token, p_redirect: redirect_url });
    } catch { throw new ApiError(502, 'payment_provider_error', 'Layanan pembayaran sedang bermasalah. Silakan coba lagi.'); }
  }
  return ok({ order_id: p.order_id, amount: p.amount, snap_token, redirect_url, expires_at: p.expires_at });
});
