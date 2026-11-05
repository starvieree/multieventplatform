import type { APIRoute } from 'astro';
import { rateLimit } from '../../../lib/utils/rate-limit';
import { safeRedirect } from '../../../lib/utils/safe-redirect';
import { emailSchema } from '../../../lib/validations/schemas';

export const POST: APIRoute = async ({ request, locals, redirect, clientAddress }) => {
  const f = await request.formData();
  const next = safeRedirect(String(f.get('next') ?? ''));
  const back = (e: string) => redirect(`/login?error=${e}&next=${encodeURIComponent(next)}`, 303);
  if (!rateLimit(`signin:${clientAddress}`, 10, 60_000)) return back('rate');
  const email = emailSchema.safeParse(f.get('email')), password = String(f.get('password') ?? '');
  if (!email.success || !password || password.length > 72) return back('invalid');
  const { data, error } = await locals.supabase.auth.signInWithPassword({ email: email.data, password });
  if (error || !data.user) return back('invalid');                       // pesan generik: tidak membocorkan apakah email terdaftar
  const { data: prof } = await locals.supabase.from('profiles').select('account_status').eq('id', data.user.id).maybeSingle();
  if (prof?.account_status === 'suspended') { await locals.supabase.auth.signOut(); return back('suspended'); }
  return redirect(next, 303);
};
