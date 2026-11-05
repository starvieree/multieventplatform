import { z } from 'zod';
import { route, ok, ApiError, audit } from '../../../../../../lib/utils/api';
import { adminDb } from '../../../../../../lib/supabase/server';
export const POST = route({ auth: 'admin', perm: 'participants.suspend', rate: [20, 60_000], schema: z.object({ account_status: z.enum(['active', 'suspended']), reason: z.string().trim().min(3).max(300) }) }, async ({ ctx, userId, body, rid }) => {
  const id = ctx.params.id!;
  if (id === userId) throw new ApiError(422, 'validation_failed', 'Anda tidak dapat mengubah status akun sendiri.');
  const db = adminDb();
  const { data: p } = await db.from('profiles').select('account_status').eq('id', id).maybeSingle();
  if (!p) throw new ApiError(404, 'not_found', 'Peserta tidak ditemukan.');
  await db.from('profiles').update({ account_status: body.account_status }).eq('id', id);
  await db.auth.admin.updateUserById(id, { ban_duration: body.account_status === 'suspended' ? '876000h' : 'none' });   // sesi baru ditolak di level Auth
  await audit(db, { actor: userId, action: 'participants.status', type: 'profiles', id, before: { account_status: p.account_status }, after: { account_status: body.account_status }, reason: body.reason, rid });
  return ok({ account_status: body.account_status });
});
