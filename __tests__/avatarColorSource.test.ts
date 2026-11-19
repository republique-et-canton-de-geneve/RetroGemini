import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';
import { COLOR_TOKEN_PATTERN } from './helpers/tailwindTheme';

/**
 * A participant's colour is **data** — a Tailwind class stored on
 * `User.color`, written by the team record and by every participant's own
 * client into the session blob. As a class, it reaches the screen through one
 * module, `utils/participantColors.ts`, and this guard keeps the components'
 * reads of it there.
 *
 * Two things went wrong when it was interpolated raw. The initials were always
 * `text-white`, which fails WCAG 1.4.3 on seven of the eight palette colours;
 * and any string a participant wrote into their own `color` landed in
 * everyone's `className` (`fixed inset-0 z-50` is a full-screen overlay).
 * `avatarColorClasses` hands out a tone whose initials are measured and turns
 * an unknown value neutral; `participantColorClass` is its background-only
 * twin for the non-text dots; `participantToneHex` gives the same tone as hex,
 * for a surface painted with a `style`.
 *
 * Five rules, checked on the TypeScript AST (a regex over JSX miscounts, see
 * `iconButtonNames.test.tsx`) of `App.tsx` and every `.ts`/`.tsx` file under
 * `components/`:
 *  1. In any JSX attribute but `style` and `key`, a `.color` property is read
 *     only inside a call to one of the three functions. Every attribute, not just
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
 *  4. Outside JSX attributes, a `.color` read is one of four shapes: inside a
 *     call to one of the three functions; a roster copy (`color: member.color`,
 *     with an optional `||`/`??` fallback); a key into a colour map; or an
 *     exemption below. Building the class in a local variable and interpolating
 *     the variable reads `.color` outside any attribute, which rule 1 alone
 *     never saw.
 *  5. Since 45.0 every person is drawn by `<Avatar>`, which takes the classes
 *     as `colorClasses`. That prop is the module's word and nothing else: a
 *     call to `avatarColorClasses`, one of its two constants, or a choice
 *     between those. A string or a template there would be rule 2's override
 *     under another name, and `Avatar` itself declares no `className`.
 *
 * The colour-by-author card reads its author's tone through
 * `participantToneHex` (rule 1 and 4), and `utils/cardTones.ts` turns it into
 * the card's tint and inks, painted as a hex `style`; an unknown colour gives
 * the neutral tone. (`Session.tsx`'s `TAILWIND_COLOR_MAP`, the map key rule 4
 * still allows, went with 45.0's card colours.) Deliberately outside what this
 * guards: two spellings no AST rule here follows, destructuring
 * (`const { color } = user`) and an element access (`user['color']`).
 */

const REPO_ROOT = join(__dirname, '..');
const COLOR_FUNCTIONS = new Set(['avatarColorClasses', 'participantColorClass', 'participantToneHex']);
/** What an `<Avatar>`'s `colorClasses` may be, beside a call to `avatarColorClasses`. */
const AVATAR_CLASS_CONSTANTS = new Set(['DEPARTED_AVATAR_CLASSES', 'NEUTRAL_AVATAR_CLASSES']);

/** `.color` reads that are not a person's colour, each with its reason. */
const EXEMPTIONS: ReadonlyArray<{ file: string; expression: string; reason: string }> = [
  {
    file: 'components/AnnouncementModal.tsx',
    expression: 'config.color',
    reason: "an announcement type's own text colour, a constant of that component, not a participant's",
  },
];

const sourceFilesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(full);
    return /\.tsx?$/.test(entry.name) ? [relative(REPO_ROOT, full)] : [];
  });

const FILES = ['App.tsx', ...sourceFilesUnder(join(REPO_ROOT, 'components'))].sort();

const parse = (file: string, text: string) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

const readSources = (files: readonly string[]) =>
  files.map((file) => ({ file, text: readFileSync(join(REPO_ROOT, file), 'utf8') }));

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

/** The JSX attribute `node` sits in, if any. */
const enclosingJsxAttribute = (node: ts.Node): ts.JsxAttribute | null => {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxAttribute(current)) return current;
  }
  return null;
};

const propertyNamed = (node: ts.Node, name: string) =>
  ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === name;

/**
 * `{ …, color: member.color }`, or with a fallback after `||` / `??`: the
 * colour copied into another participant record (the session's roster), which
 * reaches the screen later through the same functions.
 */
const isRosterCopy = (read: ts.Node): boolean => {
  let value: ts.Node = read;
  const parent = read.parent;
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === read &&
    (parent.operatorToken.kind === ts.SyntaxKind.BarBarToken || parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    value = parent;
  }
  const holder = value.parent;
  return propertyNamed(holder, 'color') && (holder as ts.PropertyAssignment).initializer === value;
};

