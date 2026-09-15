/**
 * Build configuration for the UMD bundle.
 *
 * Run as a second invocation, after the ESM/CJS build, because:
 *
 * - UMD cannot be code-split, so everything must land in one file. A separate
 *   config sidesteps the question of whether combining formats would violate
 *   that.
 * - The output filename is set through `fileName` rather than `entryFileNames`
 *   so it comes out exactly as named, with no `.umd.cjs` suffix. A
 *   `<script src="...">` tag needs the URL to match what the CDN serves.
 * - The global name and the language target differ from the ESM build: a
 *   `<script>` tag is the one consumption path where the runtime version is
 *   unknown, so this drops to ES2018.
 */

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/umd.ts',
      name: 'WardogsRCON',
      formats: ['umd'],
      fileName: () => 'wardogs-rcon-api.umd.js',
    },
    target: 'es2018',
    // No source map. The ESM and CJS builds ship theirs, because a consumer
    // bundling this reads the TypeScript sources when they debug into it. This
    // build exists for a `<script>` tag, where nobody steps into the library —
    // and a map that references `../src/` is a 172 kB file served to every CDN
    // visitor for no benefit.
    sourcemap: false,
    minify: false,
    // The ESM/CJS build already cleaned the directory; emptying it here would
    // delete those outputs.
    emptyOutDir: false,
    rollupOptions: {
      // No runtime dependencies, so there is nothing to externalize — but be
      // explicit, so a stray import added later is a build error rather than a
      // silently bundled dependency.
      external: [],
    },
  },
});
