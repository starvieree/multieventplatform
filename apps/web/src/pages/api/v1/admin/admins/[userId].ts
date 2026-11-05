import { z } from 'zod';
import { route, ok, ApiError, audit } from '../../../../../lib/utils/api';
import { adminDb } from '../../../../../lib/supabase/server';
export const DELETE = route({ auth: 'admin', perm: 'admins.manage', rate: [10, 60_000], schema: z.object({ role: z.enum(['admin', 'super_admin']) }) }, async ({ ctx, userId, body, rid }) => {
  const target = ctx.params.userId!;
  if (target === userId) throw new ApiError(422, 'validation_failed', 'Anda tidak dapat mencabut peran Anda sendiri.');
  if (body.role === 'super_admin' && !ctx.locals.roles.includes('super_admin')) throw new ApiError(403, 'forbidden', 'Hanya super admin yang dapat mencabut super admin.');
  const db = adminDb();
  const { data: role } = await db.from('roles').select('id').eq('name', body.role).single();
  await db.from('user_roles').delete().eq('user_id', target).eq('role_id', role!.id);
  await audit(db, { actor: userId, action: 'admins.revoke', type: 'user_roles', id: target, before: { role: body.role }, rid });
  return ok({ revoked: true });
});
