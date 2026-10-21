// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { translateErrorMessage } from '../i18n/errorMessages';
import { createTranslator } from '../i18n/translate';

/**
 * Every error code the Jira server code can answer, read from the source, reads
 * as a sentence on screen in English and French.
 *
 * `jiraService` rejects with the route's code as the error's message, a batch
 * resolves with its stop code, the console's test card shows `test-jira`'s
 * `{ ok: false, error }` code, and every screen shows them through
 * `translateErrorMessage`. A code that is not in `i18n/errorMessages.ts`
 * reaches the user raw — "failed_to_delete" under the Remove button.
 * `i18nJiraErrors.test.ts` pins a sentence for each code of the contract; this
 * suite is the guard for the codes nobody listed: it collects them from the
 * code itself, so a new `res.status(…).json({ error: 'new_code' })` fails here
 * until it is translated.
 *
 * The source is read with the TypeScript parser, never with a regular
 * expression (AGENTS.md → *Accessibility*: a regex once dropped three buttons
 * it was meant to count). What is collected:
 *
 *  - every `error:` property of an object literal in the Jira routes and
 *    services, `{ error }` included — a string, a constant imported from a
 *    module (resolved by importing it), a `const NAME = '…'` declared at the
 *    top level of the same file, or either branch of a `? :`. Any other value
 *    is one passed on, and must be in `PASS_THROUGHS` with the rule below
 *    that collects where it comes from; a value that is neither fails the
 *    suite, since it is a code nobody can collect;
 *  - the codes `authenticateTeam` answers with (every Jira team route sends its
 *    `{ error }` on), the `*_ERROR` constants of `utils/jira.js`, which
 *    `validateJiraTarget` refuses with, and the `{ success: false, error }`
 *    failures of `dataStore.js`, which the target route passes on from
 *    `atomicUpdateTeam`;
 *  - every `code:` of a `new JiraError(…)` in the Jira client: the console's
 *    test answers `{ ok: false, error: err.code }`. A `new JiraError` whose
 *    code is not a string literal it sets itself fails the suite: it would be
 *    a code nobody can collect;
 *  - every value assigned to `stopped`, and returned by a `…Stop` function, in
 *    the batch (`jiraIssues.js`). A value the source does not say (a variable,
 *    a call to a helper not named `…Stop`) fails the suite, for the same
 *    reason;
 *  - on the client: the `JiraStopCode` union of `types.ts`, and the codes
 *    `services/jiraService.ts` stops or rejects with itself (`outcome_unknown`,
 *    `server_restarting`, `unknown_error`);
 *  - the Jira codes of the single-team restore route. That route answers its
 *    own codes too, which its dialog reads (`RESTORE_NOTICES` in
 *    `components/admin/teamAdminApi.ts`), so every code it answers is read and
 *    must be in `RESTORE_JIRA_CODES` or `RESTORE_OWN_CODES`: a new one fails
 *    until someone says which it is.
 *
 * The Jira server files are found by name (every `jira*.js` under `server/`), so a new
 * module joins the scan without anyone listing it; `secretBox.js`, which seals
 * the tokens, is named by hand.
 *
 * Not collected: `outboundHttp.js`'s transport codes (`timeout`, `tls`…). They
 * are never an `error`: the console's test answers them as `transport` beside
 * `jira_unreachable`, and its card reads that field with sentences of its own
 * (`components/admin/JiraSettingsCard.tsx`); the team routes only log them.
 */

const ROOT = resolve(__dirname, '..');

// Every Jira module of the server, by name, and the one that seals tokens.
const JIRA_SERVER_FILES = [
  ...readdirSync(join(ROOT, 'server'), { recursive: true, encoding: 'utf8' })
    .map((file) => `server/${file.split('\\').join('/')}`)
    .filter((file) => /(^|\/)jira[^/]*\.js$/i.test(file)),
  'server/services/secretBox.js'
].sort();

const RESTORE_ROUTE = 'server/routes/superAdminTeamRestoreRoutes.js';

/**
 * Every `error:` value the scanned files pass on rather than say, as written,
 * how many times the file passes it on, and where its codes are collected.
 * Keyed by file, then by the expression's text; `error` is the shorthand
 * `{ error }`. The count is checked: one more `{ error }` in a file that
 * already passes one on is a new value, whose rule nobody has named yet; an
 * entry the source no longer has fails too, so the list cannot keep allowing
 * a value nobody checks.
 */
