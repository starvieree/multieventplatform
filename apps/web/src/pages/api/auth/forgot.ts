import type { APIRoute } from 'astro';
import { rateLimit } from '../../../lib/utils/rate-limit';
import { emailSchema } from '../../../lib/validations/schemas';
export const POST: APIRoute = async ({ request, locals, redirect, clientAddress, site, url }) => {
  const f = await request.formData();
  const email = emailSchema.safeParse(f.get('email'));
  const redirectBase = url?.origin || site || 'http://localhost:4321';
  if (email.success && rateLimit(`forgot:${clientAddress}`, 5, 600_000)) await locals.supabase.auth.resetPasswordForEmail(email.data, { redirectTo: new URL('/auth/callback?next=/reset-password', redirectBase).toString() });
  return redirect('/forgot-password?sent=1', 303);                      // selalu sama: tidak ada user enumeration
};