/**
 * `MAP[author.color]`: the colour used as a key, so what reaches the screen is
 * one of the map's own values and never the stored string (an unknown key
 * gives `undefined`).
 */
const isColorMapKey = (read: ts.Node): boolean =>
  ts.isElementAccessExpression(read.parent) && read.parent.argumentExpression === read;

const isTextColor = (token: string) => COLOR_TOKEN_PATTERN.exec(token)?.[1] === 'text';
const isFading = (token: string) => token === 'grayscale' || /^opacity-\d+$/.test(token);

/** Is `node` the module's word for an avatar: its function, one of its constants, or a choice between those? */
const isAvatarClassesExpression = (node: ts.Expression): boolean => {
  if (ts.isParenthesizedExpression(node)) return isAvatarClassesExpression(node.expression);
  if (ts.isConditionalExpression(node)) return isAvatarClassesExpression(node.whenTrue) && isAvatarClassesExpression(node.whenFalse);
  if (ts.isCallExpression(node)) return calleeName(node) === 'avatarColorClasses';
  return ts.isIdentifier(node) && AVATAR_CLASS_CONSTANTS.has(node.text);
};

const jsxTagOf = (attribute: ts.JsxAttribute) => attribute.parent.parent.tagName.getText();

interface Offence {
  where: string;
  rule: 'raw-color' | 'avatar-override' | 'dot-text-color' | 'avatar-classes';
  detail: string;
}

