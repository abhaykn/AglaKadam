import { withSupabase } from '../_shared/deps.ts';
import { failure } from '../_shared/http.ts';
import {
  bearerToken,
  loadCaller,
  passwordServices,
  readJsonBody,
  serve,
} from '../_shared/platform.ts';
import { handlePasswordChange, passwordAuthenticatedAt } from './handler.ts';

export default {
  fetch: withSupabase({ auth: 'user' }, (req, ctx) =>
    serve('account-password', req, async () => {
      const caller = await loadCaller(ctx.supabase);
      if (!caller) {
        return failure(403, 'forbidden');
      }
      return handlePasswordChange(
        await readJsonBody(req),
        caller,
        passwordAuthenticatedAt(ctx.jwtClaims),
        Math.floor(Date.now() / 1000),
        passwordServices(ctx.supabaseAdmin, caller.userId, bearerToken(req)),
      );
    }),
  ),
};
