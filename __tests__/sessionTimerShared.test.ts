// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import ts from 'typescript';

/**
 * Retrospectives and health checks share ONE countdown timer, and this file is
 * what keeps it one.
 *
 * The two session types grew as two components, and every behaviour each one
 * carried a private copy of drifted (AGENTS.md → *Retrospectives and health
 * checks — one behaviour for what they share*). The timer used to live inside
 * the retrospective alone: an interval in `Session.tsx`, an `<audio>` element,
 * and a dozen direct `settings.timer… =` writes. It is now
 * `utils/sessionTimer.ts` (every write), `components/session/useSessionTimer.ts`
 * (tick, expiry, alarm) and `components/session/SessionTimer.tsx` (the UI), and
 * both headers render that component. These assertions fail the day someone
 * puts timer behaviour back into one session type — which is how the next
 * timer change would reach a retrospective and silently miss a health check.
 *
 * **The scan walks the TypeScript AST, never a regular expression over the
 * source** (AGENTS.md → *Accessibility*: a regex over JSX miscounted a finding
 * three times). The parser also skips comments for free, so the prose that
 * explains the shared timer cannot trip the guard.
 */

const REPO_ROOT = join(__dirname, '..');

const SESSION_COMPONENT = 'components/Session.tsx';
const HEALTH_CHECK_COMPONENT = 'components/HealthCheckSession.tsx';
const RETRO_HEADER = 'components/session/SessionHeader.tsx';
const SHARED_TIMER_UI = 'components/session/SessionTimer.tsx';
const SHARED_TIMER_HELPERS = 'utils/sessionTimer.ts';

/** The five stored timer fields (`SessionTimerSettings` in types.ts). */
const TIMER_FIELDS = new Set(['timerRunning', 'timerSeconds', 'timerInitial', 'timerStartedAt', 'timerAcknowledged']);
const ALARM_ASSET = 'timer-alert.mp3';

const SHARE_ADVICE =
  'Put timer behaviour in utils/sessionTimer.ts (writes) or components/session/useSessionTimer.ts / ' +
  'SessionTimer.tsx (tick, alarm, UI) so both session types get it.';

// --- Parsing --------------------------------------------------------------

const parse = (fileName: string, source: string): ts.SourceFile =>
  ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    // A `.ts` file parsed as TSX would misread `<T>value` assertions as JSX.
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

const parseFile = (repoPath: string): ts.SourceFile =>
  parse(repoPath, readFileSync(join(REPO_ROOT, repoPath), 'utf8'));

/** Every `.ts`/`.tsx` source file under a directory, repo-relative, tests excluded. */
const sourceFilesUnder = (dir: string, extensions: string[]): string[] =>
  readdirSync(join(REPO_ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFilesUnder(child, extensions);
    const isSource = extensions.some((ext) => entry.name.endsWith(ext)) && !entry.name.endsWith('.d.ts');
    return isSource && !/\.test\.tsx?$/.test(entry.name) ? [child] : [];
  });

const walk = (node: ts.Node, visit: (node: ts.Node) => void): void => {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
};

interface Finding {
  line: number;
  what: string;
}

const at = (sourceFile: ts.SourceFile, node: ts.Node, what: string): Finding => ({
  line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  what
});

const describeFindings = (file: string, findings: Finding[]): string[] =>
  findings.map((finding) => `${file}:${finding.line} ${finding.what}`);

// --- Detectors ------------------------------------------------------------

/** `x.timerRunning` or `x['timerRunning']` — the field name, when it is one of the five. */
const timerFieldTarget = (node: ts.Expression): string | null => {
  const target = ts.isParenthesizedExpression(node) ? node.expression : node;
  if (ts.isPropertyAccessExpression(target) && TIMER_FIELDS.has(target.name.text)) return target.name.text;
  if (
    ts.isElementAccessExpression(target) &&
    ts.isStringLiteralLike(target.argumentExpression) &&
    TIMER_FIELDS.has(target.argumentExpression.text)
  ) {
    return target.argumentExpression.text;
  }
  return null;
};

const isAssignmentOperator = (kind: ts.SyntaxKind): boolean =>
  kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;

/**
 * Every write of a stored timer field: `=` and compound assignments, `++`/`--`,
 * `delete`, and an object literal naming one (`{ ...s.settings, timerRunning: false }`
 * is the same write in the immutable style).
 */
