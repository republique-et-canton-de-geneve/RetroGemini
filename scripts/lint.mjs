#!/usr/bin/env node
/**
 * Decision D6 — a two-way lint ratchet.
 *
 * `eslint . --max-warnings 110` only ever caught the count going *up*. The cap
 * sat exactly on the current count, so there was no headroom for a new warning
 * (correct) and no signal at all when work removed one: the budget silently
 * gained a free slot, and the next warning to appear took it unnoticed. A budget
 * that only ratchets in the direction of decay is not a ratchet.
 *
 * ESLint runs **once** here — a second pass costs ~20 s, which is why this is a
 * wrapper around one run rather than an extra CI step. The rule itself lives in
 * `lintBudget.mjs` so it can be tested without paying for a lint run.
 */
import { ESLint } from 'eslint';
import { evaluateLintBudget } from './lintBudget.mjs';

/**
 * The number of warnings this repository currently tolerates. Lower it whenever
 * the count drops — never raise it without saying why in the pull request.
 *
 * Current composition (2026-08-03): 29 no-explicit-any, 23 no-unused-vars,
 * 18 no-non-null-assertion, 15 react-hooks/exhaustive-deps, 14 no-console,
 * 10 no-alert, 1 unattributed.
 */
const BUDGET = 110;

const eslint = new ESLint();
const results = await eslint.lintFiles(['.']);

const formatter = await eslint.loadFormatter('stylish');
const output = await formatter.format(results);
if (output.trim()) {
  console.log(output);
}

const { ok, message } = evaluateLintBudget({
  errors: results.reduce((total, result) => total + result.errorCount, 0),
  warnings: results.reduce((total, result) => total + result.warningCount, 0),
  budget: BUDGET,
});

if (!ok) {
  console.error(`\n${message}`);
  process.exit(1);
}

console.log(message);
