import { createClient } from '@supabase/supabase-js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Muat otomatis file .env jika belum dimuat (Node 20+ / tsx)
const candidates = [
  resolve(process.cwd(), 'apps/worker/.env'),
  resolve(process.cwd(), '.env'),
  fileURLToPath(new URL('../../.env', import.meta.url)),
  fileURLToPath(new URL('../../../.env', import.meta.url)),
  fileURLToPath(new URL('../../../../.env', import.meta.url)),
];
for (const p of candidates) {
  if (existsSync(p)) {
    try {
      process.loadEnvFile(p);
    } catch {}
  }
}

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`Env ${k} wajib diisi`); return v; };
export const db = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
export const config = {
  rabbitUrl: need('RABBITMQ_URL'),
  concurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 5)),
  midtransKey: process.env.MIDTRANS_SERVER_KEY ?? '',
  midtransProd: process.env.MIDTRANS_IS_PRODUCTION === 'true',
};
