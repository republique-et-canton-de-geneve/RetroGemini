import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * `playwright.dual-url-flows.config.ts` runs the full-flow specs twice, at the
 * native URL and behind the reverse proxy's prefix (its `native` and `proxy`
 * projects), and CI runs it (`npm run test:e2e:dual-url-flows`). It names those
 * specs in its `testMatch`, a list of file names, and Playwright reports
 * nothing for a name that matches no file: it fails only a run that finds no
 * test at all. A spec renamed without its entry would leave the dual-URL run,
 * silently, while the other spec still runs. The motion project's lists have
 * the same guard, `playwrightMotionProject.test.ts`.
 *
 * Read with the TypeScript parser, not imported: the configuration imports
 * `@playwright/test`, which has no business in a unit run.
 */

const repoRoot = join(__dirname, '..');
const CONFIG = 'playwright.dual-url-flows.config.ts';

const config = ts.createSourceFile(CONFIG, readFileSync(join(repoRoot, CONFIG), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const nameOf = (property: ts.ObjectLiteralElementLike) =>
  ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) ? property.name.text : undefined;

/** The object of `export default defineConfig({ … })`, written out. */
const configObject = (() => {
  const exported = config.statements.find(ts.isExportAssignment)?.expression;
  const object = exported && ts.isCallExpression(exported) && exported.expression.getText() === 'defineConfig'
    ? exported.arguments[0]
    : undefined;
  if (!object || !ts.isObjectLiteralExpression(object)) throw new Error(`${CONFIG} exports no defineConfig({ … }) written out`);
  return object;
})();

/**
 * The value the configuration gives `name` itself. It spreads
 * `playwright.dual-url.config.ts` first, whose `testDir` and `testMatch` are
 * another suite's: a spread written after the property would replace it, and
 * this test would read a value Playwright never sees, so that is refused.
 */
const ownValue = (name: string): ts.Expression => {
  const index = configObject.properties.findIndex((property) => nameOf(property) === name);
  if (index < 0) throw new Error(`${CONFIG} sets no ${name} of its own`);
  if (configObject.properties.slice(index + 1).some(ts.isSpreadAssignment)) {
    throw new Error(`${CONFIG} spreads a configuration after its ${name}, which may replace it`);
  }
  return (configObject.properties[index] as ts.PropertyAssignment).initializer;
};

/** A string written out; anything else cannot be read here and is refused. */
const textOf = (where: string, node: ts.Expression): string => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  throw new Error(`${where} holds a value this test cannot read: ${node.getText()}`);
};

const testDir = textOf(`${CONFIG} → testDir`, ownValue('testDir'));

const testMatch = ownValue('testMatch');
if (!ts.isArrayLiteralExpression(testMatch)) throw new Error(`${CONFIG} → testMatch is not a list written out`);
const specs = testMatch.elements.map((element) => textOf(`${CONFIG} → testMatch`, element));

// Every project runs that list: one that set its own would run specs this test never read.
const projects = ownValue('projects');
if (!ts.isArrayLiteralExpression(projects)) throw new Error(`${CONFIG} → projects is not a list written out`);
for (const project of projects.elements) {
  if (!ts.isObjectLiteralExpression(project)) throw new Error(`${CONFIG} → projects holds an entry this test cannot read: ${project.getText()}`);
  const own = project.properties.map(nameOf).find((name) => name === 'testDir' || name === 'testMatch' || name === 'testIgnore');
  if (own) throw new Error(`${CONFIG} → a project sets its own ${own}: this test reads only the configuration's`);
}

describe('the dual-URL run of the full flows', () => {
  it('lists specs, for every project', () => {
    expect(projects.elements.length).toBeGreaterThan(0);
    expect(specs.length).toBeGreaterThan(0);
  });

  it.each(specs)('runs %s, a spec of its testDir', (name) => {
    const spec = join(testDir, name);
    expect(
      existsSync(join(repoRoot, spec)),
      `${spec} does not exist: the dual-URL run (native, and behind the proxy) skips it without a word`,
    ).toBe(true);
  });
});
