import { withSupabase } from '../_shared/deps.ts';
import { retentionServices, serve } from '../_shared/platform.ts';
import { handleRetention } from './handler.ts';

// Called by the database's daily job, not by people. The platform's JWT check is disabled for this
// function in config.toml; the job token from Vault is checked here instead.
export default {
  fetch: withSupabase({ auth: 'none' }, (req, ctx) =>
    serve('pulse-retention', req, () =>
      handleRetention(req.headers.get('x-job-token'), retentionServices(ctx.supabaseAdmin)),
    ),
  ),
};
