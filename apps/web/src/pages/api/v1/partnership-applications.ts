import { route, ok } from '../../../lib/utils/api';
import { adminDb } from '../../../lib/supabase/server';
import { partnershipSchema } from '../../../lib/validations/schemas';
export const POST = route({ rate: [5, 600_000], schema: partnershipSchema }, async ({ body }) => {
  if (body.hp) return ok({ received: true }, {}, 201);
  const { hp, consent, ...row } = body;
  const { error } = await adminDb().from('partnerships').insert(row);
  if (error) throw new Error('DB_ERROR');
  return ok({ received: true }, {}, 201);
});
