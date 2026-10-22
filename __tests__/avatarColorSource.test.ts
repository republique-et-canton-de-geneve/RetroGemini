import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';
import { COLOR_TOKEN_PATTERN } from './helpers/tailwindTheme';

/**
 * A participant's colour is **data** — a Tailwind class stored on
 * `User.color`, written by the team record and by every participant's own
 * client into the session blob — and it reaches the screen through one module,
 * `utils/participantColors.ts`. This guard is what keeps it there.
 *
 * Two things went wrong when it was interpolated raw. The initials were always
 * `text-white`, which fails WCAG 1.4.3 on seven of the eight palette colours;
 * and any string a participant wrote into their own `color` landed in
 * everyone's `className` (`fixed inset-0 z-50` is a full-screen overlay).
 * `avatarColorClasses` picks the initials' colour by measured contrast and
 * turns an unknown value neutral; `participantColorClass` is its background-only
 * twin for the non-text dots.
 *
 * Three rules, checked on the TypeScript AST (a regex over JSX miscounts, see
 * `iconButtonNames.test.tsx`):
 *  1. In any JSX attribute but `style` and `key`, a `.color` property is read
 *     only inside a call to one of the two functions. Every attribute, not just
 *     `className`: the contribution dots take theirs through a `colorClass`
 *     prop, which a `className`-only guard never saw.
 *  2. A `className` that calls `avatarColorClasses` adds no text colour, no
 *     opacity and no `grayscale` of its own. Which text colour wins between
 *     two is decided by stylesheet order, not class order, so a second one
 *     silently overrides the measured choice; and a faded avatar is exactly
 *     what cannot be measured.
 *  3. A `className` that calls `participantColorClass` carries no text colour
 *     at all — that function is for dots, and `text-white` beside it would
 *     bring the defect straight back.
 */

const REPO_ROOT = join(__dirname, '..');
const COLOR_FUNCTIONS = new Set(['avatarColorClasses', 'participantColorClass']);

/** `.color` reads that are not a person's colour, each with its reason. */
const EXEMPTIONS: ReadonlyArray<{ file: string; expression: string; reason: string }> = [
  {
    file: 'components/AnnouncementModal.tsx',
    expression: 'config.color',
    reason: "an announcement type's own text colour, a constant of that component, not a participant's",
  },
];

const tsxFilesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFilesUnder(full);
    return entry.name.endsWith('.tsx') ? [relative(REPO_ROOT, full)] : [];
  });

const FILES = ['App.tsx', ...tsxFilesUnder(join(REPO_ROOT, 'components'))].sort();

const sourceOf = (file: string) =>
  ts.createSourceFile(file, readFileSync(join(REPO_ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const lineOf = (sourceFile: ts.SourceFile, node: ts.Node) =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

const visitAll = (node: ts.Node, visit: (node: ts.Node) => void) => {
  visit(node);
  node.forEachChild((child) => visitAll(child, visit));
};

const calleeName = (call: ts.CallExpression) => (ts.isIdentifier(call.expression) ? call.expression.text : null);

/** Is `node` an argument (at any depth) of a call to one of the colour functions, below `stop`? */
const insideColorCall = (node: ts.Node, stop: ts.Node): boolean => {
  for (let current = node.parent; current && current !== stop; current = current.parent) {
    if (ts.isCallExpression(current) && COLOR_FUNCTIONS.has(calleeName(current) ?? '')) return true;
  }
  return false;
};

/** Every class token written literally in an attribute's value. */
const literalTokens = (initializer: ts.Node): string[] => {
  const texts: string[] = [];
  visitAll(initializer, (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) texts.push(node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) texts.push(node.text);
  });
  return texts.join(' ').split(/\s+/).filter(Boolean);
};

const callsIn = (initializer: ts.Node): Set<string> => {
  const names = new Set<string>();
  visitAll(initializer, (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name && COLOR_FUNCTIONS.has(name)) names.add(name);
    }
  });
  return names;
};

const isTextColor = (token: string) => COLOR_TOKEN_PATTERN.exec(token)?.[1] === 'text';
const isFading = (token: string) => token === 'grayscale' || /^opacity-\d+$/.test(token);

interface Offence {
  where: string;
  rule: 'raw-color' | 'avatar-override' | 'dot-text-color';
  detail: string;
}

const scan = () => {
  const offences: Offence[] = [];
  const exemptionsUsed = new Set<string>();
  for (const file of FILES) {
    const sourceFile = sourceOf(file);
    visitAll(sourceFile, (node) => {
      if (!ts.isJsxAttribute(node) || !node.initializer) return;
      const attribute = node.name.getText();
      if (attribute === 'style' || attribute === 'key') return;
      const initializer = node.initializer;

      visitAll(initializer, (inner) => {
        if (!ts.isPropertyAccessExpression(inner) || inner.name.text !== 'color') return;
        const expression = inner.getText(sourceFile).replace(/\?\./g, '.');
        const exemption = EXEMPTIONS.find((entry) => entry.file === file && entry.expression === expression);
        if (exemption) {
          exemptionsUsed.add(`${exemption.file} ${exemption.expression}`);
          return;
        }
        if (!insideColorCall(inner, node)) {
          offences.push({ where: `${file}:${lineOf(sourceFile, inner)}`, rule: 'raw-color', detail: `${attribute}={… ${inner.getText(sourceFile)} …}` });
        }
      });

      if (attribute !== 'className') return;
      const calls = callsIn(initializer);
      const tokens = literalTokens(initializer);
      if (calls.has('avatarColorClasses')) {
        const extra = tokens.filter((token) => isTextColor(token) || isFading(token));
        if (extra.length) offences.push({ where: `${file}:${lineOf(sourceFile, node)}`, rule: 'avatar-override', detail: extra.join(' ') });
      }
      if (calls.has('participantColorClass')) {
        const extra = tokens.filter(isTextColor);
        if (extra.length) offences.push({ where: `${file}:${lineOf(sourceFile, node)}`, rule: 'dot-text-color', detail: extra.join(' ') });
      }
    });
  }
  return { offences, exemptionsUsed };
};

describe('a participant colour reaches the screen through utils/participantColors.ts', () => {
  const { offences, exemptionsUsed } = scan();
  const report = (rule: Offence['rule']) =>
    offences.filter((offence) => offence.rule === rule).map((offence) => `${offence.where} ${offence.detail}`);

  it('reads `.color` in a JSX attribute only through avatarColorClasses or participantColorClass', () => {
    expect(report('raw-color')).toEqual([]);
  });

  it('adds no text colour, opacity or grayscale beside avatarColorClasses', () => {
    expect(report('avatar-override')).toEqual([]);
  });

  it('adds no text colour beside participantColorClass (it is for dots)', () => {
    expect(report('dot-text-color')).toEqual([]);
  });

  it('keeps every exemption live, so a stale one cannot hide a new read', () => {
    expect([...exemptionsUsed].sort()).toEqual(EXEMPTIONS.map((entry) => `${entry.file} ${entry.expression}`).sort());
  });

  it('scans the files the avatars live in (a guard that reads nothing passes everything)', () => {
    for (const file of ['App.tsx', 'components/Dashboard.tsx', 'components/session/SessionParticipantsPanel.tsx', 'components/TeamLogin.tsx']) {
      expect(FILES).toContain(file);
    }
  });
});
