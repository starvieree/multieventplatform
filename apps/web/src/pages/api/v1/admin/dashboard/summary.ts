import { route, ok } from '../../../../../lib/utils/api';
import { adminDb } from '../../../../../lib/supabase/server';
export const GET = route({ auth: 'admin' }, async ({ ctx }) => {
  const days = Math.min(365, Math.max(1, Number(ctx.url.searchParams.get('days') ?? 30) || 30));
  const { data, error } = await adminDb().rpc('admin_summary', { p_from: new Date(Date.now() - days * 864e5).toISOString(), p_to: new Date().toISOString() });
  if (error) throw new Error('DB_ERROR');
  return ok(data);
});