const PASS_THROUGHS: Record<string, Record<string, { times: number; from: string }>> = {
  'server/routes/jiraRoutes.js': {
    error: { times: 1, from: '`authenticated` sends authenticateTeam’s refusal on: collected from teamService.js' },
    'validation.error': { times: 1, from: 'validateJiraTarget: the *_ERROR constants of utils/jira.js' },
    'target.error': { times: 1, from: 'resolveJiraTarget: validateJiraTarget’s constants, or its own literal in this file' },
    'access.error': { times: 2, from: 'teamAccess: its literals in this file' },
    'result.error': { times: 1, from: 'atomicUpdateTeam: the { success: false, error } failures of dataStore.js' },
    'err.code': { times: 1, from: 'test-jira’s JiraError: the code of every new JiraError' }
  },
  'server/services/jiraIssues.js': {
    'result.error': { times: 1, from: 'the cause of a key that could not be saved: logged, never answered' },
    lastError: { times: 1, from: 'the cause of a key that could not be saved: logged, never answered' }
  },
  [RESTORE_ROUTE]: {
    error: { times: 1, from: '`refuse`’s parameter: its call sites are collected' },
    'read.error': { times: 2, from: 'readArchive: its literals in this file' },
    'resolved.error': { times: 1, from: 'resolveDeletedTeamName: its literals in this file' },
    'err.code': { times: 1, from: 'a TeamRestoreError: the code of every new TeamRestoreError in teamRestore.js' }
  }
};

// What the single-team restore answers: its one Jira code, translated like the
// others, and its own codes, which its dialog reads.
const RESTORE_JIRA_CODES = ['team_secret_delete_failed'];
const RESTORE_OWN_CODES = [
  'archived_team_malformed', 'backup_not_found', 'list_failed', 'missing_backup_id', 'missing_team_id',
  'pre_restore_snapshot_failed', 'restore_failed', 'restore_in_progress', 'session_read_failed', 'team_changed',
  'team_name_empty', 'team_name_exists', 'team_name_too_long', 'team_not_in_backup', 'too_many_attempts',
  'too_many_requests', 'unauthorized'
];

type Found = { code: string; where: string };

const parse = (file: string) => {
  const kind = file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true, kind);
};

const walk = (node: ts.Node, visit: (node: ts.Node) => void) => {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
};

