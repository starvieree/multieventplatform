import { route, ok } from '../../../../../lib/utils/api';
import { adminDb } from '../../../../../lib/supabase/server';
export const GET = route({ auth: 'admin', perm: 'queues.view' }, async () => {
  const { data } = await adminDb().rpc('admin_summary', { p_from: new Date(Date.now() - 864e5).toISOString(), p_to: new Date().toISOString() });
  return ok((data as any).health);
});