const findTimerWrites = (sourceFile: ts.SourceFile): Finding[] => {
  const findings: Finding[] = [];
  walk(sourceFile, (node) => {
    if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      const field = timerFieldTarget(node.left);
      if (field) findings.push(at(sourceFile, node, `assigns ${field}`));
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      const field = timerFieldTarget(node.operand);
      if (field) findings.push(at(sourceFile, node, `increments/decrements ${field}`));
    } else if (ts.isDeleteExpression(node)) {
      const field = timerFieldTarget(node.expression);
      if (field) findings.push(at(sourceFile, node, `deletes ${field}`));
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (
          (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
          (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) &&
          TIMER_FIELDS.has(property.name.text)
        ) {
          findings.push(at(sourceFile, property, `writes ${property.name.text} in an object literal`));
        }
      }
    }
  });
  return findings;
};

const calleeName = (call: ts.CallExpression): string | null => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
};

const callsNamed = (root: ts.Node, name: string): ts.CallExpression[] => {
  const calls: ts.CallExpression[] = [];
  walk(root, (node) => {
    if (ts.isCallExpression(node) && calleeName(node) === name) calls.push(node);
  });
  return calls;
};

/**
 * The one interval a session component legitimately owns: `Session.tsx`'s
 * "is typing" keepalive, which re-sends the participant-activity signal
 * (`syncService.sendActivity`). It has nothing to do with the timer, so it is
 * recognised by what its callback does — anything else that ticks belongs in
 * `useSessionTimer`.
 */
const isTypingKeepalive = (call: ts.CallExpression): boolean => {
  const callback = call.arguments[0];
  return (
    !!callback &&
    (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
    callsNamed(callback, 'sendActivity').length > 0
  );
};

const findIntervals = (sourceFile: ts.SourceFile): Finding[] =>
  callsNamed(sourceFile, 'setInterval')
    .filter((call) => !isTypingKeepalive(call))
    .map((call) => at(sourceFile, call, 'calls setInterval'));

/**
 * Everything that plays or holds the alarm: an `<audio>` element, `new Audio()`,
 * `document.createElement('audio')`, the alarm asset's path, and (with
 * `includeAudioType`) the `HTMLAudioElement` type a hand-rolled ref needs.
 */
const findAlarm = (sourceFile: ts.SourceFile, { includeAudioType }: { includeAudioType: boolean }): Finding[] => {
  const findings: Finding[] = [];
  walk(sourceFile, (node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sourceFile) === 'audio') {
      findings.push(at(sourceFile, node, 'renders an <audio> element'));
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Audio') {
      findings.push(at(sourceFile, node, 'constructs new Audio()'));
    } else if (
      ts.isCallExpression(node) &&
      calleeName(node) === 'createElement' &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text.toLowerCase() === 'audio'
    ) {
      findings.push(at(sourceFile, node, "creates an 'audio' element"));
    } else if (
      (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) &&
      node.text.includes(ALARM_ASSET)
    ) {
      findings.push(at(sourceFile, node, `mentions ${ALARM_ASSET}`));
    } else if (includeAudioType && ts.isIdentifier(node) && node.text === 'HTMLAudioElement') {
      findings.push(at(sourceFile, node, 'references HTMLAudioElement'));
    }
  });
  return findings;
};

/** The body of every `setPhase` the file defines (`const setPhase = …` or `function setPhase`). */
const setPhaseDefinitions = (sourceFile: ts.SourceFile): ts.Node[] => {
  const definitions: ts.Node[] = [];
  walk(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'setPhase' &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      definitions.push(node.initializer);
    } else if (ts.isFunctionDeclaration(node) && node.name?.text === 'setPhase') {
      definitions.push(node);
    }
  });
  return definitions;
};

/** The repo-relative module (no extension) an identifier is imported from, or null. */
const importSourceOf = (sourceFile: ts.SourceFile, name: string): string | null => {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    const named =
      clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        ? clause.namedBindings.elements.some((element) => element.name.text === name)
        : false;
    if (clause.name?.text === name || named) {
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith('.')) return specifier;
      return relative(REPO_ROOT, resolve(REPO_ROOT, dirname(sourceFile.fileName), specifier)).split('\\').join('/');
    }
  }
  return null;
};

