import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';

/**
 * Decision D3b — the registrars default `sessionRevocation` to a no-op, so
 * their test harnesses need no change. That default is also what would let a
 * forgotten argument in `server.js` leave every suite green while production
 * revokes the HTTP tokens and leaves every live socket of the team in its
 * room. The same limit as the `securityEvents` and `liveSessionRename` source
 * checks: this proves the argument is written, not that it runs.
 *
 * Read with the TypeScript parser, never a regular expression (AGENTS.md).
 */

const ROOT = join(__dirname, '..');

// The property names of the first object-literal argument of every call to
// `name` in `file`.
const callArguments = (file: string, name: string): string[][] => {
  const source = ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found: string[][] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      const options = node.arguments[0];
      found.push(options && ts.isObjectLiteralExpression(options)
        ? options.properties.flatMap((property) =>
          (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && ts.isIdentifier(property.name)
            ? [property.name.text]
            : [])
        : []);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

const onlyCall = (file: string, name: string) => {
  const calls = callArguments(file, name);
  expect(calls, `${name} in ${file}`).toHaveLength(1);
  return calls[0];
};

describe('the session revocation wiring (decision D3b)', () => {
  it('builds the revocation service on the Socket.IO server and the runtime flags', () => {
    expect(onlyCall('server.js', 'createSessionRevocation')).toEqual(expect.arrayContaining(['io', 'serverRuntime']));
  });

  it.each(['registerTeamRoutes', 'registerPasswordResetRoutes', 'registerSuperAdminRoutes', 'registerSocketHandlers'])(
    'hands it to %s in server.js',
    (registrar) => {
      expect(onlyCall('server.js', registrar)).toContain('sessionRevocation');
    }
  );

  it('hands the team service to the AI routes, whose token check reads the epoch through it', () => {
    expect(onlyCall('server.js', 'registerAiRoutes')).toContain('teamService');
  });

  it('passes it on from the console routes to the single-team restore', () => {
    expect(onlyCall('server/routes/superAdminRoutes.js', 'registerSuperAdminTeamRestoreRoutes')).toContain('sessionRevocation');
  });

  it('sweeps the orphaned epoch rows at boot', () => {
    const source = readFileSync(join(ROOT, 'server.js'), 'utf8');
    expect(source).toContain('dataStore.sweepOrphanedTeamAuthRows()');
  });
});
