#!/usr/bin/env node
/**
 * Reports coverage over the **whole** production codebase, not just the gated
 * scope, and fails if it drops below a floor.
 *
 * Why this exists. `npm run test:coverage` gates
 * `services/**`, `server/services/**`, `server/routes/**` and `utils/**`
 * (see `vitest.config.ts`). That is the code the unit suite is responsible
 * for — React components are owned by the Playwright suite (decision D5) — but
 * it is under half of the production statements, so the percentage it prints
 * describes a *subset*. Read as a repo-wide figure it is far too flattering,
 * and it has been misread that way before: the gate once covered `services/**`
 * alone, i.e. two files and ~2.6% of the repo, while still reporting a number
 * in the eighties.
 *
 * So there are deliberately two numbers, and each says what it measures:
 *   - the **gate** (`npm run test:coverage`) — strict thresholds on the layer
 *     unit tests own, ratcheted up as coverage lands;
 *   - the **whole codebase** (this script) — the honest headline, with a floor
 *     low enough that the e2e-owned component layer does not fail the build,
 *     but high enough that a real regression does.
 *
 * `FLOOR` follows the same rule as every other ratchet here: raise it when
 * coverage lands, never lower it to make a change pass.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Statement-coverage floor for the whole production codebase, in percent. */
export const FLOOR = 57;

/** The gate's own include patterns (`vitest.config.ts`), so the two numbers can
 * be shown side by side and the difference between them is explicit rather than
 * folklore. */
export const GATED = [/^services\//, /^server\/services\//, /^server\/routes\//, /^utils\//];

export const percent = (covered, total) => (total === 0 ? 0 : (covered / total) * 100);

/**
 * Reduces an Istanbul/v8 `coverage-final.json` to per-area statement totals plus
 * the gated and whole-codebase rollups. Pure, so the reporting rules are tested
 * directly instead of through a nested vitest run.
 */
export const summarizeCoverage = (report, cwd) => {
  const groups = new Map();
  let gatedTotal = 0, gatedCovered = 0, wholeTotal = 0, wholeCovered = 0;

  for (const [absolutePath, fileCoverage] of Object.entries(report)) {
    const relative = absolutePath.startsWith(`${cwd}/`)
      ? absolutePath.slice(cwd.length + 1)
      : absolutePath;
    const total = Object.keys(fileCoverage.statementMap).length;
    if (total === 0) continue;
    const covered = Object.values(fileCoverage.s).filter((hits) => hits > 0).length;

    const segments = relative.split('/');
    const group = segments.length === 1
      ? '(root)'
      : segments.slice(0, relative.startsWith('server/') ? 2 : 1).join('/');
    const bucket = groups.get(group) || { total: 0, covered: 0, files: 0 };
    bucket.total += total;
    bucket.covered += covered;
    bucket.files += 1;
    groups.set(group, bucket);

    wholeTotal += total;
    wholeCovered += covered;
    if (GATED.some((pattern) => pattern.test(relative))) {
      gatedTotal += total;
      gatedCovered += covered;
    }
  }

  return {
    groups,
    gatedTotal,
    gatedCovered,
    wholeTotal,
    wholeCovered,
    gated: percent(gatedCovered, gatedTotal),
    whole: percent(wholeCovered, wholeTotal),
    gatedShare: percent(gatedTotal, wholeTotal)
  };
};

/**
 * Everything that ships as production code. Kept as one list rather than
 * reusing `vitest.config.ts`'s `include`, because the entire point is to
 * measure a *different*, wider scope than the gate does.
 */
const EXCLUDE = [
  'node_modules/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '**/__tests__/**',
  'e2e/**',
  'loadtest/**',
  'scripts/**',
  '**/*.config.{js,ts}',
  '**/*.d.ts',
  'vitest.setup.ts',
  // Type declarations and the DOM entrypoint carry no logic to cover.
  'types.ts',
  'index.tsx'
];

const runMeasurement = () => {
  const args = [
    'vitest', 'run', '--coverage',
    '--coverage.include=**/*.{ts,tsx,js}',
    ...EXCLUDE.map((pattern) => `--coverage.exclude=${pattern}`),
    // The gate's thresholds belong to the gate. This run measures, then applies
    // its own floor below, so a scope difference cannot fail the wrong check.
    '--coverage.thresholds.lines=0',
    '--coverage.thresholds.functions=0',
    '--coverage.thresholds.branches=0',
    '--coverage.thresholds.statements=0',
    '--coverage.reporter=json',
    '--coverage.reportsDirectory=coverage/full'
  ];

  const run = spawnSync('npx', args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });

  if (run.status !== 0) {
    process.stdout.write(run.stdout || '');
    console.error('\n✖ Test run failed; coverage scope not measured.');
    process.exit(run.status ?? 1);
  }

  const reportPath = resolve('coverage/full/coverage-final.json');
  if (!existsSync(reportPath)) {
    console.error(`✖ Expected a coverage report at ${reportPath}, found none.`);
    process.exit(1);
  }

  const summary = summarizeCoverage(JSON.parse(readFileSync(reportPath, 'utf8')), process.cwd());

  console.log('\nStatement coverage by area (whole production codebase)\n');
  console.log(`${'area'.padEnd(20)}${'files'.padStart(6)}${'stmts'.padStart(8)}${'covered'.padStart(9)}  gated`);
  for (const [group, bucket] of [...summary.groups].sort((a, b) => b[1].total - a[1].total)) {
    const isGated = GATED.some((pattern) => pattern.test(`${group}/`));
    console.log(
      group.padEnd(20) +
      String(bucket.files).padStart(6) +
      String(bucket.total).padStart(8) +
      `${percent(bucket.covered, bucket.total).toFixed(1)}%`.padStart(9) +
      (isGated ? '   yes' : '   no')
    );
  }

  console.log('');
  console.log(`gate scope    : ${summary.gated.toFixed(2)}%  (${summary.gatedCovered}/${summary.gatedTotal} statements — ${summary.gatedShare.toFixed(1)}% of production code)`);
  console.log(`whole codebase: ${summary.whole.toFixed(2)}%  (${summary.wholeCovered}/${summary.wholeTotal} statements)`);
  console.log('');

  if (summary.whole < FLOOR) {
    console.error(
      `✖ Whole-codebase statement coverage ${summary.whole.toFixed(2)}% is below the floor of ${FLOOR}%.\n` +
      '  Add tests rather than lowering the floor.'
    );
    process.exit(1);
  }

  console.log(`✔ Whole-codebase statement coverage ${summary.whole.toFixed(2)}% ≥ floor ${FLOOR}%.`);
};

// Importing this file for its exports (the tests do) must not run a test suite.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMeasurement();
}