const where = (source: ts.SourceFile, node: ts.Node) =>
  `${source.fileName}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;

const propertyName = (node: ts.ObjectLiteralElementLike) =>
  (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ? node.name.text
    : null;

/** A property's value: its initializer, or the name `{ error }` reads. */
const propertyValue = (node: ts.ObjectLiteralElementLike): ts.Expression | null => {
  if (ts.isPropertyAssignment(node)) return node.initializer;
  if (ts.isShorthandPropertyAssignment(node)) return node.name;
  return null;
};

/**
 * What a file says about its names: the ones it imports from a module (the
 * local name → [module path, exported name]), its top-level
 * `const NAME = '<string>'`, and how many times each name is declared — a
 * name declared twice may be either declaration, so it is never resolved.
 */
type Scope = {
  source: ts.SourceFile;
  imports: Map<string, { module: string; exported: string }>;
  constants: Map<string, string>;
  declarations: Map<string, number>;
};

const scopeOf = (source: ts.SourceFile): Scope => {
  const imports = new Map<string, { module: string; exported: string }>();
  const constants = new Map<string, string>();
  const declarations = new Map<string, number>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const bindings = statement.importClause?.namedBindings;
      const module = statement.moduleSpecifier.text;
      if (!bindings || !ts.isNamedImports(bindings) || !module.startsWith('.')) continue;
      for (const element of bindings.elements) {
        imports.set(element.name.text, { module: resolve(ROOT, dirname(source.fileName), module), exported: (element.propertyName ?? element.name).text });
      }
    }
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer && ts.isStringLiteralLike(declaration.initializer)) {
          constants.set(declaration.name.text, declaration.initializer.text);
        }
      }
    }
  }
  walk(source, (node) => {
    const declared = ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)
      || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isImportSpecifier(node)
      ? node.name
      : undefined;
    if (declared && ts.isIdentifier(declared)) declarations.set(declared.text, (declarations.get(declared.text) ?? 0) + 1);
  });
  return { source, imports, constants, declarations };
};

/**
 * The string values an expression can take, as far as the source says them:
 * a literal, an imported constant, a top-level string constant of the same
 * file, or the branches of a `? :`; `null` says no code at all. Anything else
 * (a variable, a property read, a call) is a value the source does not say:
 * `undefined` is returned, and the caller decides whether it may be passed on.
 */
const valuesOf = async (scope: Scope, expression: ts.Expression): Promise<string[] | undefined> => {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (expression.kind === ts.SyntaxKind.NullKeyword) return [];
  if (ts.isParenthesizedExpression(expression)) return valuesOf(scope, expression.expression);
  if (ts.isConditionalExpression(expression)) {
    const whenTrue = await valuesOf(scope, expression.whenTrue);
    const whenFalse = await valuesOf(scope, expression.whenFalse);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : undefined;
  }
  if (ts.isIdentifier(expression) && scope.declarations.get(expression.text) === 1) {
    const constant = scope.constants.get(expression.text);
    if (constant !== undefined) return [constant];
    const imported = scope.imports.get(expression.text);
    if (imported) {
      const module = await import(pathToFileURL(imported.module).href);
      const value = module[imported.exported];
      if (typeof value !== 'string') throw new Error(`${where(scope.source, expression)}: ${expression.text} is not a string constant`);
      return [value];
    }
  }
  return undefined;
};

/**
 * The codes of every `error:` property of an object literal under `root`
 * (`filter` narrows which literals count). A value the source does not say
 * must be one `PASS_THROUGHS` allows for this file; `used` counts each one
 * allowed, so a new one written the same way, or an entry nobody uses any
 * more, is noticed.
 */
const errorProperties = async (
  source: ts.SourceFile,
  { root = source, filter = () => true, used }: {
    root?: ts.Node;
    filter?: (literal: ts.ObjectLiteralExpression) => boolean;
    used?: Map<string, number>;
  } = {}
): Promise<Found[]> => {
  const scope = scopeOf(source);
  const pending: { node: ts.Node; expression: ts.Expression }[] = [];
  walk(root, (node) => {
    if (!ts.isObjectLiteralExpression(node) || !filter(node)) return;
    for (const property of node.properties) {
      const expression = propertyName(property) === 'error' ? propertyValue(property) : null;
      if (expression) pending.push({ node: property, expression });
    }
  });
  const found: Found[] = [];
  for (const { node, expression } of pending) {
    const codes = await valuesOf(scope, expression);
    if (codes) {
      for (const code of codes) found.push({ code, where: where(source, node) });
      continue;
    }
    const text = expression.getText(source);
    if (!PASS_THROUGHS[source.fileName]?.[text]) {
      throw new Error(
        `${where(source, node)}: error: ${text} is a value this suite cannot read. Say the code (a literal or a string constant), `
          + 'or add it to PASS_THROUGHS with the rule that collects where it comes from'
      );
    }
    const key = `${source.fileName} ${text}`;
    used?.set(key, (used.get(key) ?? 0) + 1);
  }
  return found;
};

/**
 * Every `code:` of a `new JiraError({ … })`. The code must be a string literal
 * the object sets itself, after any spread (a spread could otherwise put
 * another one in its place): anything else is a code this suite cannot see,
 * and is refused rather than skipped.
 */
const jiraErrorCodes = (source: ts.SourceFile): Found[] => {
  const found: Found[] = [];
  walk(source, (node) => {
    if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'JiraError') return;
    const [details] = node.arguments ?? [];
    if (!details || !ts.isObjectLiteralExpression(details)) {
      throw new Error(`${where(source, node)}: new JiraError takes an object literal, so its code can be read`);
    }
    const properties = [...details.properties];
    const index = properties.findIndex((property) => propertyName(property) === 'code');
    const property = properties[index];
    if (!property || !ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer)) {
      throw new Error(`${where(source, node)}: new JiraError must set its code as a string literal`);
    }
    if (properties.slice(index + 1).some((later) => ts.isSpreadAssignment(later) || propertyName(later) === 'code')) {
      throw new Error(`${where(source, node)}: nothing after a JiraError's code may replace it`);
    }
    found.push({ code: property.initializer.text, where: where(source, property) });
  });
  return found;
};

