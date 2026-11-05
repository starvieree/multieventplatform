import type { APIRoute } from 'astro';
import { passwordSchema } from '../../../lib/validations/schemas';
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.user) return redirect('/forgot-password?error=expired', 303);
  const f = await request.formData();
  const pw = passwordSchema.safeParse(f.get('password'));
  if (!pw.success) return redirect('/reset-password?error=weak', 303);
  if (f.get('password') !== f.get('confirm')) return redirect('/reset-password?error=mismatch', 303);
  const { error } = await locals.supabase.auth.updateUser({ password: pw.data });
  return redirect(error ? '/reset-password?error=failed' : '/dashboard/profile/security?updated=1', 303);
};
