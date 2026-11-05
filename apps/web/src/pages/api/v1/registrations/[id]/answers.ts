import { z } from 'zod';
import { route, ok, ApiError, dbError } from '../../../../../lib/utils/api';
import { adminDb } from '../../../../../lib/supabase/server';
import { buildAnswersSchema, type FormField } from '../../../../../lib/validations/schemas';
export const POST = route({ auth: 'user', rate: [20, 60_000], schema: z.object({ answers: z.record(z.unknown()) }) }, async ({ ctx, userId, body }) => {
  const sb = ctx.locals.supabase;
  const { data: reg } = await sb.from('registrations').select('id,event_id').eq('id', ctx.params.id!).maybeSingle();
  if (!reg) throw new ApiError(404, 'not_found', 'Pendaftaran tidak ditemukan.');
  const { data: fields } = await sb.from('event_form_fields').select('field_key,label,field_type,options,is_required,validation_rules').eq('event_id', reg.event_id).eq('is_active', true);
  const parsed = buildAnswersSchema((fields ?? []) as FormField[]).safeParse(body.answers);
  if (!parsed.success) throw new ApiError(422, 'validation_failed', parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const { data, error } = await adminDb().rpc('submit_registration_answers', { p_user: userId, p_registration: reg.id, p_answers: parsed.data });
  if (error) dbError(error);
  return ok(data);
});
