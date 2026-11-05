import { z } from 'zod';
import { fromInputDateTime, slugify } from './utils/format';
import { ApiError } from './utils/api';

export type Field = { key: string; label: string; type: 'text' | 'textarea' | 'number' | 'url' | 'datetime' | 'select' | 'checkbox' | 'image'; options?: string[]; required?: boolean; hint?: string };
export type Col = { key: string; label: string; type?: 'text' | 'date' | 'datetime' | 'money' | 'badge' | 'link' };
export type Resource = {
  slug: string; api: string; table: string; title: string; perm: string; select: string; search: string[]; statusCol?: string; statusOptions?: string[];
  cols: Col[]; fields: Field[]; create?: boolean; edit?: boolean; order: string; detail?: boolean;
  prepare?: (row: Record<string, any>, existing?: Record<string, any>) => Record<string, any>;
};
const STATUS_NEW = ['new', 'reviewing', 'approved', 'rejected'];
export const RESOURCES: Record<string, Resource> = {
  events: { slug: 'events', api: 'events', table: 'events', title: 'Event', perm: 'events.manage', select: 'id,title,slug,status,start_at,total_quota,category:event_categories(name)', search: ['title', 'slug'], statusCol: 'status', statusOptions: ['draft', 'published', 'registration_closed', 'ongoing', 'completed', 'archived'],
    cols: [{ key: 'title', label: 'Event', type: 'link' }, { key: 'category.name', label: 'Kategori' }, { key: 'status', label: 'Status', type: 'badge' }, { key: 'start_at', label: 'Mulai', type: 'datetime' }, { key: 'total_quota', label: 'Kuota' }], fields: [], create: true, order: 'created_at' },
  categories: { slug: 'categories', api: 'event-categories', table: 'event_categories', title: 'Kategori event', perm: 'categories.manage', select: '*', search: ['name', 'slug'], create: true, edit: true, order: 'name',
    cols: [{ key: 'name', label: 'Nama', type: 'link' }, { key: 'slug', label: 'Slug' }, { key: 'is_active', label: 'Aktif' }],
    fields: [{ key: 'name', label: 'Nama', type: 'text', required: true }, { key: 'slug', label: 'Slug', type: 'text', hint: 'Kosongkan untuk dibuat otomatis.' }, { key: 'description', label: 'Deskripsi', type: 'textarea' }, { key: 'icon', label: 'Ikon', type: 'text' }, { key: 'is_active', label: 'Aktif', type: 'checkbox' }],
    prepare: (r) => ({ ...r, slug: r.slug || slugify(r.name ?? '') }) },
  blogs: { slug: 'blogs', api: 'blogs', table: 'blogs', title: 'Blog', perm: 'blogs.manage', select: 'id,title,slug,status,category,published_at', search: ['title', 'slug'], statusCol: 'status', statusOptions: ['draft', 'published'], create: true, edit: true, order: 'created_at',
    cols: [{ key: 'title', label: 'Judul', type: 'link' }, { key: 'category', label: 'Kategori' }, { key: 'status', label: 'Status', type: 'badge' }, { key: 'published_at', label: 'Terbit', type: 'date' }],
    fields: [{ key: 'title', label: 'Judul', type: 'text', required: true }, { key: 'slug', label: 'Slug', type: 'text' }, { key: 'category', label: 'Kategori', type: 'text' }, { key: 'excerpt', label: 'Ringkasan', type: 'textarea' }, { key: 'content', label: 'Isi (Markdown)', type: 'textarea', required: true },
      { key: 'thumbnail_path', label: 'Thumbnail', type: 'image' }, { key: 'status', label: 'Status', type: 'select', options: ['draft', 'published'], required: true }, { key: 'meta_title', label: 'Meta title', type: 'text' }, { key: 'meta_description', label: 'Meta description', type: 'textarea' }],
    prepare: (r, ex) => ({ ...r, slug: r.slug || slugify(r.title ?? ''), published_at: r.status === 'published' ? ex?.published_at ?? new Date().toISOString() : null }) },
  banners: { slug: 'banners', api: 'banners', table: 'banners', title: 'Banner', perm: 'banners.manage', select: '*', search: ['title'], create: true, edit: true, order: 'sort_order',
    cols: [{ key: 'title', label: 'Judul', type: 'link' }, { key: 'sort_order', label: 'Urutan' }, { key: 'is_active', label: 'Aktif' }, { key: 'ends_at', label: 'Berakhir', type: 'date' }],
    fields: [{ key: 'title', label: 'Judul', type: 'text', required: true }, { key: 'description', label: 'Deskripsi', type: 'textarea' }, { key: 'image_path', label: 'Gambar', type: 'image' }, { key: 'alt_text', label: 'Teks alternatif', type: 'text', required: true }, { key: 'cta_label', label: 'Label tombol', type: 'text' }, { key: 'cta_url', label: 'Tautan tombol', type: 'url' },
      { key: 'starts_at', label: 'Mulai tayang', type: 'datetime' }, { key: 'ends_at', label: 'Selesai tayang', type: 'datetime' }, { key: 'sort_order', label: 'Urutan', type: 'number' }, { key: 'is_active', label: 'Aktif', type: 'checkbox' }] },
  partnerships: { slug: 'partnerships', api: 'partnerships', table: 'partnerships', title: 'Pengajuan partnership', perm: 'partnerships.manage', select: 'id,organization_name,contact_name,email,organization_type,status,created_at', search: ['organization_name', 'contact_name', 'email'], statusCol: 'status', statusOptions: STATUS_NEW, edit: true, detail: true, order: 'created_at',
    cols: [{ key: 'organization_name', label: 'Organisasi', type: 'link' }, { key: 'contact_name', label: 'Kontak' }, { key: 'organization_type', label: 'Tipe' }, { key: 'status', label: 'Status', type: 'badge' }, { key: 'created_at', label: 'Masuk', type: 'date' }],
    fields: [{ key: 'status', label: 'Status', type: 'select', options: STATUS_NEW, required: true }, { key: 'internal_note', label: 'Catatan internal', type: 'textarea' }] },
  messages: { slug: 'messages', api: 'contact-messages', table: 'contact_messages', title: 'Pesan kontak', perm: 'messages.manage', select: 'id,name,email,subject,status,created_at', search: ['name', 'email', 'subject'], statusCol: 'status', statusOptions: ['new', 'read', 'replied', 'closed'], edit: true, detail: true, order: 'created_at',
    cols: [{ key: 'subject', label: 'Subjek', type: 'link' }, { key: 'name', label: 'Pengirim' }, { key: 'status', label: 'Status', type: 'badge' }, { key: 'created_at', label: 'Masuk', type: 'date' }],
    fields: [{ key: 'status', label: 'Status', type: 'select', options: ['new', 'read', 'replied', 'closed'], required: true }, { key: 'internal_note', label: 'Catatan internal', type: 'textarea' }] },
  participants: { slug: 'participants', api: 'participants', table: 'profiles', title: 'Peserta', perm: 'participants.view', select: 'id,full_name,email,phone,account_status,created_at', search: ['full_name', 'email'], statusCol: 'account_status', statusOptions: ['active', 'suspended'], order: 'created_at',
    cols: [{ key: 'full_name', label: 'Nama', type: 'link' }, { key: 'email', label: 'Email' }, { key: 'account_status', label: 'Status', type: 'badge' }, { key: 'created_at', label: 'Bergabung', type: 'date' }], fields: [] },
  registrations: { slug: 'registrations', api: 'registrations', table: 'registrations', title: 'Pendaftaran', perm: 'registrations.view', select: 'id,registration_code,registration_status,payment_status,total_amount,created_at,event:events(title),profile:profiles(full_name)', search: ['registration_code'], statusCol: 'registration_status', statusOptions: ['draft', 'awaiting_payment', 'confirmed', 'cancelled', 'expired'], order: 'created_at',
    cols: [{ key: 'registration_code', label: 'Kode', type: 'link' }, { key: 'event.title', label: 'Event' }, { key: 'profile.full_name', label: 'Peserta' }, { key: 'registration_status', label: 'Status', type: 'badge' }, { key: 'payment_status', label: 'Bayar', type: 'badge' }, { key: 'total_amount', label: 'Total', type: 'money' }], fields: [] },
  transactions: { slug: 'transactions', api: 'transactions', table: 'transactions', title: 'Transaksi', perm: 'transactions.view', select: 'id,order_id,transaction_status,gross_amount,payment_type,created_at,paid_at', search: ['order_id'], statusCol: 'transaction_status', statusOptions: ['pending', 'paid', 'failed', 'expired', 'cancelled', 'refunded', 'partially_refunded'], order: 'created_at',
    cols: [{ key: 'order_id', label: 'Order', type: 'link' }, { key: 'transaction_status', label: 'Status', type: 'badge' }, { key: 'gross_amount', label: 'Nominal', type: 'money' }, { key: 'payment_type', label: 'Metode' }, { key: 'created_at', label: 'Dibuat', type: 'datetime' }], fields: [] },
  'audit-logs': { slug: 'audit-logs', api: 'activity-logs', table: 'activity_logs', title: 'Audit log', perm: 'audit.view', select: 'id,action,resource_type,resource_id,actor_user_id,actor_type,reason,request_id,created_at', search: ['action', 'resource_type'], order: 'created_at',
    cols: [{ key: 'created_at', label: 'Waktu', type: 'datetime' }, { key: 'action', label: 'Aksi' }, { key: 'resource_type', label: 'Objek' }, { key: 'resource_id', label: 'ID' }, { key: 'actor_type', label: 'Pelaku' }, { key: 'reason', label: 'Alasan' }], fields: [] },
};
export const byApi = (api: string) => Object.values(RESOURCES).find((r) => r.api === api);

