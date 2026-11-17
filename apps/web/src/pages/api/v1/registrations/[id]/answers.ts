import { z } from 'zod';
import { route, ok, ApiError, dbError } from '../../../../../lib/utils/api';
import { adminDb } from '../../../../../lib/supabase/server';
import { buildAnswersSchema, type FormField } from '../../../../../lib/validations/schemas';

const standardParticipantSchema = z.object({
  full_name: z.string().trim().min(2, 'Nama lengkap peserta minimal 2 karakter.').max(100),
  phone: z.string().trim().min(8, 'Nomor HP peserta minimal 8 digit.').max(20),
  jersey_size: z.enum(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'], {
    errorMap: () => ({ message: 'Pilih ukuran baju yang tersedia.' }),
  }),
  emergency_name: z.string().trim().min(2, 'Nama kontak darurat minimal 2 karakter.').max(100),
  emergency_phone: z.string().trim().min(8, 'Nomor telepon kontak darurat minimal 8 digit.').max(20),
});

const standardLabels: Record<string, string> = {
  full_name: 'Nama Lengkap (Sesuai KTP/ID)',
  phone: 'Nomor WhatsApp / HP',
  jersey_size: 'Ukuran Baju / Size Jersey',
  emergency_name: 'Nama Kontak Darurat',
  emergency_phone: 'Nomor Telepon Kontak Darurat',
};

export const POST = route(
  { auth: 'user', rate: [20, 60_000], schema: z.object({ answers: z.record(z.unknown()) }) },
  async ({ ctx, userId, body }) => {
    const sb = ctx.locals.supabase;
    const regId = ctx.params.id!;

    const { data: reg } = await sb.from('registrations').select('id, event_id').eq('id', regId).maybeSingle();
    if (!reg) throw new ApiError(404, 'not_found', 'Pendaftaran tidak ditemukan.');

    // 1. Validasi data diri standar peserta
    const stdParsed = standardParticipantSchema.safeParse(body.answers);
    if (!stdParsed.success) {
      const firstIssue = stdParsed.error.issues[0];
      throw new ApiError(422, 'validation_failed', firstIssue?.message || 'Data peserta belum lengkap.');
    }

    // 2. Validasi field kustom event (jika ada yang dikonfigurasi admin)
    const { data: fields } = await sb
      .from('event_form_fields')
      .select('field_key,label,field_type,options,is_required,validation_rules')
      .eq('event_id', reg.event_id)
      .eq('is_active', true);

    const customFields = (fields ?? []) as FormField[];
    let customAnswers: Record<string, unknown> = {};

    if (customFields.length > 0) {
      // Hanya ekstrak jawaban yang termasuk dalam field kustom event
      const customAnswersOnly: Record<string, unknown> = {};
      for (const f of customFields) {
        if (body.answers[f.field_key] !== undefined) {
          customAnswersOnly[f.field_key] = body.answers[f.field_key];
        }
      }

      const customParsed = buildAnswersSchema(customFields).safeParse(customAnswersOnly);
      if (!customParsed.success) {
        throw new ApiError(
          422,
          'validation_failed',
          customParsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        );
      }
      customAnswers = customParsed.data;
    }

    const db = adminDb() as any;

    // 3. Simpan jawaban data diri standar ke registration_answers
    for (const [key, val] of Object.entries(stdParsed.data)) {
      await db.from('registration_answers').upsert(
        {
          registration_id: reg.id,
          field_key: key,
          field_label_snapshot: standardLabels[key] || key,
          answer: JSON.stringify(val),
        },
        { onConflict: 'registration_id,field_key' }
      );
    }

    // 4. Simpan jawaban field kustom (jika ada) ke registration_answers
    for (const f of customFields) {
      if (customAnswers[f.field_key] !== undefined) {
        await db.from('registration_answers').upsert(
          {
            registration_id: reg.id,
            field_key: f.field_key,
            field_label_snapshot: f.label,
            answer: JSON.stringify(customAnswers[f.field_key]),
          },
          { onConflict: 'registration_id,field_key' }
        );
      }
    }

    // 5. Update data profil akun jika nama belum diset
    await db
      .from('profiles')
      .update({
        full_name: stdParsed.data.full_name,
        phone: stdParsed.data.phone,
      })
      .eq('id', userId)
      .is('full_name', null);

    // 6. Jalankan RPC submit_registration_answers untuk transisi status pendaftaran
    const combinedAnswers = { ...stdParsed.data, ...customAnswers };
    const { data, error } = await db.rpc('submit_registration_answers', {
      p_user: userId,
      p_registration: reg.id,
      p_answers: combinedAnswers,
    });

    if (error) dbError(error);
    return ok(data);
  }
);
