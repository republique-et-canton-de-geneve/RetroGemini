import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

/**
 * A person's chosen avatar is **data** any team credential can write: the
 * team's `memberAvatars`, and each session copy's `participants[i].avatar`
 * and `avatarAt`. Which one a screen shows is decided in one place,
 * `components/session/sessionAvatars.ts`, because that place is where an
 * anonymous session shows none: a picture beside a card says who wrote it.
 *
 * So, in `App.tsx` and every `.ts`/`.tsx` file under `components/`, a read of
 * `.avatar`, `.avatarAt` or `.memberAvatars` (a property access, an element
 * access with that literal key, or a destructuring of it) is allowed only
 * inside `components/session/sessionAvatars.ts`, or as an argument (at any
 * depth) of `sessionAvatarOf`, `ownAvatarEntry`, `memberAvatar` or
 * `memberAvatarId`. Writing the field in an object literal is not a read, and
 * a spread copy reads nothing by name. Scanned on the TypeScript AST, as
 * `avatarColorSource.test.ts` does for the colour: a regular expression over
 * JSX miscounts.
 *
 * It passed on the day it was written because nothing read the fields yet; it
 * binds whoever mounts the picker and draws the avatars.
 */

const REPO_ROOT = join(__dirname, '..');
const RESOLVER_FILE = 'components/session/sessionAvatars.ts';
const AVATAR_FIELDS = new Set(['avatar', 'avatarAt', 'memberAvatars']);
const AVATAR_FUNCTIONS = new Set(['sessionAvatarOf', 'ownAvatarEntry', 'memberAvatar', 'memberAvatarId']);

const sourceFilesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(full);
    return /\.tsx?$/.test(entry.name) ? [relative(REPO_ROOT, full)] : [];
  });

const FILES = ['App.tsx', ...sourceFilesUnder(join(REPO_ROOT, 'components'))].sort();

const parse = (file: string, text: string) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

const visitAll = (node: ts.Node, visit: (node: ts.Node) => void) => {
  visit(node);
  node.forEachChild((child) => visitAll(child, visit));
};

/** `sessionAvatarOf(…)` and `avatars.sessionAvatarOf(…)` alike. */
const calleeName = (call: ts.CallExpression): string | null => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
};

/** Is `node` inside the arguments of a call to one of the four functions? */
const insideAvatarCall = (node: ts.Node): boolean => {
  for (let current: ts.Node = node; current.parent; current = current.parent) {
    const parent = current.parent;
    if (ts.isCallExpression(parent) && parent.arguments.includes(current as ts.Expression) && AVATAR_FUNCTIONS.has(calleeName(parent) ?? '')) {
      return true;
    }
  }
  return false;
};

/** The avatar field a node reads, if it reads one. */
const fieldRead = (node: ts.Node): string | null => {
  if (ts.isPropertyAccessExpression(node) && AVATAR_FIELDS.has(node.name.text)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    (ts.isStringLiteral(node.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression)) &&
    AVATAR_FIELDS.has(node.argumentExpression.text)
  ) {
    return node.argumentExpression.text;
  }
  // `const { avatar } = entry` and `({ memberAvatars }) => …`: a read under another name.
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    const key = node.propertyName ?? node.name;
    if ((ts.isIdentifier(key) || ts.isStringLiteral(key)) && AVATAR_FIELDS.has(key.text)) return key.text;
  }
  return null;
};

interface Offence {
  where: string;
  detail: string;
}

const scan = (sources: ReadonlyArray<{ file: string; text: string }>): Offence[] => {
  const offences: Offence[] = [];
  for (const { file, text } of sources) {
    if (file === RESOLVER_FILE) continue;
    const sourceFile = parse(file, text);
    visitAll(sourceFile, (node) => {
      const field = fieldRead(node);
      if (!field || insideAvatarCall(node)) return;
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      offences.push({ where: `${file}:${line}`, detail: node.getText(sourceFile) });
    });
  }
  return offences;
};