export function schemaFor(res: Resource, partial = false) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of res.fields) {
    let s: z.ZodTypeAny;
    switch (f.type) {
      case 'number': s = z.coerce.number().int().min(0).max(100000); break;
      case 'checkbox': s = z.boolean(); break;
      case 'select': s = z.enum(f.options as [string, ...string[]]); break;
      case 'datetime': s = z.string().max(20).transform((v) => (v ? fromInputDateTime(v) : null)); break;
      case 'url': s = z.string().trim().max(500).refine((v) => v === '' || v.startsWith('https://') || v.startsWith('/'), 'harus https:// atau path internal').transform((v) => v || null); break;
      default: { const t = z.string().trim().max(f.type === 'textarea' ? 50000 : 300); s = f.required ? t.min(1) : t.transform((v) => v || null); }
    }
    shape[f.key] = s;
  }
  const o = z.object(shape).strict();
  return partial ? o.partial() : o;
}
export const can = (l: { roles: string[]; permissions: string[] }, perm: string) => l.roles.includes('super_admin') || l.permissions.includes(perm);
export function assertPerm(l: { roles: string[]; permissions: string[] }, perm: string) { if (!can(l, perm)) throw new ApiError(403, 'forbidden', 'Anda tidak memiliki izin untuk tindakan ini.'); }
export const cleanSearch = (s: string | null) => (s ?? '').replace(/[,()%*\\]/g, ' ').trim().slice(0, 80);
