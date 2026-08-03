import { describe, expect, it } from 'vitest';
import { evaluateLintBudget } from '../scripts/lintBudget.mjs';

/**
 * Decision D6 — the lint budget must ratchet in **both** directions.
 *
 * `--max-warnings 110` failed only when the count rose. Because the cap sat
 * exactly on the current count, fixing a warning quietly created a free slot,
 * and the next warning to appear consumed it with CI still green — so the
 * budget could never actually shrink. The rule is tested here rather than
 * through a real lint run, which costs ~20 seconds.
 */

describe('lint budget ratchet (decision D6)', () => {
  it('passes when the count sits exactly on the budget', () => {
    expect(evaluateLintBudget({ errors: 0, warnings: 110, budget: 110 }).ok).toBe(true);
  });

  it('fails when a new warning appears', () => {
    const verdict = evaluateLintBudget({ errors: 0, warnings: 111, budget: 110 });

    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('1 new one(s)');
  });

  it('fails when warnings were fixed but the budget was not lowered', () => {
    // The regression this whole script exists for: green CI here means the
    // repository keeps paying for warnings it no longer has.
    const verdict = evaluateLintBudget({ errors: 0, warnings: 104, budget: 110 });

    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('Lower BUDGET to 104');
    expect(verdict.message).toContain('Nothing is broken');
  });

  it('fails on an error even when the warning count is exactly on budget', () => {
    const verdict = evaluateLintBudget({ errors: 1, warnings: 110, budget: 110 });

    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('never budgeted');
  });
});
