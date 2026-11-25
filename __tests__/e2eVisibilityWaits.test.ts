import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

/**
 * `locator.isVisible()` answers at once: Playwright ignores the `timeout` it
 * still accepts, so `isVisible({ timeout })` reads a control drawn a moment
 * later as absent, and the spec takes the wrong way through the form (the
 * join form draws its member list, with "I'm not in the list", or its name
 * field, once the team is read). A spec waits for one of the controls it
 * chooses between, `expect(a.or(b).first()).toBeVisible()`, and asks after.
 *
 * The specs that asked so before 45.3 are counted below, file by file, and a
 * count only goes down: a spec fixed leaves the table in the same change, and
 * no spec joins it (`e2e/i18n.spec.ts` and `e2e/avatars.spec.ts` left it in
 * 45.3). Read with the TypeScript parser, comments left out.
 */

const ROOT = join(__dirname, '..');

const STILL_ASKING: Record<string, number> = {
  'e2e/healthcheck-full-flow.spec.ts': 1,
  'e2e/healthcheck-timer.spec.ts': 1,
  'e2e/jira.spec.ts': 1,
  'e2e/retro-discuss-my-votes.spec.ts': 1,
  'e2e/retro-full-flow.spec.ts': 1,
  'e2e/retro-open-board.spec.ts': 1,
  'e2e/retro-participants-origin.spec.ts': 1,
  'e2e/retro-session-integrity.spec.ts': 1,
  'e2e/session-motion.spec.ts': 1,
  'e2e/session-revocation.spec.ts': 2,
};

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.ts$/.test(name)) out.push(path);
  }
  return out;
};

/** The `isVisible({ … timeout … })` calls of one file, as `file:line`. */
const askedWithTimeout = (text: string, file: string): string[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'isVisible'
      && node.arguments.some((argument) =>
        ts.isObjectLiteralExpression(argument)
        && argument.properties.some((property) => property.name !== undefined && ts.isIdentifier(property.name) && property.name.text === 'timeout'))
    ) {
      found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

describe('an e2e spec waits before it asks whether a control is visible', () => {
  it('finds the call it refuses, and not one in a comment', () => {
    expect(askedWithTimeout('await locator.isVisible({ timeout: 2_000 }).catch(() => false);', 'probe.ts')).toEqual(['probe.ts:1']);
    expect(askedWithTimeout('// asked `locator.isVisible({ timeout })`\nawait locator.isVisible();', 'probe.ts')).toEqual([]);
  });

  it('asks isVisible({ timeout }) nowhere but in the specs that predate the rule, no more often than they did', () => {
    const counts: Record<string, number> = {};
    for (const path of walk(join(ROOT, 'e2e'))) {
      const file = relative(ROOT, path);
      const calls = askedWithTimeout(readFileSync(path, 'utf8'), file);
      if (calls.length) counts[file] = calls.length;
    }
    expect(counts).toEqual(STILL_ASKING);
  });
});
