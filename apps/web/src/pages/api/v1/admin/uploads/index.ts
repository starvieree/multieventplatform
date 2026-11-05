import { route, ok, ApiError, audit } from '../../../../../lib/utils/api';
import { adminDb } from '../../../../../lib/supabase/server';
const MAX = 2 * 1024 * 1024;
// Validasi berdasarkan isi file (magic bytes), bukan hanya ekstensi/Content-Type; nama file dibuat server (UUID).
const sniff = (b: Uint8Array): { ext: string; mime: string } | null => {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return { ext: 'webp', mime: 'image/webp' };
  return null;
};
export const POST = route({ auth: 'admin', rate: [20, 60_000] }, async ({ ctx, userId, rid }) => {
  const f = (await ctx.request.formData().catch(() => null))?.get('file');
  if (!(f instanceof File)) throw new ApiError(400, 'invalid_request', 'Berkas tidak ditemukan.');
  if (f.size === 0 || f.size > MAX) throw new ApiError(413, 'too_large', 'Ukuran gambar maksimal 2 MB.');
  const buf = new Uint8Array(await f.arrayBuffer()), kind = sniff(buf);
  if (!kind) throw new ApiError(415, 'unsupported', 'Format harus JPG, PNG, atau WebP.');
  const path = `uploads/${crypto.randomUUID()}.${kind.ext}`;
  const { error } = await adminDb().storage.from('media').upload(path, buf, { contentType: kind.mime, upsert: false });
  if (error) throw new Error('STORAGE_ERROR');
  await audit(adminDb(), { actor: userId, action: 'uploads.create', type: 'storage', id: path, rid });
  return ok({ path }, {}, 201);
});
