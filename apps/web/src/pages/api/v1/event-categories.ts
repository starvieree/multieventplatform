import { route, ok } from '../../../lib/utils/api';
export const GET = route({}, async ({ ctx }) => { const { data } = await ctx.locals.supabase.from('event_categories').select('id,name,slug,description,icon').eq('is_active', true).order('name'); return ok(data); });
