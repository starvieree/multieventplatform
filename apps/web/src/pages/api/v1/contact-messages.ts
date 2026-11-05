import { route, ok } from '../../../lib/utils/api';
import { adminDb } from '../../../lib/supabase/server';
import { contactSchema } from '../../../lib/validations/schemas';
export const POST = route({ rate: [5, 600_000], schema: contactSchema }, async ({ body }) => {
  if (body.hp) return ok({ received: true }, {}, 201);            // honeypot: bot dianggap berhasil, tidak disimpan
  const { hp, consent, ...row } = body;
  const { error } = await adminDb().from('contact_messages').insert(row);
  if (error) throw new Error('DB_ERROR');
  return ok({ received: true }, {}, 201);
});
