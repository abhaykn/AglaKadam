import { storePushKeys } from './push-keys.ts';

storePushKeys().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
