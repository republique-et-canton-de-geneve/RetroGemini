// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';

/**
 * The people a session screen lists are written once: `sessionParticipants`
 * in `components/session/sessionRoster.ts` (the session's participants, the
 * viewer added when the session does not list them yet, each id and each name
 * once). The board finds a card's author in that list, and so does the Discuss
 * topic the card becomes, so both paint the card alike (AGENTS.md → *A card's
 * colour*); the health check lists its people with it too (*one behaviour for
 * what they share*).
 *
 * The retrospective and the health check used to build the list inline, each
 * in its own `getParticipants`, while the Discuss topic read the shared
 * function: three copies of one rule. A test comparing the board's paint with
 * the topic's catches a change to the name rule, not one to the viewer or the
 * id rule made in one copy only. This fails the day a screen builds its list
 * again: a `getParticipants` that is anything but the shared call, or a person
 * keyed by a name of its own.
 *
 * Read with the TypeScript parser, never a regular expression.
 */

const ROOT = join(__dirname, '..');
const SCREENS = ['components/Session.tsx', 'components/HealthCheckSession.tsx'];
const DISCUSS = 'components/session/DiscussPhase.tsx';
const SHARED_CALL = 'sessionParticipants(session.participants, currentUser)';

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const walk = (node: ts.Node, visit: (node: ts.Node) => void): void => {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
};

const lineOf = (source: ts.SourceFile, node: ts.Node): number =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

// Every named import of a file, by module specifier.
const importsOf = (source: ts.SourceFile): Map<string, string[]> => {
  const found = new Map<string, string[]>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    const names = bindings && ts.isNamedImports(bindings) ? bindings.elements.map((element) => (element.propertyName ?? element.name).text) : [];
    found.set(statement.moduleSpecifier.text, [...(found.get(statement.moduleSpecifier.text) ?? []), ...names]);
  }
  return found;
};

// `session?.participants` reads as `session.participants`: what is read, not how.
const expressionText = (node: ts.Expression): string => {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${expressionText(node.expression)}.${node.name.text}`;
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return expressionText(node.expression);
  return `‹${ts.SyntaxKind[node.kind]}›`;
};

const callText = (call: ts.CallExpression): string =>
  `${expressionText(call.expression)}(${call.arguments.map(expressionText).join(', ')})`;

/** What a screen's `getParticipants` is: the call it returns, or a description of what it does instead. */
const getParticipantsOf = (source: ts.SourceFile): string => {
  const found: string[] = [];
  walk(source, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== 'getParticipants') return;
    const init = node.initializer;
    if (!init || !(ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
      found.push(`line ${lineOf(source, node)}: not a function`);
      return;
    }
    const body = init.body;
    if (ts.isCallExpression(body)) {
      found.push(callText(body));
    } else if (ts.isBlock(body) && body.statements.length === 1 && ts.isReturnStatement(body.statements[0])
      && body.statements[0].expression && ts.isCallExpression(body.statements[0].expression)) {
      found.push(callText(body.statements[0].expression));
    } else {
      found.push(`line ${lineOf(source, node)}: a function of ${ts.isBlock(body) ? body.statements.length : 1} statement(s) of its own`);
    }
  });
  return found.length === 1 ? found[0] : `${found.length} declarations of getParticipants`;
};

/** Every call to the shared function in a file. */
const sharedCallsIn = (source: ts.SourceFile): string[] => {
  const calls: string[] = [];
  walk(source, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'sessionParticipants') {
      calls.push(callText(node));
    }
  });
  return calls;
};

/**
 * Every `<person>.name.trim().toLowerCase()`: the key the list deduplicates
 * people on, which belongs to sessionRoster.ts. Only the copies wrote it on the
 * two screens.
 */
const nameKeysIn = (source: ts.SourceFile): string[] => {
  const keys: string[] = [];
  walk(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'toLowerCase') return;
    const trimmed = node.expression.expression;
    if (!ts.isCallExpression(trimmed) || !ts.isPropertyAccessExpression(trimmed.expression) || trimmed.expression.name.text !== 'trim') return;
    const named = trimmed.expression.expression;
    if (ts.isPropertyAccessExpression(named) && named.name.text === 'name') {
      keys.push(`line ${lineOf(source, node)}: ${expressionText(named)}.trim().toLowerCase()`);
    }
  });
  return keys;
};

describe('one list of the people a session lists (sessionRoster.ts → sessionParticipants)', () => {
  it.each(SCREENS)('%s lists its people with the shared function', (file) => {
    const source = parse(file);
    expect(getParticipantsOf(source), 'its getParticipants').toBe(SHARED_CALL);
    expect(importsOf(source).get('./session/sessionRoster')).toEqual(expect.arrayContaining(['sessionParticipants']));
  });

  it.each(SCREENS)('%s keys nobody by a name of its own', (file) => {
    expect(nameKeysIn(parse(file))).toEqual([]);
  });

  it('the Discuss topic finds its author in the same list', () => {
    const source = parse(DISCUSS);
    expect(importsOf(source).get('./sessionRoster')).toEqual(expect.arrayContaining(['sessionParticipants']));
    expect(sharedCallsIn(source)).toEqual([SHARED_CALL]);
  });
});
