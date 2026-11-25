import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * `playwright.config.ts` runs a second project, `motion`, with animations on,
 * over the specs listed in `MOTION_SPECS` (its `testMatch`), and keeps the
 * specs of `MOTION_ONLY_SPECS` out of the default project (its `testIgnore`).
 * Both are lists of file names, and Playwright reports nothing for a name that
 * matches no file: it fails only a run that finds no test at all. A spec
 * renamed without its entry would leave the run with motion on, silently, and
 * a motion-only spec missing from `MOTION_SPECS` would run in no project.
 *
 * Read with the TypeScript parser, not imported: the configuration imports
 * `@playwright/test`, which has no business in a unit run.
 */

const repoRoot = join(__dirname, '..');
const CONFIG = 'playwright.config.ts';

const config = ts.createSourceFile(CONFIG, readFileSync(join(repoRoot, CONFIG), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const nodes: ts.Node[] = [];
const visit = (node: ts.Node) => {
  nodes.push(node);
  ts.forEachChild(node, visit);
};
visit(config);

/** A list written out as string literals; anything else cannot be read here and is refused. */
const listNamed = (name: string): string[] => {
  const declaration = nodes
    .filter(ts.isVariableDeclaration)
    .find((node) => ts.isIdentifier(node.name) && node.name.text === name);
  const list = declaration?.initializer;
  if (!list || !ts.isArrayLiteralExpression(list)) throw new Error(`${CONFIG} has no list ${name} written out`);
  return list.elements.map((element) => {
    if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) return element.text;
    throw new Error(`${CONFIG} → ${name} holds an entry this test cannot read: ${element.getText()}`);
  });
};

const propertyNamed = (object: ts.ObjectLiteralExpression, name: string) =>
  object.properties.find((property): property is ts.PropertyAssignment =>
    ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name);

/** The project whose `name` is `name`: the object literal of its entry in `projects`. */
const projectNamed = (name: string): ts.ObjectLiteralExpression => {
  const project = nodes.filter(ts.isObjectLiteralExpression).find((object) => {
    const value = propertyNamed(object, 'name')?.initializer;
    return !!value && ts.isStringLiteral(value) && value.text === name;
  });
  if (!project) throw new Error(`${CONFIG} has no project named ${name}`);
  return project;
};

const motionSpecs = listNamed('MOTION_SPECS');
const motionOnlySpecs = listNamed('MOTION_ONLY_SPECS');

describe('the motion project of the end-to-end suite', () => {
  it('lists specs', () => {
    expect(motionSpecs.length).toBeGreaterThan(0);
    expect(motionOnlySpecs.length).toBeGreaterThan(0);
  });

  it.each(motionSpecs)('runs %s, a spec of e2e/', (name) => {
    expect(existsSync(join(repoRoot, 'e2e', name)), `e2e/${name} does not exist: the motion project runs nothing for it`).toBe(true);
  });

  it.each(motionOnlySpecs)('runs %s, which only the motion project runs', (name) => {
    expect(existsSync(join(repoRoot, 'e2e', name)), `e2e/${name} does not exist`).toBe(true);
    expect(motionSpecs, `${name} is kept out of the default project and missing from MOTION_SPECS: no project runs it`).toContain(name);
  });

  it('matches its project with those lists', () => {
    expect(propertyNamed(projectNamed('motion'), 'testMatch')?.initializer.getText()).toBe('MOTION_SPECS');
    expect(propertyNamed(projectNamed('chromium'), 'testIgnore')?.initializer.getText()).toBe('MOTION_ONLY_SPECS');
  });
});
