import { withSupabase } from '../_shared/deps.ts';
import { isRecord } from '../_shared/http.ts';
import {
  bearerToken,
  clientKeyFor,
  demoServices,
  readJsonBody,
  serve,
  userOfToken,
} from '../_shared/platform.ts';
import { handleDemoStart, handleDemoSweep, handleDemoSwitch } from './handler.ts';
import { RECORDINGS, recordingBytes } from './recordings.ts';

// Visitors are not signed in when they start, and the hourly sweep is called by the database with
// the job token from Vault; the platform's JWT check is disabled for this function in config.toml.
// Switching roles reads the visitor's own session from the request.
const enabled = (Deno.env.get('DEMO_ENABLED') ?? '').trim() === 'true';

export default {
  fetch: withSupabase({ auth: 'none' }, (req, ctx) =>
    serve('demo', req, async () => {
      const body = await readJsonBody(req);
      const services = demoServices(ctx.supabaseAdmin);
      const action = isRecord(body) ? body.action : undefined;
      if (action === 'sweep') {
        return handleDemoSweep(req.headers.get('x-job-token'), services);
      }
      if (action === 'switch') {
        return handleDemoSwitch(
          body,
          await userOfToken(ctx.supabaseAdmin, bearerToken(req)),
          services,
        );
      }
      return handleDemoStart(
        body,
        await clientKeyFor(req),
        services,
        { list: RECORDINGS, bytes: (key) => Promise.resolve(recordingBytes(key)) },
        enabled,
      );
    }),
  ),
};
