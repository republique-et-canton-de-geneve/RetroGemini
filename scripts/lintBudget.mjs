/**
 * Decision D6 — the lint budget rule, as a pure function so it can be tested
 * without running ESLint (a run costs ~20 s).
 *
 * The budget is a two-way ratchet: the count may not rise, and it may not
 * silently fall either. A budget that only fails upwards gains a free slot every
 * time someone fixes a warning, and the next warning to appear takes that slot
 * unnoticed — which is exactly how this repository arrived at a cap sitting
 * precisely on its own count with no headroom and no history.
 */

/**
 * @param {{ errors: number, warnings: number, budget: number }} counts
 * @returns {{ ok: boolean, message: string }}
 */
export const evaluateLintBudget = ({ errors, warnings, budget }) => {
  if (errors > 0) {
    return { ok: false, message: `✖ ${errors} lint error(s). Errors are never budgeted.` };
  }

  if (warnings > budget) {
    return {
      ok: false,
      message:
        `✖ ${warnings} warnings, budget is ${budget}. Fix the ${warnings - budget} new one(s), ` +
        'or raise BUDGET in scripts/lint.mjs and say why in the pull request.',
    };
  }

  if (warnings < budget) {
    return {
      ok: false,
      message:
        `✖ ${warnings} warnings, budget is ${budget}. Nothing is broken — you removed ` +
        `${budget - warnings} warning(s). Lower BUDGET to ${warnings} in scripts/lint.mjs so the ` +
        'gain cannot be spent by the next warning to appear.',
    };
  }

  return { ok: true, message: `✔ 0 errors, ${warnings} warnings (exactly the budget).` };
};
