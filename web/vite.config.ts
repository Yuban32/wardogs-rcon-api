import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The panel is built against the library's **source**, not `dist`.
 *
 * The library publishes ESM, CJS and a UMD bundle, and the panel could consume
 * any of them — but every one of those needs a root `npm run build` first, and
 * a library edit would then need a second build before the panel saw it.
 * Aliasing to `../src/index.ts` removes both steps, and it exercises the
 * source through a real bundler on every panel build.
 *
 * It does mean the library's source is typechecked under the panel's
 * `tsconfig.json` — which is why that config copies the root's strict flags
 * rather than relaxing them.
 */
/**
 * The mock server sends no CORS headers, so a page served from localhost cannot
 * call it directly. The example proxy exists for exactly this, and pointing the
 * dev server at it means the panel works against the mock without any manual
 * step.
 *
 * Shared with `preview`, which does not inherit it — running the built bundle
 * would otherwise work everywhere except the one path the panel is built around.
 */
const proxy = {
  '/rcon-proxy': {
    target: process.env.WARDOGS_PROXY_TARGET ?? 'http://127.0.0.1:8787',
    changeOrigin: false,
  },
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@wardogs/api': resolve(here, '../src/index.ts'),
    },
  },
  server: {
    // Not Vite's default 5173. On Windows, `netsh int ipv4 show
    // excludedportrange protocol=tcp` commonly reserves a block covering it
    // (Hyper-V and Docker Desktop both do), and binding one of those fails with
    // `EACCES: permission denied` rather than "port in use" — which reads like
    // a permissions problem in Node and is not.
    port: 5300,
    proxy,
  },
  preview: {
    port: 5300,
    proxy,
  },
  build: {
    outDir: 'dist',
    // The panel is a local tool, but it is also the most demanding consumer the
    // library has — a bundler, in a browser, with JSX. Keep the output readable.
    minify: false,
    sourcemap: true,
  },
  // Node environment, no jsdom: the tests cover the route registry, the
  // connection settings and the formatters — pure logic, no components. A
  // component-test harness is a much heavier dependency than this panel needs,
  // and the parts worth testing are the parts that are not React.
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    restoreMocks: true,
  },
});
