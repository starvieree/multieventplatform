import { z } from 'zod';
import { route, ok, ApiError, audit } from '../../../../../../lib/utils/api';
import { adminDb } from '../../../../../../lib/supabase/server';
const ALLOWED: Record<string, string[]> = { draft: ['published', 'archived'], published: ['registration_closed', 'ongoing', 'archived', 'draft'], registration_closed: ['published', 'ongoing', 'archived'], ongoing: ['completed'], completed: ['archived'], archived: ['draft'] };
export const POST = route({ auth: 'admin', perm: 'events.manage', schema: z.object({ status: z.enum(['draft', 'published', 'registration_closed', 'ongoing', 'completed', 'archived']) }) }, async ({ ctx, userId, body, rid }) => {
  const db = adminDb();
  const { data: e } = await db.from('events').select('id,status,title,slug,start_at,registration_opens_at,registration_closes_at').eq('id', ctx.params.id!).maybeSingle();
  if (!e) throw new ApiError(404, 'not_found', 'Event tidak ditemukan.');
  if (!ALLOWED[e.status]?.includes(body.status)) throw new ApiError(409, 'INVALID_STATE', 'Perubahan status tersebut tidak diizinkan.');
  if (body.status === 'published') {   // validasi sebelum publish
    const { count } = await db.from('ticket_categories').select('id', { count: 'exact', head: true }).eq('event_id', e.id).eq('is_active', true);
    if (!count) throw new ApiError(422, 'validation_failed', 'Tambahkan minimal satu kategori tiket aktif sebelum mempublikasikan event.');
    if (!e.title || !e.slug) throw new ApiError(422, 'validation_failed', 'Judul dan slug wajib diisi.');
  }
  await db.from('events').update({ status: body.status }).eq('id', e.id);
  await audit(db, { actor: userId, action: 'events.status', type: 'events', id: e.id, before: { status: e.status }, after: { status: body.status }, rid });
  return ok({ status: body.status });
});