describe('a chosen avatar reaches a screen only through sessionAvatars.ts or the readers of utils/avatars.js', () => {
  it('reads no avatar field anywhere else in App.tsx and components/', () => {
    const offences = scan(FILES.map((file) => ({ file, text: readFileSync(join(REPO_ROOT, file), 'utf8') })));
    expect(offences.map((offence) => `${offence.where} ${offence.detail}`)).toEqual([]);
  });

  it('scans the files the avatars will be drawn in (a guard that reads nothing passes everything)', () => {
    for (const file of [
      'App.tsx',
      'components/Session.tsx',
      'components/HealthCheckSession.tsx',
      'components/Dashboard.tsx',
      'components/session/SessionParticipantsPanel.tsx',
      'components/common/Avatar.tsx',
      'components/common/AvatarPicker.tsx',
      RESOLVER_FILE,
    ]) {
      expect(FILES).toContain(file);
    }
  });

  it('keeps the resolver the one place that reads the fields', () => {
    const text = readFileSync(join(REPO_ROOT, RESOLVER_FILE), 'utf8');
    const reads: string[] = [];
    visitAll(parse(RESOLVER_FILE, text), (node) => {
      const field = fieldRead(node);
      if (field) reads.push(field);
    });
    expect(reads).toEqual(expect.arrayContaining(['avatar', 'avatarAt']));
  });
});

describe('what the avatar guard catches, on fixtures', () => {
  const found = (text: string, file = 'components/Fixture.tsx') => scan([{ file, text }]).map((offence) => offence.detail);

  it('reports a raw read in a JSX attribute: a class, a source, a prop', () => {
    expect(found('const A = ({ u }) => <span className={`av-${u.avatar}`} />;')).toEqual(['u.avatar']);
    expect(found('const A = ({ u }) => <img src={`/avatars/${u.avatar}.svg`} alt="" />;')).toEqual(['u.avatar']);
    expect(found('const A = ({ u, c }) => <Avatar colorClasses={c} initials="AB" size={32} avatarId={u.avatar} />;')).toEqual(['u.avatar']);
    expect(found('const A = ({ team, id }) => <Avatar colorClasses={c} initials="AB" size={32} avatarId={team.memberAvatars[id]?.id} />;')).toEqual(['team.memberAvatars']);
  });

  it('reports a raw read in a helper, a local alias, an element access and a destructuring', () => {
    expect(found('export const pictureOf = (user) => user.avatar ?? null;', 'components/session/pictureOf.ts')).toEqual(['user.avatar']);
    expect(found('const A = ({ u }) => { const pic = u.avatar; return <Avatar avatarId={pic} />; };')).toEqual(['u.avatar']);
    expect(found("const at = entry['avatarAt'];")).toEqual(["entry['avatarAt']"]);
    expect(found('const { avatar } = entry;')).toEqual(['avatar']);
    expect(found('const { memberAvatars: map } = team;')).toEqual(['memberAvatars: map']);
    expect(found('const Row = ({ avatar, name }) => <span>{name}{avatar}</span>;')).toEqual(['avatar']);
  });

  it('reports a read in a call to another function, which decides nothing', () => {
    expect(found('const id = toAvatarId(entry.avatar);')).toEqual(['entry.avatar']);
  });

  it('accepts the resolver calls, an entry copy and a written field', () => {
    const text = `
      const shown = sessionAvatarOf(session, team, user.id);
      const own = ownAvatarEntry(session, team, currentUser.id);
      const outside = memberAvatarId(team, member.id);
      const choice = memberAvatar(team, member.id);
      const copied = { ...entry, name: member.name };
      const written = { ...entry, avatar: choice.id, avatarAt: choice.at };
      const Row = ({ u }) => <Avatar colorClasses={avatarColorClasses(u.color)} initials="AB" size={32} avatarId={sessionAvatarOf(session, team, u.id)} />;
    `;
    expect(found(text)).toEqual([]);
  });

  it('lets the resolver file read the fields, and nobody else', () => {
    const text = 'export const raw = (entry) => entry.avatar;';
    expect(found(text, RESOLVER_FILE)).toEqual([]);
    expect(found(text, 'components/session/sessionAvatarsCopy.ts')).toEqual(['entry.avatar']);
  });
});
