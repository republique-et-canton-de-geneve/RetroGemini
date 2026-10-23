// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';

/**
 * Decision D3b — what a session screen does when the team's password is
 * changed under it is written once, in `components/session/useSessionRevoked.ts`
 * and `SessionConnectionStatus.tsx`, for the retrospective and the health
 * check alike (AGENTS.md → *Retrospectives and health checks — one behaviour
 * for what they share*). This fails the day one of them grows a private copy:
 * a direct subscription to the revocation, which is how the next change would
 * reach one session type and miss the other.
 *
 * Read with the TypeScript parser, never a regular expression.
 */

const ROOT = join(__dirname, '..');
const SCREENS = ['components/Session.tsx', 'components/HealthCheckSession.tsx'];

// Every named import of `file`, by module specifier.
const importsOf = (file: string): Map<string, string[]> => {
  const source = ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Map<string, string[]>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    const names = bindings && ts.isNamedImports(bindings) ? bindings.elements.map((element) => (element.propertyName ?? element.name).text) : [];
    found.set(statement.moduleSpecifier.text, [...(found.get(statement.moduleSpecifier.text) ?? []), ...names]);
  }
  return found;
};

describe('both session screens share one reaction to a revoked session (decision D3b)', () => {
  it.each(SCREENS)('%s uses the shared hook and the shared copy', (file) => {
    const imports = importsOf(file);
    expect(imports.get('./session/useSessionRevoked')).toEqual(expect.arrayContaining(['useSessionRevoked', 'isSessionLive']));
    expect(imports.get('./session/SessionConnectionStatus')).toEqual(expect.arrayContaining(['JOIN_DENIED_REVOKED']));
  });

  it.each(SCREENS)('%s does not subscribe to the revocation itself', (file) => {
    const revocation = importsOf(file).get('../services/sessionRevocation') ?? [];
    expect(revocation).not.toContain('onSessionRevokedChange');
    expect(revocation).not.toContain('isSessionRevoked');
  });
});
