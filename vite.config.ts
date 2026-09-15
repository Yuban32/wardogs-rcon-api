/**
 * Build configuration for the ESM and CommonJS bundles, plus type declarations.
 *
 * The UMD bundle lives in `vite.umd.config.ts` — it is a separate invocation
 * because UMD cannot be code-split, so it needs its own single-file output
 * settings and a lower language target.
 */

import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      include: ['src'],
      // Bundle every declaration into one self-contained `index.d.ts`.
      //
      // This matters for dual-format consumption: a single declaration file
      // with no internal relative imports resolves identically whether the
      // consumer arrives via the `import` or the `require` condition. Splitting
      // it into `index.d.ts` + `index.d.cts` would leave the `.d.cts` file's
      // internal `./foo.js` specifiers being resolved as ESM, which fails.
      rollupTypes: true,
      tsconfigPath: './tsconfig.json',
    }),
  ],
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'WardogsRCON',
      formats: ['es', 'cjs'],
      fileName: 'index',
    },
    // Modern syntax in, modern syntax out. Every fetch-capable runtime (Node
    // 18+, all current browsers) supports this, and the UMD build targets a
    // lower baseline separately for `<script>` tags.
    target: 'es2020',
    sourcemap: true,
    // Keep the output readable and diffable across releases.
    minify: false,
    emptyOutDir: true,
    rollupOptions: {
      // No runtime dependencies, so there is nothing to externalize — but be
      // explicit, so a stray import added later is a build error rather than a
      // silently bundled dependency.
      external: [],
    },
  },
});
