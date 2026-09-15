/**
 * Build orchestrator.
 *
 * Runs the two Vite invocations in sequence and then verifies the result.
 * The verification is the point: a build that exits zero without emitting the
 * UMD file, or with a `VERSION` constant that has drifted from
 * `package.json`, is a broken release that only shows up after publishing.
 * Both are checked here instead.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const EXPECTED_OUTPUTS = [
  'dist/index.js',
  'dist/index.cjs',
  'dist/index.d.ts',
  'dist/wardogs-rcon-api.umd.js',
];

function run(label, args) {
  process.stdout.write(`\n▸ ${label}\n`);
  execFileSync('npx', args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Assert that `src/version.ts` matches `package.json`.
 *
 * The version is a source constant rather than a JSON import so the UMD bundle
 * does not carry the whole manifest. That trade means the two can drift, and a
 * package reporting the wrong version is worse than useless in a bug report.
 */
function assertVersionInSync() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const source = readFileSync(join(root, 'src/version.ts'), 'utf8');

  const match = /export const VERSION = '([^']+)'/.exec(source);
  if (match === null) {
    throw new Error('Could not find `export const VERSION` in src/version.ts');
  }

  if (match[1] !== pkg.version) {
    throw new Error(
      `Version mismatch: package.json says ${pkg.version}, src/version.ts says ${match[1]}.\n` +
        'Update src/version.ts to match before publishing.',
    );
  }

  process.stdout.write(`\n▸ version: ${pkg.version} (package.json and src/version.ts agree)\n`);
}

/** Assert every expected artifact exists; report sizes. */
function reportOutputs() {
  const missing = EXPECTED_OUTPUTS.filter((file) => !existsSync(join(root, file)));

  if (missing.length > 0) {
    throw new Error(`Build did not produce:\n${missing.map((f) => `  - ${f}`).join('\n')}`);
  }

  process.stdout.write('\n▸ artifacts\n');
  let gzipTotal = 0;

  for (const file of EXPECTED_OUTPUTS) {
    const path = join(root, file);
    const raw = statSync(path).size;
    const gzipped = gzipSync(readFileSync(path)).length;
    gzipTotal += gzipped;

    process.stdout.write(
      `  ${relative(root, path).replace(/\\/g, '/').padEnd(38)} ` +
        `${formatBytes(raw).padStart(9)}  →  ${formatBytes(gzipped).padStart(8)} gzip\n`,
    );
  }

  process.stdout.write(
    `  ${'total'.padEnd(38)} ${''.padStart(9)}     ${formatBytes(gzipTotal).padStart(8)} gzip\n`,
  );
}

function main() {
  assertVersionInSync();

  run('esm + cjs + types', ['vite', 'build']);
  run('umd', ['vite', 'build', '--config', 'vite.umd.config.ts']);

  reportOutputs();
  process.stdout.write('\n▸ build ok\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`\n✗ build failed: ${error.message}\n`);
  process.exit(1);
}