const isStopHelperCall = (expression: ts.Expression) =>
  ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && /Stop$/.test(expression.expression.text);

/**
 * What the batch stops with: every value given to `stopped`, and every one a
 * `…Stop` function returns. A call to a `…Stop` helper is read through that
 * helper's returns; any other value the source does not say is refused.
 */
const stopCodes = async (source: ts.SourceFile): Promise<Found[]> => {
  const scope = scopeOf(source);
  const expressions: ts.Expression[] = [];
  walk(source, (node) => {
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left)
      && node.left.text === 'stopped'
      && !isStopHelperCall(node.right)
    ) {
      expressions.push(node.right);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /Stop$/.test(node.name.text) && node.initializer) {
      const { initializer } = node;
      const returned: ts.Expression[] = [];
      if (ts.isArrowFunction(initializer) && !ts.isBlock(initializer.body)) returned.push(initializer.body);
      else {
        walk(initializer, (inner) => {
          if (ts.isReturnStatement(inner) && inner.expression) returned.push(inner.expression);
        });
      }
      if (returned.length === 0) throw new Error(`${where(source, node)}: ${node.name.text} returns no stop code the source says`);
      expressions.push(...returned);
    }
  });
  const found: Found[] = [];
  for (const expression of expressions) {
    const codes = await valuesOf(scope, expression);
    if (!codes || codes.length === 0) throw new Error(`${where(source, expression)}: a stop code the source does not say`);
    for (const code of codes) found.push({ code, where: where(source, expression) });
  }
  return found;
};

/** The string literal members of a union type alias or interface property type. */
const literalTypes = (type: ts.TypeNode | undefined): string[] => {
  if (!type) return [];
  if (ts.isUnionTypeNode(type)) return type.types.flatMap(literalTypes);
  if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) return [type.literal.text];
  return [];
};

/** `{ success: false, … }`: a dataStore failure, whose `error` the routes pass on. */
const isFailure = (literal: ts.ObjectLiteralExpression) =>
  literal.properties.some((property) => propertyName(property) === 'success'
    && ts.isPropertyAssignment(property)
    && property.initializer.kind === ts.SyntaxKind.FalseKeyword);

/**
 * Every code the single-team restore route answers: its `error:` properties,
 * what it gives `refuse`, and the code of every `TeamRestoreError` the pure
 * planner throws, which the route answers with. A value the source does not
 * say is refused, as everywhere in this suite.
 */
const restoreRouteCodes = async (
  used: Map<string, number>,
  restore = parse(RESTORE_ROUTE),
  planner = parse('server/services/teamRestore.js')
): Promise<Found[]> => {
  const found = await errorProperties(restore, { used });

  const scope = scopeOf(restore);
  const refused: ts.Expression[] = [];
  walk(restore, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'refuse' && node.arguments[1]) {
      refused.push(node.arguments[1]);
    }
  });
  for (const expression of refused) {
    const codes = await valuesOf(scope, expression);
    if (!codes) throw new Error(`${where(restore, expression)}: refuse is given a code the source does not say`);
    for (const code of codes) found.push({ code, where: where(restore, expression) });
  }

  walk(planner, (node) => {
    if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'TeamRestoreError') return;
    const [code] = node.arguments ?? [];
    if (!code || !ts.isStringLiteralLike(code)) throw new Error(`${where(planner, node)}: new TeamRestoreError must name its code as a string literal`);
    found.push({ code: code.text, where: where(planner, node) });
  });
  return found;
};

