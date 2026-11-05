import { route, ok } from '../../../../../../lib/utils/api';
export const PATCH = route({ auth: 'user', rate: [60, 60_000] }, async ({ ctx }) => {
  await ctx.locals.supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', ctx.params.id!).is('read_at', null);
  return ok({ read: true });
});
