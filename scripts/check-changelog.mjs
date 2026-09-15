/**
 * Changelog checks.
 *
 * A changelog that lags the version is worse than no changelog: it tells a user
 * the release notes are complete when they are not. npm will publish the
 * mismatch without complaint, so it is checked here instead — both at release
 * time and in CI.
 *
 * The English and Chinese editions are checked for structural parity, because
 * a translation that silently falls behind is the same failure in a different
 * place.
 */

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

/** Version headings, e.g. `## [0.1.0] — 2026-09-14`. */
function releasedVersions(text) {
  return [...text.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((match) => match[1]);
}

/** Whether a version heading carries a date, which a release entry must. */
function hasDate(text, version) {
  return new RegExp(
    `^## \\[${version.replace(/\./g, '\\.')}\\]\\s*—\\s*\\d{4}-\\d{2}-\\d{2}`,
    'm',
  ).test(text);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const english = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const chinesePath = join(root, 'CHANGELOG.zh-CN.md');
const chinese = existsSync(chinesePath) ? readFileSync(chinesePath, 'utf8') : null;

process.stdout.write('\n▸ changelog\n');

check('CHANGELOG.md exists', existsSync(join(root, 'CHANGELOG.md')));
check('CHANGELOG.md is not Keep a Changelog boilerplate', !/^## \[0\.0\.0\]/m.test(english));

const englishVersions = releasedVersions(english);
check(
  'documents the current version',
  englishVersions.includes(pkg.version),
  englishVersions.length > 0 ? `entries: ${englishVersions.join(', ')}` : 'no released entries',
);
check(
  'newest entry is the current version',
  englishVersions[0] === pkg.version,
  `newest is ${englishVersions[0] ?? '(none)'}`,
);
check(
  'newest entry carries a release date',
  hasDate(english, pkg.version),
  'expected "## [x.y.z] — YYYY-MM-DD"',
);
check('has an [Unreleased] section', /^## \[Unreleased\]/m.test(english));
check('no placeholder owner in links', !/github\.com\/OWNER\//.test(english));

if (chinese === null) {
  check('CHANGELOG.zh-CN.md exists', false, 'the Chinese edition is missing');
} else {
  const chineseVersions = releasedVersions(chinese);
  check('Chinese edition exists', true);
  check(
    'Chinese edition covers the same versions',
    // Same set, not the same order — a translator reordering would not be a bug,
    // but a missing version means the release notes are incomplete in one
    // language.
    JSON.stringify([...chineseVersions].sort()) === JSON.stringify([...englishVersions].sort()),
    `zh: ${chineseVersions.join(', ') || '(none)'} vs en: ${englishVersions.join(', ') || '(none)'}`,
  );
  check('Chinese edition has an [Unreleased] section', /^## \[未发布\]/m.test(chinese));
  check(
    'Chinese edition entry count matches per version',
    chineseVersions.length === englishVersions.length,
  );
}

process.stdout.write(
  failures.length === 0
    ? '\n▸ changelog ok\n'
    : `\n✗ ${failures.length} changelog check(s) failed:\n${failures.map((f) => `    ${f}`).join('\n')}\n`,
);

process.exit(failures.length === 0 ? 0 : 1);