const collectServerCodes = async () => {
  const found: Found[] = [];
  const used = new Map<string, number>();
  for (const file of JIRA_SERVER_FILES) {
    const source = parse(file);
    found.push(...(await errorProperties(source, { used })), ...jiraErrorCodes(source), ...(await stopCodes(source)));
  }

  // authenticateTeam: what every Jira team route answers a refused credential with.
  const teamService = parse('server/services/teamService.js');
  let authenticate: ts.Node | null = null;
  walk(teamService, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'authenticateTeam') authenticate = node;
  });
  if (!authenticate) throw new Error('authenticateTeam was not found in teamService.js');
  found.push(...(await errorProperties(teamService, { root: authenticate, used })));

  // validateJiraTarget's refusals, which the target and issues routes pass on.
  const jiraUtils = await import('../utils/jira.js');
  for (const [name, value] of Object.entries(jiraUtils)) {
    if (/_ERROR$/.test(name) && typeof value === 'string') found.push({ code: value, where: `utils/jira.js ${name}` });
  }

  // atomicUpdateTeam's failures, which the target route passes on.
  found.push(...(await errorProperties(parse('server/services/dataStore.js'), { filter: isFailure, used })));

  // The single-team restore: its Jira codes are translated like the rest.
  const restore = await restoreRouteCodes(used);
  found.push(...restore.filter((entry) => RESTORE_JIRA_CODES.includes(entry.code)));

  return { found, restore, used };
};

const collectClientCodes = (): Found[] => {
  const found: Found[] = [];

  const types = parse('types.ts');
  walk(types, (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'JiraStopCode') {
      for (const code of literalTypes(node.type)) found.push({ code, where: where(types, node) });
    }
  });

  // jiraService's own: the stop of an answer that was lost or came from an
  // older pod, and the code of an answer it cannot read.
  const service = parse('services/jiraService.ts');
  walk(service, (node) => {
    if (ts.isPropertyAssignment(node) && propertyName(node) === 'stopped' && ts.isStringLiteralLike(node.initializer)) {
      found.push({ code: node.initializer.text, where: where(service, node) });
    }
    if (ts.isPropertySignature(node) && ts.isIdentifier(node.name) && node.name.text === 'stopped') {
      for (const code of literalTypes(node.type)) found.push({ code, where: where(service, node) });
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'JiraServiceError') {
      const [code] = node.arguments ?? [];
      if (code && ts.isStringLiteralLike(code)) found.push({ code: code.text, where: where(service, node) });
    }
  });
  return found;
};

const en = createTranslator('en');
const fr = createTranslator('fr');

// A code read raw, or as nothing: the translation of an unknown code is the
// code itself (translateErrorMessage shows what it does not know as it came).
const isUntranslated = (code: string, sentence: string) => sentence === code || /^[a-z0-9_]+$/.test(sentence) || sentence.trim() === '';

