import type { APIRoute } from 'astro';
import { rateLimit } from '../../../lib/utils/rate-limit';
import { emailSchema, passwordSchema, profileSchema } from '../../../lib/validations/schemas';

export const POST: APIRoute = async ({ request, locals, redirect, clientAddress, site, url }) => {
  const f = await request.formData();
  const back = (e: string) => redirect(`/register?error=${e}`, 303);
  if (!rateLimit(`signup:${clientAddress}`, 5, 600_000)) return back('rate');
  const email = emailSchema.safeParse(f.get('email')), pw = passwordSchema.safeParse(f.get('password')), prof = profileSchema.safeParse({ full_name: f.get('full_name'), phone: f.get('phone') ?? '' });
  if (!email.success || !prof.success || f.get('consent') !== 'on') return back('invalid');
  if (!pw.success) return back('weak');
  if (f.get('password') !== f.get('confirm')) return back('mismatch');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url?.host;
  const proto = request.headers.get('x-forwarded-proto') || (host?.startsWith('localhost') ? 'http' : 'https');
  const redirectBase = host ? `${proto}://${host}` : (site || 'http://localhost:4321');
  const { error: signUpErr } = await locals.supabase.auth.signUp({
    email: email.data,
    password: pw.data,
    options: {
      data: { full_name: prof.data.full_name, phone: prof.data.phone },
      emailRedirectTo: new URL('/auth/callback', redirectBase).toString(),
    },
  });
  if (signUpErr) {
    console.error('Supabase signup error:', signUpErr.message);
    if (signUpErr.status === 429) return back('rate');
  }
  return redirect('/login?registered=1', 303);                          // respons sama baik email baru maupun sudah ada
};
