import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

/**
 * Decision D3b — every team session token the server mints must carry the
 * team's current session epoch. `createSessionToken` defaults the epoch to
 * `'0'` (the epoch of a team that never rotated), which fails closed for any
 * team that has — its token is refused — but a forgotten argument would still
 * hand a rotated team's facilitator a token that does not work. So every call
 * under `server/` and in `server.js` must pass an object literal naming
 * `sessionEpoch`.
 *
 * Read with the TypeScript parser, never a regular expression (see AGENTS.md,
 * audit H52): a call split over lines or nested in another call is still a
 * call.
 */

const ROOT = join(__dirname, '..');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(js|mjs|ts)$/.test(name) ? [path] : [];
  });

type MintCall = { file: string; line: number; ok: boolean };

const mintCalls = (file: string): MintCall[] => {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const calls: MintCall[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : null;
      if (name === 'createSessionToken') {
        const options = node.arguments[2];
        const ok = !!options && ts.isObjectLiteralExpression(options) && options.properties.some((property) =>
          (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
          ts.isIdentifier(property.name) && property.name.text === 'sessionEpoch'
        );
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        calls.push({ file: relative(ROOT, file), line: line + 1, ok });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
};

describe('every server-side mint of a team session token names its epoch (decision D3b)', () => {
  const calls = [...sourceFiles(join(ROOT, 'server')), join(ROOT, 'server.js')]
    .flatMap(mintCalls)
    // The definition itself is not a mint.
    .filter((call) => call.file !== join('server', 'services', 'sessionTokens.js'));

  it('finds the mints (login, creation and the password change)', () => {
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('passes { sessionEpoch } as the third argument of each', () => {
    expect(calls.filter((call) => !call.ok)).toEqual([]);
  });
});
