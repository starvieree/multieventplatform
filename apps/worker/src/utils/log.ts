const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
const current = levels[(process.env.LOG_LEVEL as keyof typeof levels) ?? 'info'] ?? 20;
const SECRET = /(key|secret|token|password|authorization|url)/i;
const scrub = (o: unknown): unknown =>
  o && typeof o === 'object' ? Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, SECRET.test(k) ? '[redacted]' : scrub(v)])) : o;
export function log(level: keyof typeof levels, msg: string, ctx: Record<string, unknown> = {}) {
  if (levels[level] < current) return;
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...(scrub(ctx) as object) }));
}
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
