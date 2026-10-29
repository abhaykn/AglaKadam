import { withSupabase } from '../_shared/deps.ts';
import { failure } from '../_shared/http.ts';
import { accountServices, loadCaller, readJsonBody, serve } from '../_shared/platform.ts';
import { handleAccountAdmin } from './handler.ts';

export default {
  fetch: withSupabase({ auth: 'user' }, (req, ctx) =>
    serve('account-admin', req, async () => {
      const caller = await loadCaller(ctx.supabase);
      if (!caller) {
        return failure(403, 'forbidden');
      }
      return handleAccountAdmin(
        await readJsonBody(req),
        caller,
        accountServices(ctx.supabaseAdmin, ctx.supabase),
      );
    }),
  ),
};
