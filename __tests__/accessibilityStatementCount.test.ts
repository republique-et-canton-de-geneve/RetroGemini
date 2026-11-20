import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * ACCESSIBILITY.md says how many audited states the axe gate holds at zero
 * (its "N in all"), and `BASELINE` in `e2e/helpers/axe.ts` is the list of those
 * states: each `audit()` call names one, and a state with no entry fails its
 * spec. Three states joined the table in 45.3 while the statement kept saying
 * 38, so the public claim undercounted what is tested. This suite counts the
 * table's keys and requires the statement to give that number.
 *
 * The helper is read as source text with the TypeScript parser, never
 * imported: it loads Playwright and axe-core, which a unit run must not, and a
 * regular expression over an object literal miscounts as soon as a comment or
 * a quoted key holds the pattern it looks for.
 */

const REPO_ROOT = join(__dirname, '..');
const HELPER = 'e2e/helpers/axe.ts';
const STATEMENT = 'ACCESSIBILITY.md';

const read = (file: string) => readFileSync(join(REPO_ROOT, file), 'utf8');

/** The object literal `BASELINE` is declared with, wherever it is in the file. */
const findBaseline = (node: ts.Node): ts.ObjectLiteralExpression | undefined => {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'BASELINE' &&
    node.initializer &&
    ts.isObjectLiteralExpression(node.initializer)
  ) {
    return node.initializer;
  }
  return ts.forEachChild(node, findBaseline);
};

/** The states `BASELINE` holds, in the order the helper writes them. */
const baselineStates = (): string[] => {
  const source = ts.createSourceFile(HELPER, read(HELPER), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const table = findBaseline(source);
  if (!table) throw new Error(`no object literal named BASELINE in ${HELPER}`);
  return table.properties.map((property) => {
    // A spread or a computed key would hide states from a count of the source.
    if (!ts.isPropertyAssignment(property)) {
      throw new Error(`BASELINE holds something other than a state and its cap: ${property.getText(source)}`);
    }
    if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) return property.name.text;
    throw new Error(`BASELINE has a key that is neither a name nor a string: ${property.name.getText(source)}`);
  });
};

/** Every total the statement writes as "N in all", a line break allowed inside. */
const statedTotals = (): number[] =>
  [...read(STATEMENT).matchAll(/\b(\d+)\s+in\s+all\b/g)].map((match) => Number(match[1]));

describe('the accessibility statement counts the audited states', () => {
  it('reads every state of BASELINE from the helper', () => {
    const states = baselineStates();
    // The first state of the table, and the last three to join it (45.3): a
    // parse that found another object, or half of this one, misses one.
    expect(states).toEqual(expect.arrayContaining(['login', 'login-team-grid', 'avatar-hint', 'avatar-hint-dashboard']));
    expect(new Set(states).size, 'a state named twice').toBe(states.length);
  });

  it('states as many audited states as BASELINE holds', () => {
    const totals = statedTotals();
    expect(totals, `${STATEMENT} gives its total once, as "N in all"`).toHaveLength(1);
    expect(totals[0], `${STATEMENT} gives ${totals[0]} audited states, ${HELPER} holds ${baselineStates().length}`).toBe(
      baselineStates().length
    );
  });
});
