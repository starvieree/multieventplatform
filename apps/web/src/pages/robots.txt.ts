import type { APIRoute } from 'astro';
export const GET: APIRoute = ({ site }) => new Response(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /registration\nDisallow: /tiket-saya\nDisallow: /pesanan\nDisallow: /profil\nDisallow: /notifikasi\nDisallow: /api\nSitemap: ${new URL('/sitemap.xml', site)}\n`, { headers: { 'Content-Type': 'text/plain' } });
