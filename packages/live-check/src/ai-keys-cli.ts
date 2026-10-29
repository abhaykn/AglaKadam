import { storeAiKeys } from './ai-keys.ts';

storeAiKeys().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