const jsxElementsNamed = (sourceFile: ts.SourceFile, tagName: string): ts.Node[] => {
  const elements: ts.Node[] = [];
  walk(sourceFile, (node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sourceFile) === tagName) {
      elements.push(node);
    }
  });
  return elements;
};

// --- The scanner works ----------------------------------------------------

describe('the timer-duplication scanner', () => {
  // A copy of the old, retro-only timer in miniature. If the detectors stopped
  // detecting, every assertion below would pass vacuously.
  const COPY = parse(
    'Copy.tsx',
    `
import React, { useEffect, useRef } from 'react';
const Copy = ({ s, update }) => {
  const alarm = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const id = setInterval(() => { s.settings.timerSeconds -= 1; }, 1000);
    return () => clearInterval(id);
  }, []);
  const stop = () => { s.settings.timerRunning = false; s.settings['timerAcknowledged'] = true; };
  const restart = () => ({ ...s.settings, timerStartedAt: Date.now() });
  const tick = () => { s.settings.timerInitial++; };
  const ring = () => new Audio(\`/assets/\${'timer-alert.mp3'}\`).play();
  const setPhase = (p) => update((d) => { d.phase = p; });
  return <div><audio ref={alarm} src="/assets/timer-alert.mp3" /></div>;
};
`
  );

  it('detects every shape of timer write', () => {
    const writes = findTimerWrites(COPY).map((finding) => finding.what);
    expect(writes).toEqual([
      'assigns timerSeconds',
      'assigns timerRunning',
      'assigns timerAcknowledged',
      'writes timerStartedAt in an object literal',
      'increments/decrements timerInitial'
    ]);
  });

  it('detects a ticking interval, an alarm and a setPhase that does not reset the timer', () => {
    expect(findIntervals(COPY)).toHaveLength(1);
    const alarm = findAlarm(COPY, { includeAudioType: true }).map((finding) => finding.what);
    expect(alarm).toEqual(
      expect.arrayContaining([
        'references HTMLAudioElement',
        'constructs new Audio()',
        `mentions ${ALARM_ASSET}`,
        'renders an <audio> element'
      ])
    );
    const [setPhase] = setPhaseDefinitions(COPY);
    expect(setPhase).toBeDefined();
    expect(callsNamed(setPhase, 'resetTimer')).toHaveLength(0);
    expect(jsxElementsNamed(COPY, 'audio')).toHaveLength(1);
  });

  it('ignores comments, reads and the typing keepalive', () => {
    const clean = parse(
      'Clean.tsx',
      `
// Old note: the retro used to play /assets/timer-alert.mp3 and set s.settings.timerRunning = false here.
const Clean = ({ s, syncService, myActivityRef }) => {
  const running = s.settings.timerRunning;
  const { timerInitial } = s.settings;
  const keepalive = setInterval(() => { if (myActivityRef.current) syncService.sendActivity(myActivityRef.current); }, 2000);
  return <span>{running ? timerInitial : keepalive}</span>;
};
`
    );
    expect(findTimerWrites(clean)).toEqual([]);
    expect(findIntervals(clean)).toEqual([]);
    expect(findAlarm(clean, { includeAudioType: true })).toEqual([]);
  });

  it('finds the writes in the one module meant to make them', () => {
    // The real writer must register, or the "nobody else writes" check below
    // proves nothing about the real tree.
    const fields = new Set(findTimerWrites(parseFile(SHARED_TIMER_HELPERS)).map((finding) => finding.what));
    for (const field of TIMER_FIELDS) expect(fields).toContain(`assigns ${field}`);
    expect(findAlarm(parseFile(SHARED_TIMER_UI), { includeAudioType: false }).map((f) => f.what)).toEqual(
      expect.arrayContaining(['renders an <audio> element', `mentions ${ALARM_ASSET}`])
    );
  });
});

// --- The guard ------------------------------------------------------------

