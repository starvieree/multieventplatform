import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';

// Klien per-request memakai anon key + cookie sesi -> tunduk pada RLS.
export function createSupabase(request: Request, cookies: AstroCookies) {
  return createServerClient(import.meta.env.PUBLIC_SUPABASE_URL, import.meta.env.PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => parseCookieHeader(request.headers.get('Cookie') ?? '').map((c) => ({ name: c.name, value: c.value ?? '' })),
      setAll: (list) => list.forEach(({ name, value, options }) => cookies.set(name, value, { ...options, httpOnly: true, secure: import.meta.env.PROD, sameSite: 'lax', path: '/' })),
    },
  });
}

// service_role: hanya di server, hanya setelah authorization diperiksa. Tidak pernah diimpor dari komponen client.
let admin: ReturnType<typeof createClient> | undefined;
export function adminDb() {
  admin ??= createClient(import.meta.env.PUBLIC_SUPABASE_URL, import.meta.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
