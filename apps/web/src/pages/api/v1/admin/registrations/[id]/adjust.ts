import { z } from 'zod';
import { route, ok, dbError, audit } from '../../../../../../lib/utils/api';
import { adminDb } from '../../../../../../lib/supabase/server';
// Tidak ada aksi untuk memaksa "paid": status lunas hanya dari webhook/rekonsiliasi Midtrans.
export const POST = route({ auth: 'admin', perm: 'registrations.adjust', rate: [20, 60_000], schema: z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel_unpaid'), reason: z.string().trim().min(5).max(300) }), z.object({ action: z.literal('note'), reason: z.string().trim().min(1).max(500) })]) }, async ({ ctx, userId, body, rid }) => {
  const db = adminDb();
  if (body.action === 'cancel_unpaid') { const { data, error } = await db.rpc('admin_cancel_registration', { p_actor: userId, p_registration: ctx.params.id, p_reason: body.reason }); if (error) dbError(error); return ok(data); }
  await db.from('registrations').update({ admin_note: body.reason }).eq('id', ctx.params.id!);
  await audit(db, { actor: userId, action: 'registration.note', type: 'registrations', id: ctx.params.id, after: { admin_note: body.reason }, rid });
  return ok({ saved: true });
});
