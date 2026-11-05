import { route, ok, pageParams } from '../../../../../../lib/utils/api';
import { adminDb } from '../../../../../../lib/supabase/server';
export const GET = route({ auth: 'admin', perm: 'queues.view' }, async ({ ctx }) => {
  const { page, limit, from, to } = pageParams(ctx.url, 100);
  let q = adminDb().from('queue_requests').select('id,status,error_code,retry_count,quantity,queued_at,processed_at,event:events(title)', { count: 'exact' });
  const s = ctx.url.searchParams.get('status'); if (s) q = q.eq('status', s);
  const { data, count } = await q.order('queued_at', { ascending: false }).range(from, to);
  return ok(data, { page, limit, total: count ?? 0 });
});
