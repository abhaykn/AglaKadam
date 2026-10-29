import { withSupabase } from '../_shared/deps.ts';
import { clientKeyFor, familySignInServices, readJsonBody, serve } from '../_shared/platform.ts';
import { handleFamilySignIn } from './handler.ts';

// Families are not signed in yet, so the request carries only the publishable key. The platform's
// own JWT check is disabled for this function in config.toml; the key is checked here instead.
export default {
  fetch: withSupabase({ auth: 'publishable' }, (req, ctx) =>
    serve('family-sign-in', req, async () =>
      handleFamilySignIn(
        await readJsonBody(req),
        await clientKeyFor(req),
        familySignInServices(ctx.supabaseAdmin),
      ),
    ),
  ),
};