describe('every error code the Jira code can answer is a sentence on screen', async () => {
  const { found: server, restore, used } = await collectServerCodes();
  const client = collectClientCodes();
  const codes = [...new Set([...server, ...client].map((entry) => entry.code))].sort();

  it('finds the codes it is meant to find', () => {
    // The collection itself is the guard: if a rule stopped matching (a file
    // renamed, a pattern changed), the list would shrink in silence.
    expect(codes).toEqual(expect.arrayContaining([
      // the team routes
      'invalid_token', 'invalid_password', 'team_not_found', 'too_many_requests', 'invalid_request',
      'jira_not_configured', 'jira_secret_unavailable', 'jira_token_missing', 'jira_token_unusable', 'invalid_email',
      'jira_auth_failed', 'jira_auth_failed_cloud', 'jira_forbidden', 'jira_not_found', 'jira_rate_limited',
      'jira_unavailable', 'jira_unreachable', 'jira_parent_invalid', 'jira_target_missing',
      'invalid_jira_target', 'invalid_jira_labels',
      'failed_to_load', 'failed_to_save', 'failed_to_delete', 'failed_to_create',
      // the console
      'unauthorized', 'too_many_attempts', 'invalid_jira_base_url', 'jira_test_failed', 'jira_refused', 'jira_redirect',
      // a batch's stops
      'token_refused', 'link_not_saved', 'server_restarting', 'client_gone', 'outcome_unknown', 'unknown_error',
      // the single-team restore
      'team_secret_delete_failed'
    ]));
  });

  it('scans every Jira module of the server', () => {
    expect(JIRA_SERVER_FILES).toEqual(expect.arrayContaining([
      'server/routes/jiraRoutes.js',
      'server/services/jiraClient.js',
      'server/services/jiraCredentials.js',
      'server/services/jiraIssues.js',
      'server/services/secretBox.js'
    ]));
  });

  // A value passed on is checked only through the rule its entry names: a new
  // one written the same way must have its rule named, and an entry the
  // source no longer has would keep allowing, unchecked, the next one.
  it('allows only the pass-throughs the sources have, as many times as they have them', () => {
    const allowed = Object.entries(PASS_THROUGHS)
      .flatMap(([file, entries]) => Object.entries(entries).map(([text, { times }]) => [`${file} ${text}`, times] as const));
    expect(Object.fromEntries(used), 'a value passed on is new, or gone: name the rule that collects its codes in PASS_THROUGHS')
      .toEqual(Object.fromEntries(allowed));
  });

  // The restore route answers codes of its own, which this suite does not
  // translate, beside its Jira one: a new code is classified before it lands.
  it('knows every code the single-team restore answers, and which are Jira codes', () => {
    const answered = [...new Set(restore.map((entry) => entry.code))].sort();
    const unclassified = answered.filter((code) => !RESTORE_JIRA_CODES.includes(code) && !RESTORE_OWN_CODES.includes(code));
    expect(unclassified, 'add each code to RESTORE_JIRA_CODES (and translate it) or to RESTORE_OWN_CODES').toEqual([]);
    expect(answered).toEqual([...RESTORE_JIRA_CODES, ...RESTORE_OWN_CODES].sort());
  });

  // "Reads as a sentence" cannot tell the right sentence from another one:
  // these are pinned to theirs. The token form and the console's test give
  // `jira_not_found`, `jira_auth_failed` and `jira_forbidden` sentences of
  // their own (`jira.settings.notFound`, `admin.jira.test*`); the shared ones
  // below are what every other screen shows.
  it.each([
    ['jira_not_found', 'errors.jiraNotFound'],
    ['jira_auth_failed', 'errors.jiraAuthFailed'],
    ['jira_forbidden', 'errors.jiraForbidden'],
    ['jira_rate_limited', 'errors.jiraRateLimited'],
    ['jira_unavailable', 'errors.jiraUnavailable'],
    ['jira_unreachable', 'errors.jiraUnreachable'],
    ['token_refused', 'errors.jiraTokenRefused'],
    ['link_not_saved', 'errors.jiraLinkNotSaved'],
    // The codes translated for this suite: each one has the sentence that is
    // right for it, and another one would mislead ("could not be saved" for a
    // failed read, "Jira refused" for a test that never ran).
    ['failed_to_load', 'errors.failedToLoad'],
    ['failed_to_delete', 'errors.failedToDelete'],
    ['unauthorized', 'admin.notice.sessionExpired'],
    ['jira_refused', 'errors.jiraRefused'],
    ['jira_redirect', 'errors.jiraRedirect'],
    ['jira_test_failed', 'admin.jira.testUnavailable'],
    ['team_secret_delete_failed', 'adminBackups.teamRestore.error.secretDeleteFailed']
  ] as const)('translates %s with its own sentence, %s', (code, key) => {
    expect(translateErrorMessage(code, en)).toBe(en(key));
    expect(translateErrorMessage(code, fr)).toBe(fr(key));
  });

  it.each(codes)('translates %s in English and French', (code) => {
    const sentences = { en: translateErrorMessage(code, en), fr: translateErrorMessage(code, fr) };
    const origins = [...server, ...client].filter((entry) => entry.code === code).map((entry) => entry.where);
    expect(isUntranslated(code, sentences.en), `${code} (${origins.join(', ')}) reads raw in English`).toBe(false);
    expect(isUntranslated(code, sentences.fr), `${code} (${origins.join(', ')}) reads raw in French`).toBe(false);
  });

  // The guard guarded: a route that starts answering a new code is collected,
  // and fails the suite while no sentence exists for it.
  it('would catch a new code a route starts answering', async () => {
    const source = ts.createSourceFile(
      'server/routes/jiraRoutes.js',
      "app.post('/x', async (req, res) => { res.status(500).json({ error: 'jira_brand_new_failure' }); });",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );
    const found = await errorProperties(source);
    expect(found.map((entry) => entry.code)).toEqual(['jira_brand_new_failure']);
    expect(isUntranslated('jira_brand_new_failure', translateErrorMessage('jira_brand_new_failure', en))).toBe(true);
  });

  const snippet = (text: string, file = 'server/services/jiraSnippet.js') =>
    ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

  // A code kept in a constant of the same file is a code like any other.
  it('collects a code held in a top-level constant of the same file', async () => {
    const found = await errorProperties(snippet(
      "const JIRA_OFF = 'jira_turned_off_brand_new';\n"
        + "const teamAccess = (connection) => { if (!connection.enabled) return { error: JIRA_OFF }; return {}; };"
    ));
    expect(found.map((entry) => entry.code)).toEqual(['jira_turned_off_brand_new']);
    expect(isUntranslated('jira_turned_off_brand_new', translateErrorMessage('jira_turned_off_brand_new', en))).toBe(true);
  });

  it.each([
    ['a variable', 'const answer = (code) => ({ error: code });'],
    ['the shorthand', 'const answer = (error) => ({ error });'],
    ['a constant declared inside a function', "const answer = () => { const CODE = 'jira_x'; return { error: CODE }; };"],
    ['a top-level constant shadowed where it is used', "const CODE = 'jira_x'; const answer = (CODE) => ({ error: CODE });"],
    ['a top-level variable that is not a const', "let CODE = 'jira_x'; const answer = () => ({ error: CODE });"],
    ['a property read', 'const answer = (result) => ({ error: result.error });'],
    ['a call', 'const answer = (err) => ({ error: codeFor(err) });'],
    ['one branch of a ? : the source does not say', "const answer = (err) => ({ error: err ? err.code : 'jira_x' });"]
  ])('refuses an error value it cannot read: %s', async (_label, text) => {
    await expect(errorProperties(snippet(text))).rejects.toThrow(/cannot read/);
  });

  // The allowlist is per file: what one file may pass on, another may not.
  it('allows a pass-through only in the file it is listed for', async () => {
    const text = 'const answer = (access) => ({ error: access.error });';
    await expect(errorProperties(snippet(text, 'server/routes/jiraRoutes.js'))).resolves.toEqual([]);
    await expect(errorProperties(snippet(text))).rejects.toThrow(/cannot read/);
  });

  it('reads what the restore route gives refuse, and what the planner throws', async () => {
    const found = await restoreRouteCodes(
      new Map(),
      snippet("const SNAPSHOT = 'pre_restore_snapshot_failed'; refuse(503, SNAPSHOT); refuse(409, ok ? 'team_changed' : 'restore_failed');", RESTORE_ROUTE),
      snippet("throw new TeamRestoreError('archived_team_malformed', 422);", 'server/services/teamRestore.js')
    );
    expect(found.map((entry) => entry.code)).toEqual(['pre_restore_snapshot_failed', 'team_changed', 'restore_failed', 'archived_team_malformed']);
  });

  it.each([
    ['refuse given a value the source does not say', 'refuse(503, codeFor(err));', '', /refuse/],
    ['a TeamRestoreError whose code is not a literal', '', 'throw new TeamRestoreError(code, 422);', /TeamRestoreError/]
  ])('refuses a restore code it cannot read: %s', async (_label, route, planner, message) => {
    await expect(restoreRouteCodes(
      new Map(),
      snippet(route, RESTORE_ROUTE),
      snippet(planner, 'server/services/teamRestore.js')
    )).rejects.toThrow(message);
  });

  it.each([
    ['a code held in a variable', 'const code = "x"; throw new JiraError({ code, outcome: "refused" });'],
    ['a code computed', 'throw new JiraError({ code: `jira_${kind}`, outcome: "refused" });'],
    ['no object literal', 'throw new JiraError(details);'],
    ['a spread after the code', 'throw new JiraError({ code: "jira_refused", ...details });']
  ])('refuses a JiraError it cannot read the code of: %s', (_label, text) => {
    expect(() => jiraErrorCodes(snippet(text))).toThrow(/JiraError/);
  });

  it.each([
    ['a variable', 'let stopped; stopped = reason;'],
    ['a helper not named …Stop', 'let stopped; stopped = stopFor(err);'],
    ['a …Stop helper returning what the source does not say', 'const otherStop = (err) => err.code; let stopped; stopped = otherStop(err);']
  ])('refuses a stop code it cannot read: %s', async (_label, text) => {
    await expect(stopCodes(snippet(text))).rejects.toThrow(/stop code/);
  });
});
