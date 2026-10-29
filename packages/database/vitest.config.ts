import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each test file boots its own in-process Postgres and applies every migration.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
