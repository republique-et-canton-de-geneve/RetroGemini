import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Two directories of a checkout hold local tooling, never this repository's
 * source: `.claude/worktrees/`, an agent's isolated checkout (a second copy of
 * every file here), and `.gstack/`, gstack's working directory (the probes and
 * reports `/qa` and `/review` write). Neither is versioned, and every tool that
 * walks the checkout must leave both out:
 *
 *  - ESLint (`eslint.config.js` → `ignores`): linted, a worktree doubles every
 *    warning of the budget, and a probe script fails the build of whoever ran
 *    one of those commands last;
 *  - vitest (`vitest.config.ts` → `test.exclude`): it globs with `dot: true`,
 *    so a `*.spec.ts` probe under `.gstack/` was collected and failed
 *    `npm run test` on Playwright's `test()`, and a worktree ran every test
 *    twice;
 *  - the whole-codebase coverage sweep (`scripts/coverage-scope.mjs` →
 *    `EXCLUDE`), which counts every file it finds and globs the same way.
 *
 * ESLint had both; vitest had only the worktrees, and the sweep neither.
 * These lists live in three files and nothing connected them, so they are
 * read here, with the TypeScript parser, and held together.
 */

const repoRoot = join(__dirname, '..');
const TOOLING_DIRECTORIES = ['.claude/worktrees', '.gstack'];

const sourceOf = (relativePath: string) =>
  ts.createSourceFile(
    relativePath,
    readFileSync(join(repoRoot, relativePath), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    /\.[cm]?js$/.test(relativePath) ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );

/** Every node of a file, depth first. */
const nodesOf = (file: ts.SourceFile): ts.Node[] => {
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return nodes;
};

const propertyName = (node: ts.ObjectLiteralElementLike) =>
  ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : undefined;

/**
 * The patterns of a list. An entry that is not a plain string (a variable, a
 * spread, a call) cannot be read here: refused, rather than passed unread.
 */
const patternsOf = (where: string, node: ts.Node | undefined): string[] => {
  if (!node || !ts.isArrayLiteralExpression(node)) throw new Error(`${where} is not an array written out`);
  return node.elements.map((element) => {
    if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) return element.text;
    throw new Error(`${where} holds an entry this guard cannot read: ${element.getText()}`);
  });
};

/** `eslint.config.js`: every `ignores` list of the configuration. */
const eslintIgnores = (): string[] => {
  const file = sourceOf('eslint.config.js');
  const lists = nodesOf(file)
    .filter(ts.isPropertyAssignment)
    .filter((node) => propertyName(node) === 'ignores');
  if (lists.length === 0) throw new Error('eslint.config.js has no ignores list');
  return lists.flatMap((node) => patternsOf('eslint.config.js → ignores', node.initializer));
};

/** `vitest.config.ts`: the `exclude` of `test`, not the one of `test.coverage`. */
const vitestExclude = (): string[] => {
  const file = sourceOf('vitest.config.ts');
  const test = nodesOf(file)
    .filter(ts.isPropertyAssignment)
    .find((node) => propertyName(node) === 'test' && ts.isObjectLiteralExpression(node.initializer));
  if (!test) throw new Error('vitest.config.ts has no test block');
  const exclude = (test.initializer as ts.ObjectLiteralExpression).properties.find((node) => propertyName(node) === 'exclude');
  return patternsOf('vitest.config.ts → test.exclude', exclude && ts.isPropertyAssignment(exclude) ? exclude.initializer : undefined);
};

/** `scripts/coverage-scope.mjs`: `EXCLUDE`, the patterns its sweep passes as `--coverage.exclude`. */
const coverageSweepExclude = (): string[] => {
  const file = sourceOf('scripts/coverage-scope.mjs');
  const declaration = nodesOf(file)
    .filter(ts.isVariableDeclaration)
    .find((node) => ts.isIdentifier(node.name) && node.name.text === 'EXCLUDE');
  return patternsOf('scripts/coverage-scope.mjs → EXCLUDE', declaration?.initializer);
};

describe('local tooling directories', () => {
  it.each([
    ['ESLint', 'eslint.config.js → ignores', eslintIgnores],
    ['vitest', 'vitest.config.ts → test.exclude', vitestExclude],
    ['the whole-codebase coverage sweep', 'scripts/coverage-scope.mjs → EXCLUDE', coverageSweepExclude],
  ])('are left out by %s', (_tool, where, read) => {
    const patterns = read();
    // The scan reads the code: a list it read as empty would make every
    // expectation below fail for the wrong reason.
    expect(patterns.length, `${where} read as empty`).toBeGreaterThan(0);
    for (const directory of TOOLING_DIRECTORIES) {
      expect(patterns, `${where} does not leave out ${directory}/`).toContain(`${directory}/**`);
    }
  });
});
