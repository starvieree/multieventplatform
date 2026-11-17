import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// SSR untuk route privat/admin/API. Script & CSS dipisah ke file (tidak di-inline) agar CSP ketat tanpa 'unsafe-inline' untuk script.
export default defineConfig({
  output: 'server',
  server: {
    host: true,
  },
  adapter: vercel(),
  site: process.env.PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:4321'),
  security: { checkOrigin: false },
  build: { inlineStylesheets: 'never' },
  vite: {
    build: { assetsInlineLimit: 0 },
    server: {
      allowedHosts: true,
    },
  },
});
