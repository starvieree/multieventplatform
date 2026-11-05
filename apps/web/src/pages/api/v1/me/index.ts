import { z } from 'zod';
import { route, ok } from '../../../../lib/utils/api';
import { profileSchema } from '../../../../lib/validations/schemas';
export const GET = route({ auth: 'user' }, async ({ ctx, userId }) => {
  const { data } = await ctx.locals.supabase.from('profiles').select('id,email,full_name,phone,avatar_path,account_status').eq('id', userId).single();
  return ok(data);
});
export const PATCH = route({ auth: 'user', schema: profileSchema, rate: [20, 60_000] }, async ({ ctx, userId, body }) => {
  const { data, error } = await ctx.locals.supabase.from('profiles').update(body).eq('id', userId).select('id,full_name,phone').single();   // RLS + grant kolom: hanya nama/telepon/avatar
  if (error) throw new Error('DB_ERROR');
  return ok(data);
});
