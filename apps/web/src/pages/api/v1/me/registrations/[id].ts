import { route, ok, ApiError } from '../../../../../lib/utils/api';
export const GET = route({ auth: 'user' }, async ({ ctx }) => {
  const { data } = await ctx.locals.supabase.from('registrations').select('*, event:events(title,slug,start_at,end_at,venue_name,address), ticket:ticket_categories(name,price), transactions(order_id,transaction_status,payment_type,gross_amount,expiry_time,paid_at), reservations:quota_reservations(status,expires_at), answers:registration_answers(field_label_snapshot,answer), tickets(id,ticket_code,status)').eq('id', ctx.params.id!).maybeSingle();
  if (!data) throw new ApiError(404, 'not_found', 'Pendaftaran tidak ditemukan.');   // RLS: milik orang lain = tidak ada
  return ok(data);
});