describe('one timer for retrospectives and health checks', () => {
  const SESSION_FILES = [SESSION_COMPONENT, HEALTH_CHECK_COMPONENT, RETRO_HEADER];

  it.each(SESSION_FILES)('%s keeps no timer logic of its own', (file) => {
    // Guards against a second copy of the countdown: a private interval, a
    // private alarm, or a direct write of a timer field in a session file.
    const sourceFile = parseFile(file);
    expect(
      describeFindings(file, findIntervals(sourceFile)),
      `A session component ticks on its own. ${SHARE_ADVICE}`
    ).toEqual([]);
    expect(
      describeFindings(file, findAlarm(sourceFile, { includeAudioType: true })),
      `A session component plays the alarm itself. ${SHARE_ADVICE}`
    ).toEqual([]);
    expect(
      describeFindings(file, findTimerWrites(sourceFile)),
      `A session component writes the timer fields directly. ${SHARE_ADVICE}`
    ).toEqual([]);
  });

  it.each([RETRO_HEADER, HEALTH_CHECK_COMPONENT])('%s renders the shared <SessionTimer> exactly once', (file) => {
    // Guards both headers rendering the same component: a header that drops
    // it loses the timer, and a header with its own component named
    // SessionTimer would be a copy wearing the shared one's name.
    const sourceFile = parseFile(file);
    expect(
      jsxElementsNamed(sourceFile, 'SessionTimer'),
      `${file} must render <SessionTimer> exactly once. ${SHARE_ADVICE}`
    ).toHaveLength(1);
    expect(
      importSourceOf(sourceFile, 'SessionTimer'),
      `${file} must import SessionTimer from ${SHARED_TIMER_UI}, not define its own. ${SHARE_ADVICE}`
    ).toBe(SHARED_TIMER_UI.replace(/\.tsx$/, ''));
  });

  it.each([
    [SESSION_COMPONENT, 'getRetroPhaseDefaultTimerSeconds'],
    [HEALTH_CHECK_COMPONENT, 'getHealthCheckPhaseDefaultTimerSeconds']
  ])('%s resets the shared timer to its own phase default in setPhase', (file, phaseDefault) => {
    // Guards a phase change stopping the timer at the new phase's timebox in
    // both session types — and the health check reading its own table: three
    // of its phases share an id with a retro phase, so the retro's lookup
    // would silently hand it the retro's timeboxes.
    const sourceFile = parseFile(file);
    const definitions = setPhaseDefinitions(sourceFile);
    expect(definitions, `${file} must define exactly one setPhase`).toHaveLength(1);

    const resets = callsNamed(definitions[0], 'resetTimer');
    expect(
      resets.length,
      `${file}'s setPhase must call resetTimer from ${SHARED_TIMER_HELPERS}. ${SHARE_ADVICE}`
    ).toBeGreaterThan(0);
    expect(importSourceOf(sourceFile, 'resetTimer')).toBe(SHARED_TIMER_HELPERS.replace(/\.ts$/, ''));
    expect(
      resets.some((call) => call.arguments.length > 1 && callsNamed(call.arguments[1], phaseDefault).length > 0),
      `${file}'s setPhase must reset the timer to ${phaseDefault}(phase)`
    ).toBe(true);
  });

  it('only SessionTimer.tsx renders the alarm', () => {
    // Guards against a second alarm anywhere in the UI: one <audio> element,
    // one reference to the chime, in the shared timer component.
    const files = [...sourceFilesUnder('components', ['.ts', '.tsx']), 'App.tsx'];
    expect(files).toContain(SHARED_TIMER_UI);
    expect(files.length).toBeGreaterThan(20);

    const withAlarm = files.filter((file) => findAlarm(parseFile(file), { includeAudioType: false }).length > 0);
    expect(
      withAlarm,
      `Only ${SHARED_TIMER_UI} may render an <audio> element or reference ${ALARM_ASSET}. ${SHARE_ADVICE}`
    ).toEqual([SHARED_TIMER_UI]);
  });

  it('nothing under components/ or services/ writes a timer field', () => {
    // Guards utils/sessionTimer.ts being the only writer: its mutators are
    // what keep a gesture to one write and timerInitial facilitator-only
    // (server/services/sessionGuard.js). dataService only spreads
    // createTimerSettings(...), which names no field.
    const files = [...sourceFilesUnder('components', ['.ts', '.tsx']), ...sourceFilesUnder('services', ['.ts'])];
    expect(files).toContain('services/dataService.ts');
    expect(files).toContain('components/session/useSessionTimer.ts');

    const writes = files.flatMap((file) => describeFindings(file, findTimerWrites(parseFile(file))));
    expect(writes, `Timer fields are written outside ${SHARED_TIMER_HELPERS}. ${SHARE_ADVICE}`).toEqual([]);
  });
});
