/**
 * Packaging checks that the build cannot make on its own.
 *
 * `npm run build` proves the artifacts exist and are the right size. It cannot
 * prove that `exports` points at them, that the conditions resolve the way a
 * consumer's resolver would, or that a stale `files` list would leave the
 * published tarball missing a file it references. Each of those publishes
 * cleanly and breaks for every user, so they are checked here.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}\n`);
  if (!ok) failures.push(label);
}

function checkFile(label, relativePath) {
  const absolute = join(root, relativePath);
  check(label, existsSync(absolute), relativePath);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

process.stdout.write('\n▸ artifact paths referenced by package.json\n');
checkFile('main', pkg.main);
checkFile('module', pkg.module);
checkFile('types', pkg.types);
checkFile('unpkg', pkg.unpkg);
checkFile('jsdelivr', pkg.jsdelivr);
for (const [key, value] of Object.entries(pkg.exports ?? {})) {
  if (typeof value === 'string') {
    checkFile(`exports["${key}"]`, value);
    continue;
  }
  for (const [condition, target] of Object.entries(value)) {
    checkFile(`exports["${key}"].${condition}`, target);
  }
}

process.stdout.write('\n▸ publish contents\n');
const files = pkg.files ?? [];
// Everything `exports` points at lives under dist; if dist is not published,
// the package installs and then fails to import.
check('files includes dist', files.includes('dist'), `files: [${files.join(', ')}]`);
check('files includes README.md', files.includes('README.md'));
check('files includes CHANGELOG.md', files.includes('CHANGELOG.md'));
check('files includes LICENSE', files.includes('LICENSE'));
// The spec snapshot feeds the conformance test and is not needed at runtime —
// it must not be published.
check('spec not published', !files.includes('spec'), 'the API snapshot is a build-time input');
check('tests not published', !files.includes('tests'));
// The web panel is a local development tool with its own package.json and its
// own dependencies. Publishing it would put a second, unversioned application
// inside the library tarball.
check('web not published', !files.includes('web'), 'the panel is a local tool');

process.stdout.write('\n▸ module format resolution\n');
check('type is "module"', pkg.type === 'module', `type: ${pkg.type}`);

// The ESM entry must be loadable as ESM and the CJS entry as CommonJS; the
// extensions and `type` field together decide that, and getting it wrong is an
// ERR_REQUIRE_ESM at the consumer's import.
const esm = execFileSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `const m = await import(${JSON.stringify(pkg.exports['.'].import)}); process.stdout.write(String(Object.keys(m).length));`,
  ],
  { cwd: root, encoding: 'utf8' },
).trim();
check('ESM entry imports', Number(esm) > 0, `${esm} exports`);

const cjs = execFileSync(
  process.execPath,
  [
    '-e',
    `const m = require(${JSON.stringify(pkg.exports['.'].require)}); process.stdout.write(String(Object.keys(m).length));`,
  ],
  { cwd: root, encoding: 'utf8' },
).trim();
check('CJS entry requires', Number(cjs) > 0, `${cjs} exports`);

// The two entries must expose the same surface. Drift here means one format
// silently lost an export — the kind of bug that only surfaces for whichever
// half of the ecosystem the author does not use.
check('ESM and CJS expose the same exports', esm === cjs, `${esm} vs ${cjs}`);

process.stdout.write('\n▸ UMD\n');
const umd = readFileSync(join(root, pkg.unpkg), 'utf8');
check('UMD declares the WardogsRCON global', /global\.WardogsRCON\s*=/.test(umd));
// All three branches must be present, or the file silently works in one
// environment and not another. Matches the standard wrapper idiom rather than
// one exact spelling.
check(
  'UMD has a CommonJS branch',
  /typeof exports\s*===/.test(umd) && /typeof module\s*!==/.test(umd),
);
check(
  'UMD has an AMD branch',
  /typeof define\s*===\s*["']function["']/.test(umd) && /define\.amd/.test(umd),
);
check(
  'UMD assigns to the global object',
  /globalThis/.test(umd) || /global\s*\|\|\s*self/.test(umd),
);

process.stdout.write('\n▸ version\n');
const versionSource = readFileSync(join(root, 'src/version.ts'), 'utf8');
const versionMatch = /export const VERSION = '([^']+)'/.exec(versionSource);
check(
  'src/version.ts matches package.json',
  versionMatch?.[1] === pkg.version,
  `${versionMatch?.[1]} vs ${pkg.version}`,
);

// The changelog's own consistency is checked by `npm run check:changelog`;
// this only asserts it ships, since a published package without release notes
// is a documentation bug the registry will not catch.
checkFile('CHANGELOG.md', 'CHANGELOG.md');

process.stdout.write('\n▸ consumer interfaces\n');
checkFile('README.md', 'README.md');
checkFile('README.zh-CN.md', 'README.zh-CN.md');
checkFile('docs/api.md', 'docs/api.md');
checkFile('docs/api.zh-CN.md', 'docs/api.zh-CN.md');
checkFile('docs/adapters.md', 'docs/adapters.md');
checkFile('docs/adapters.zh-CN.md', 'docs/adapters.zh-CN.md');
checkFile('docs/watch.md', 'docs/watch.md');
checkFile('docs/watch.zh-CN.md', 'docs/watch.zh-CN.md');

// docs/ ships so the README's relative links resolve on the npm page as well as
// on GitHub. Without it every "see docs/…" line is a 404 for anyone who did not
// clone the repo.
check('files includes docs', files.includes('docs'), 'README links would 404 on npm');

// A repository URL is optional, but a placeholder one is worse than none: it
// resolves to a stranger's account and npm renders it as a broken link on the
// package page.
if (pkg.repository !== undefined) {
  check(
    'repository URL is not a placeholder',
    !/OWNER|example\.com|your-/.test(pkg.repository.url ?? ''),
    pkg.repository.url,
  );
}

// Every published Markdown file must carry a language toggle when a translated
// edition exists, or a reader lands in one language with no way across.
const PAIRS = [
  ['README.md', 'README.zh-CN.md'],
  ['CHANGELOG.md', 'CHANGELOG.zh-CN.md'],
  ['docs/api.md', 'docs/api.zh-CN.md'],
  ['docs/adapters.md', 'docs/adapters.zh-CN.md'],
  ['docs/watch.md', 'docs/watch.zh-CN.md'],
];
for (const [english, chinese] of PAIRS) {
  const en = readFileSync(join(root, english), 'utf8');
  const zh = readFileSync(join(root, chinese), 'utf8');
  const zhName = chinese.split('/').pop();
  const enName = english.split('/').pop();
  check(
    `${english} links to its translation`,
    en.includes(`(${zhName})`),
    `expected a link to ${zhName}`,
  );
  check(
    `${chinese} links back to the original`,
    zh.includes(`(${enName})`),
    `expected a link to ${enName}`,
  );
}

process.stdout.write(
  failures.length === 0
    ? '\n▸ packaging ok\n'
    : `\n✗ ${failures.length} packaging check(s) failed:\n${failures.map((f) => `    ${f}`).join('\n')}\n`,
);

process.exit(failures.length === 0 ? 0 : 1);
