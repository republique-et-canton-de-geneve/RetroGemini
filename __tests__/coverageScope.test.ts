import { describe, expect, it } from 'vitest';
import { summarizeCoverage, percent, GATED, FLOOR } from '../scripts/coverage-scope.mjs';

/**
 * The coverage percentage this repo reports has been misleading before: the gate
 * once covered `services/**` alone — two files, ~2.6% of the repo — while
 * printing a number in the eighties, and a reader had no way to tell from the
 * number itself. `scripts/coverage-scope.mjs` exists so there is a second figure
 * that means *the whole production codebase*, next to the gated one, with the
 * share each represents spelled out.
 *
 * These cases pin the arithmetic and the classification rather than any
 * particular percentage — the real numbers move with every change, but "gated
 * means exactly the four directories `vitest.config.ts` includes" and "the whole
 * figure counts every production file" must not drift.
 */

type FileCoverage = { statementMap: Record<string, unknown>; s: Record<string, number> };

/** Builds a coverage-final.json entry with `covered` of `total` statements hit. */
const file = (total: number, covered: number): FileCoverage => ({
  statementMap: Object.fromEntries(Array.from({ length: total }, (_, i) => [i, {}])),
  s: Object.fromEntries(Array.from({ length: total }, (_, i) => [i, i < covered ? 1 : 0]))
});

const CWD = '/repo';

describe('coverage scope reporting', () => {
  it('separates the gated scope from the whole codebase', () => {
    const summary = summarizeCoverage({
      [`${CWD}/server/routes/teamRoutes.js`]: file(100, 90),
      [`${CWD}/services/dataService.ts`]: file(100, 70),
      [`${CWD}/components/Session.tsx`]: file(200, 40)
    }, CWD);

    // Gated: 160/200. Whole: 200/400. The gap between the two numbers is the
    // entire point of the script.
    expect(summary.gatedCovered).toBe(160);
    expect(summary.gatedTotal).toBe(200);
    expect(summary.gated).toBeCloseTo(80, 5);
    expect(summary.whole).toBeCloseTo(50, 5);
    expect(summary.gatedShare).toBeCloseTo(50, 5);
  });

  it('counts every production area, including the ones outside the gate', () => {
    const summary = summarizeCoverage({
      [`${CWD}/components/Session.tsx`]: file(10, 1),
      [`${CWD}/components/Dashboard.tsx`]: file(10, 9),
      [`${CWD}/server/services/dataStore.js`]: file(10, 8),
      [`${CWD}/server/routes/aiRoutes.js`]: file(10, 8),
      [`${CWD}/utils/inviteLink.js`]: file(10, 10),
      [`${CWD}/App.tsx`]: file(10, 3)
    }, CWD);

    expect([...summary.groups.keys()].sort()).toEqual([
      '(root)', 'components', 'server/routes', 'server/services', 'utils'
    ]);
    expect(summary.groups.get('components')).toEqual({ files: 2, covered: 10, total: 20 });
    // `server/` is split one level deeper, because "services" and "routes" are
    // separately meaningful and the gate lists them separately.
    expect(summary.groups.get('server/services')?.total).toBe(10);
    expect(summary.groups.get('server/routes')?.total).toBe(10);
    // A root-level file (App.tsx) is neither dropped nor merged into a directory.
    expect(summary.groups.get('(root)')).toEqual({ files: 1, covered: 3, total: 10 });
    expect(summary.wholeTotal).toBe(60);
  });

  it('classifies exactly the four gated directories as gated', () => {
    const isGated = (path: string) => GATED.some((pattern: RegExp) => pattern.test(path));

    expect(isGated('services/dataService.ts')).toBe(true);
    expect(isGated('server/services/dataStore.js')).toBe(true);
    expect(isGated('server/routes/teamRoutes.js')).toBe(true);
    expect(isGated('utils/inviteLink.js')).toBe(true);

    expect(isGated('components/Session.tsx')).toBe(false);
    expect(isGated('App.tsx')).toBe(false);
    expect(isGated('server.js')).toBe(false);
    // Anchored at the start, so a nested lookalike is not silently counted as
    // gated code — that is how a scope quietly grows without anyone deciding to.
    expect(isGated('components/services/helper.ts')).toBe(false);
  });

  it('ignores files that carry no statements instead of scoring them 0%', () => {
    const summary = summarizeCoverage({
      [`${CWD}/utils/empty.ts`]: file(0, 0),
      [`${CWD}/utils/real.ts`]: file(10, 10)
    }, CWD);

    expect(summary.groups.get('utils')).toEqual({ files: 1, covered: 10, total: 10 });
    expect(summary.whole).toBeCloseTo(100, 5);
  });

  it('never divides by zero on an empty report', () => {
    const summary = summarizeCoverage({}, CWD);

    expect(summary.whole).toBe(0);
    expect(summary.gated).toBe(0);
    expect(percent(0, 0)).toBe(0);
  });

  it('keeps the floor below the measured figure but not vacuously low', () => {
    // A floor above the real number would fail every build; a floor near zero
    // would never catch a regression. It is a ratchet: raise it as coverage
    // lands, never lower it to make a change pass.
    expect(FLOOR).toBeGreaterThan(50);
    expect(FLOOR).toBeLessThan(62);
  });
});
