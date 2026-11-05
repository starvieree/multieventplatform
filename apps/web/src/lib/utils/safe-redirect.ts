// Redirect hanya ke path internal. Menolak //host, \, skema, karakter kontrol, dan /api.
export function safeRedirect(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || typeof next !== 'string' || next.length > 500) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\u0000-\u001f]/.test(next)) return fallback;
  try {
    const u = new URL(next, 'http://internal.invalid');
    if (u.origin !== 'http://internal.invalid' || u.pathname.startsWith('/api/')) return fallback;
    return u.pathname + u.search + u.hash;
  } catch { return fallback; }
}
