import type { APIRoute } from 'astro';
export const GET: APIRoute = async ({ site, locals }) => {
  const sb = locals.supabase;
  const [ev, bl] = await Promise.all([sb.from('event_listing').select('slug,start_at').in('status', ['published', 'registration_closed', 'ongoing']), sb.from('blogs').select('slug,updated_at').eq('status', 'published')]);
  const u = (p: string, d?: string) => `<url><loc>${new URL(p, site)}</loc>${d ? `<lastmod>${new Date(d).toISOString()}</lastmod>` : ''}</url>`;
  const body = ['/', '/tentang', '/events', '/partnership', '/blog', '/kontak', '/privacy', '/terms'].map((p) => u(p)).concat((ev.data ?? []).map((e) => u(`/events/${e.slug}`)), (bl.data ?? []).map((b) => u(`/blog/${b.slug}`, b.updated_at))).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, { headers: { 'Content-Type': 'application/xml' } });
};
