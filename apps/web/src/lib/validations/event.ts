import { z } from 'zod';
import { fromInputDateTime } from '../utils/format';
const opt = (n: number) => z.string().trim().max(n).optional().transform((v) => v || null);
const dt = z.string().min(10).transform((v) => (v.includes('T') && v.length <= 16 ? fromInputDateTime(v) : new Date(v).toISOString()));
const dtOpt = z.string().optional().transform((v) => (v ? fromInputDateTime(v) : null));

export const eventBodySchema = z.object({
  event: z.object({
    category_id: z.string().uuid().nullable().optional().transform((v) => v ?? null), organizer_name: opt(150), title: z.string().trim().min(3).max(200), slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug huruf kecil, angka, dan tanda hubung').max(120),
    summary: opt(400), description: opt(20000), poster_path: opt(300), banner_path: opt(300), poster_alt: opt(200), event_type: z.enum(['offline', 'online', 'hybrid']), venue_name: opt(200), address: opt(400),
    online_url: z.string().trim().url().max(400).optional().or(z.literal('')).transform((v) => v || null), start_at: dt, end_at: dt, registration_opens_at: dt, registration_closes_at: dt,
    total_quota: z.coerce.number().int().min(0).max(1_000_000), max_per_user: z.coerce.number().int().min(1).max(20),
    allow_multiple_categories: z.boolean().default(false), requirements: opt(5000),
    faq: z.array(z.object({ q: z.string().trim().min(1).max(200), a: z.string().trim().min(1).max(2000) })).max(30).default([]), meta_title: opt(120), meta_description: opt(300), og_image_path: opt(300),
  }).refine((e) => new Date(e.end_at!) >= new Date(e.start_at!), { message: 'waktu selesai harus setelah waktu mulai', path: ['end_at'] })
    .refine((e) => new Date(e.registration_closes_at!) >= new Date(e.registration_opens_at!), { message: 'penutupan pendaftaran harus setelah pembukaan', path: ['registration_closes_at'] }),
  ticket_categories: z.array(z.object({ id: z.string().uuid().optional().or(z.literal('')).transform((v) => v || undefined), name: z.string().trim().min(1).max(100), description: opt(300), price: z.coerce.number().min(0).max(1e9),
    quota: z.coerce.number().int().min(0).max(1_000_000), sales_start_at: dtOpt, sales_end_at: dtOpt, is_active: z.boolean().default(true) })).max(20),
  form_fields: z.array(z.object({ field_key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,40}$/, 'key huruf kecil/angka/underscore'), label: z.string().trim().min(1).max(120), field_type: z.enum(['text', 'textarea', 'number', 'email', 'tel', 'select', 'checkbox', 'date']),
    options: z.array(z.string().trim().min(1).max(100)).max(50).default([]), is_required: z.boolean().default(false), sort_order: z.number().int().default(0) })).max(40),
}).superRefine((b, ctx) => {
  const sum = b.ticket_categories.reduce((a, t) => a + t.quota, 0);
  if (b.ticket_categories.some((t) => t.quota > b.event.total_quota)) ctx.addIssue({ code: 'custom', message: 'kuota kategori tidak boleh melebihi kuota total event', path: ['ticket_categories'] });
  const keys = b.form_fields.map((f) => f.field_key); if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: 'field_key harus unik', path: ['form_fields'] });
  void sum;
});
export type EventBody = z.infer<typeof eventBodySchema>;
export const toRpc = (b: EventBody) => ({ p_event: b.event, p_tickets: b.ticket_categories.map((t) => ({ ...t, id: t.id ?? '' })), p_fields: b.form_fields.map((f, i) => ({ ...f, sort_order: i })) });
