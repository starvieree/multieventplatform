import { z } from 'zod';
import { route, ok, ApiError, audit } from '../../../../../lib/utils/api';
import { adminDb } from '../../../../../lib/supabase/server';
export const GET = route({ auth: 'admin', perm: 'admins.manage' }, async () => {
  const { data } = await adminDb().from('user_roles').select('user_id, role:roles!inner(name), profile:profiles(full_name,email,account_status)').in('role.name', ['admin', 'super_admin']);
  return ok(data);
});
// Hanya super_admin yang boleh memberi/mencabut super_admin. Peserta diangkat lewat email akun yang sudah terdaftar.
export const POST = route({ auth: 'admin', perm: 'admins.manage', rate: [10, 60_000], schema: z.object({ email: z.string().email(), role: z.enum(['admin', 'super_admin']) }) }, async ({ ctx, userId, body, rid }) => {
  if (body.role === 'super_admin' && !ctx.locals.roles.includes('super_admin')) throw new ApiError(403, 'forbidden', 'Hanya super admin yang dapat menambah super admin.');
  const db = adminDb();
  const { data: p } = await db.from('profiles').select('id').ilike('email', body.email).maybeSingle();
  if (!p) throw new ApiError(404, 'not_found', 'Akun dengan email tersebut belum terdaftar.');
  const { data: role } = await db.from('roles').select('id').eq('name', body.role).single();
  const { error } = await db.from('user_roles').insert({ user_id: p.id, role_id: role!.id, assigned_by: userId });
  if (error && error.code !== '23505') throw new Error('DB_ERROR');
  await audit(db, { actor: userId, action: 'admins.grant', type: 'user_roles', id: p.id, after: { role: body.role }, rid });
  return ok({ user_id: p.id }, {}, 201);
});
