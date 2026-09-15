import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The spec-conformance tests read `spec/openapi.json` from disk, and the
    // HTTP tests drive a real local server, so no jsdom or happy-dom here.
    globals: false,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/umd.ts', 'src/index.ts'],
    },
  },
});
