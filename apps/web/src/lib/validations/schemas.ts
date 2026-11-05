import { z } from 'zod';
const text = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) => z.string().trim().max(max).optional().or(z.literal('')).transform((v) => v || null);

export const queueSchema = z.object({
  event_id: z.string().uuid(), ticket_category_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(10), idempotency_key: z.string().min(8).max(100),
});
export const contactSchema = z.object({
  name: text(100), email: z.string().trim().email().max(150), subject: text(150), message: text(3000),
  consent: z.literal(true, { errorMap: () => ({ message: 'harus disetujui' }) }), hp: z.string().max(0).optional(),
});
export const partnershipSchema = z.object({
  organization_name: text(150), contact_name: text(100), email: z.string().trim().email().max(150), phone: optional(30),
  organization_type: z.enum(['komunitas', 'organisasi', 'institusi', 'perusahaan']), website: z.string().url().max(200).optional().or(z.literal('')).transform((v) => v || null),
  description: text(3000), consent: z.literal(true, { errorMap: () => ({ message: 'harus disetujui' }) }), hp: z.string().max(0).optional(),
});
export const profileSchema = z.object({ full_name: text(100), phone: optional(30) });
export const emailSchema = z.string().trim().email().max(150);
export const passwordSchema = z.string().min(10, 'minimal 10 karakter').max(72);

// Validasi jawaban formulir dinamis dari definisi event_form_fields (server-side; client hanya UX).
export type FormField = { field_key: string; label: string; field_type: string; options: string[]; is_required: boolean; validation_rules?: { min?: number; max?: number; maxLength?: number } };
export function buildAnswersSchema(fields: FormField[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    const r = f.validation_rules ?? {};
    let s: z.ZodTypeAny;
    switch (f.field_type) {
      case 'number': s = z.coerce.number().min(r.min ?? -1e12).max(r.max ?? 1e12); break;
      case 'email': s = z.string().trim().email().max(150); break;
      case 'tel': s = z.string().trim().regex(/^[0-9+()\-\s]{6,20}$/, 'nomor tidak valid'); break;
      case 'checkbox': s = z.boolean(); break;
      case 'date': s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/); break;
      case 'select': s = z.string().refine((v) => (f.options ?? []).includes(v), 'pilihan tidak valid'); break;
      default: s = z.string().trim().max(r.maxLength ?? (f.field_type === 'textarea' ? 2000 : 255));
    }
    if (f.is_required) s = f.field_type === 'checkbox' ? z.literal(true, { errorMap: () => ({ message: 'wajib dicentang' }) }) : s.refine((v) => v !== '' && v != null, 'wajib diisi');
    else s = s.optional().or(z.literal(''));
    shape[f.field_key] = s;
  }
  return z.object(shape).strict();
}
