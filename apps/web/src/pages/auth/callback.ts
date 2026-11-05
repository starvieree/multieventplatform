import type { APIRoute } from 'astro';
import { safeRedirect } from '../../lib/utils/safe-redirect';
// Menukar kode verifikasi email / reset password menjadi sesi (cookie httpOnly).
export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const code = url.searchParams.get('code');
  if (code) { const { error } = await locals.supabase.auth.exchangeCodeForSession(code); if (error) return redirect('/login?error=link', 303); }
  return redirect(safeRedirect(url.searchParams.get('next')), 303);
};