const scan = (sources: ReadonlyArray<{ file: string; text: string }>) => {
  const offences: Offence[] = [];
  const exemptionsUsed = new Set<string>();
  for (const { file, text } of sources) {
    const sourceFile = parse(file, text);
    const exempt = (read: ts.PropertyAccessExpression) => {
      const expression = read.getText(sourceFile).replace(/\?\./g, '.');
      const exemption = EXEMPTIONS.find((entry) => entry.file === file && entry.expression === expression);
      if (exemption) exemptionsUsed.add(`${exemption.file} ${exemption.expression}`);
      return !!exemption;
    };

    // Rules 1 to 3: inside a JSX attribute.
    visitAll(sourceFile, (node) => {
      if (!ts.isJsxAttribute(node) || !node.initializer) return;
      const attribute = node.name.getText();
      if (attribute === 'style' || attribute === 'key') return;
      const initializer = node.initializer;

      visitAll(initializer, (inner) => {
        if (!ts.isPropertyAccessExpression(inner) || inner.name.text !== 'color') return;
        if (exempt(inner)) return;
        if (!insideColorCall(inner, node)) {
          offences.push({ where: `${file}:${lineOf(sourceFile, inner)}`, rule: 'raw-color', detail: `${attribute}={… ${inner.getText(sourceFile)} …}` });
        }
      });

      if (jsxTagOf(node) === 'Avatar' && (attribute === 'colorClasses' || attribute === 'className')) {
        const expression = ts.isJsxExpression(initializer) ? initializer.expression : undefined;
        if (attribute === 'className' || !expression || !isAvatarClassesExpression(expression)) {
          offences.push({ where: `${file}:${lineOf(sourceFile, node)}`, rule: 'avatar-classes', detail: node.getText(sourceFile) });
        }
      }

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

    // Rule 4: everywhere else. A class built in a variable and interpolated
    // later reads `.color` outside any attribute, which rule 1 never sees.
    visitAll(sourceFile, (node) => {
      if (!ts.isPropertyAccessExpression(node) || node.name.text !== 'color') return;
      // Inside an attribute, rule 1 has decided (and `style` and `key` paint no class).
      if (enclosingJsxAttribute(node)) return;
      if (exempt(node) || insideColorCall(node, sourceFile) || isRosterCopy(node) || isColorMapKey(node)) return;
      offences.push({ where: `${file}:${lineOf(sourceFile, node)}`, rule: 'raw-color', detail: `${node.getText(sourceFile)} outside a colour function` });
    });
  }
  return { offences, exemptionsUsed };
};

describe('a participant colour reaches a class only through utils/participantColors.ts', () => {
  const { offences, exemptionsUsed } = scan(readSources(FILES));
  const report = (rule: Offence['rule']) =>
    offences.filter((offence) => offence.rule === rule).map((offence) => `${offence.where} ${offence.detail}`);

  it('reads `.color` only through the three colour functions (or a style, a roster copy, a colour-map key)', () => {
    expect(report('raw-color')).toEqual([]);
  });

  it("gives an <Avatar> the module's classes and nothing beside them", () => {
    expect(report('avatar-classes')).toEqual([]);
  });

  // The other half of that rule: with no `className` on the component, nothing
  // can be added to a disc from outside.
  it('keeps <Avatar> without a className prop', () => {
    const source = readFileSync(join(REPO_ROOT, 'components/common/Avatar.tsx'), 'utf8');
    const props = /interface AvatarProps \{([^}]*)\}/.exec(source)?.[1] ?? '';
    expect(props).toContain('colorClasses');
    expect(props).not.toMatch(/\bclassName\b/);
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
    for (const file of [
      'App.tsx',
      'components/Dashboard.tsx',
      'components/session/SessionParticipantsPanel.tsx',
      'components/TeamLogin.tsx',
      // A helper module beside the components, not only the components.
      'components/session/sessionRoster.ts',
    ]) {
      expect(FILES).toContain(file);
    }
  });
});

describe('what the guard catches, on fixtures', () => {
  const rulesIn = (text: string, file = 'components/Fixture.tsx') =>
    scan([{ file, text }]).offences.map((offence) => offence.rule);

  // Build the class in a variable, then interpolate the variable: no `.color`
  // is read inside an attribute, so a guard that looks only at attributes
  // never sees it — and the white initials and the injected classes are back.
  it('reports a raw colour built into a local template, then used as a class', () => {
    const text = `
      const Header = ({ currentUser }) => {
        const avatarClass = \`\${currentUser.color} text-white\`;
        return <div className={\`w-8 h-8 \${avatarClass}\`}>AB</div>;
      };`;
    expect(rulesIn(text)).toEqual(['raw-color']);
  });

  it('reports a raw colour copied into a local alias', () => {
    const text = `
      const Header = ({ currentUser }) => {
        const c = currentUser.color;
        return <div className={\`\${c} text-white\`}>AB</div>;
      };`;
    expect(rulesIn(text)).toEqual(['raw-color']);
  });

  it('reports a raw colour in a helper module beside the components', () => {
    const text = `export const avatarClass = (user) => user.color + ' text-white';`;
    expect(rulesIn(text, 'components/session/avatarClass.ts')).toEqual(['raw-color']);
  });

  it('reports a raw colour in any attribute, a prop included', () => {
    expect(rulesIn('const A = ({ u }) => <div className={`${u.color} text-white`}>AB</div>;')).toEqual(['raw-color']);
    expect(rulesIn('const A = ({ u }) => <Dots colorClass={u.color} />;')).toEqual(['raw-color']);
  });

  it("reports an <Avatar> whose classes are not the module's word", () => {
    expect(rulesIn('const A = ({ u }) => <Avatar colorClasses="bg-slate-600 text-white" initials="AB" size={32} />;')).toEqual(['avatar-classes']);
    expect(rulesIn('const A = ({ u }) => <Avatar colorClasses={`${avatarColorClasses(u.color)} opacity-50`} initials="AB" size={32} />;')).toEqual(['avatar-classes']);
    expect(rulesIn('const A = ({ u, c }) => <Avatar colorClasses={c} initials="AB" size={32} />;')).toEqual(['avatar-classes']);
    expect(rulesIn('const A = ({ u }) => <Avatar colorClasses={avatarColorClasses(u.color)} className="opacity-50" initials="AB" size={32} />;')).toEqual(['avatar-classes']);
  });

  it("accepts an <Avatar> in the person's tone, the neutral one, or a choice between them", () => {
    const text = `
      const Row = ({ u, hasLeft }) => (
        <>
          <Avatar colorClasses={avatarColorClasses(u.color)} initials="AB" size={32} />
          <Avatar colorClasses={hasLeft ? DEPARTED_AVATAR_CLASSES : avatarColorClasses(u?.color)} initials="AB" size={32} />
          <Avatar colorClasses={(NEUTRAL_AVATAR_CLASSES)} initials="AB" size={32} />
        </>
      );`;
    expect(rulesIn(text)).toEqual([]);
  });

  it('accepts a tone taken as hex for a style', () => {
    expect(rulesIn('const tone = participantToneHex(author.color);')).toEqual([]);
  });

  // Every shape below exists in the components today. Each must stay legal,
  // or the guard would be switched off rather than kept.
  it('accepts the colour functions, a style or key, a roster copy and a colour-map lookup', () => {
    const text = `
      const measured = avatarColorClasses(currentUser.color);
      const merged = { ...p, name: member.name, email: member.email, color: member.color };
      const seeded = { id, color: member?.color || PARTICIPANT_COLOR_POOL[0] };
      const kept = { id, color: member.color ?? PARTICIPANT_COLOR_POOL[0] };
      const cardBgHex = TAILWIND_COLOR_MAP[author.color] || null;
      const Row = ({ layer, u }) => (
        <div key={layer.color} style={{ backgroundColor: layer.color }} className={avatarColorClasses(u.color)}>
          <Dots colorClass={participantColorClass(u.color)} />
        </div>
      );`;
    expect(rulesIn(text)).toEqual([]);
  });
});
