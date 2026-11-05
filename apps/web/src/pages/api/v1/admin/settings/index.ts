import { z } from 'zod';
import { route, ok, audit, ApiError } from '../../../../../lib/utils/api';
import { adminDb } from '../../../../../lib/supabase/server';
const SCHEMAS = {
  site: z.object({ name: z.string().max(100), email: z.string().email().or(z.literal('')), phone: z.string().max(30), address: z.string().max(300), instagram: z.string().max(100) }),
  reservation_minutes: z.coerce.number().int().min(5).max(1440), default_max_per_user: z.coerce.number().int().min(1).max(20),
  policy: z.object({ cancellation: z.string().max(2000), refund: z.string().max(2000) }),
} as const;
export const GET = route({ auth: 'admin', perm: 'settings.manage' }, async () => { const { data } = await adminDb().from('app_settings').select('key,value'); return ok(Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))); });
export const PATCH = route({ auth: 'admin', perm: 'settings.manage', rate: [20, 60_000], schema: z.object({ key: z.enum(['site', 'reservation_minutes', 'default_max_per_user', 'policy']), value: z.unknown() }) }, async ({ userId, body, rid }) => {
  const parsed = SCHEMAS[body.key].safeParse(body.value);
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Nilai pengaturan tidak valid.');
  const db = adminDb();
  const { data: before } = await db.from('app_settings').select('value').eq('key', body.key).maybeSingle();
  await db.from('app_settings').upsert({ key: body.key, value: parsed.data, updated_by: userId, updated_at: new Date().toISOString() });
  await audit(db, { actor: userId, action: 'settings.update', type: 'app_settings', id: body.key, before: before?.value, after: parsed.data, rid });
  return ok({ key: body.key });
});
