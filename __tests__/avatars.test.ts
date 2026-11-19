import { describe, it, expect } from 'vitest';
import {
  AVATAR_FAMILIES,
  AVATAR_IDS,
  isAvatarId,
  memberAvatar,
  memberAvatarId,
  toAvatarId
} from '../utils/avatars.js';

/**
 * The closed list of avatars a person may choose, and the readers of the
 * team's choices. Every value here comes from data any team credential can
 * write (the route, a session blob, an old pod), so the rule is: compared,
 * never used as a key, a class, a URL part or a message key.
 */

describe('the avatar list', () => {
  it('holds six families of twenty, in the order the picker shows them', () => {
    expect(AVATAR_FAMILIES.map((family) => family.id)).toEqual(['animals', 'monsters', 'objects', 'shapes', 'nature', 'games']);
    for (const family of AVATAR_FAMILIES) expect(family.avatars).toHaveLength(20);
    expect(AVATAR_FAMILIES[0].avatars.slice(0, 3)).toEqual(['fox', 'owl', 'cat']);
    expect(AVATAR_FAMILIES[5].avatars.at(-1)).toBe('roller-skate');
  });

  it('lists 120 unique ids of one lower-case ASCII shape, every family in order', () => {
    expect(AVATAR_IDS).toHaveLength(120);
    expect(new Set(AVATAR_IDS).size).toBe(120);
    expect(AVATAR_IDS).toEqual(AVATAR_FAMILIES.flatMap((family) => family.avatars));
    for (const id of AVATAR_IDS) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(AVATAR_IDS)).toBe(true);
    expect(Object.isFrozen(AVATAR_FAMILIES)).toBe(true);
    for (const family of AVATAR_FAMILIES) {
      expect(Object.isFrozen(family)).toBe(true);
      expect(Object.isFrozen(family.avatars)).toBe(true);
    }
    expect(() => (AVATAR_IDS as string[]).push('intruder')).toThrow();
  });
});

describe('isAvatarId and toAvatarId', () => {
  it('accept every id of the list', () => {
    for (const id of AVATAR_IDS) {
      expect(isAvatarId(id)).toBe(true);
      expect(toAvatarId(id)).toBe(id);
    }
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['another case', 'Fox'],
    ['surrounding spaces', ' fox '],
    ['__proto__', '__proto__'],
    ['constructor', 'constructor'],
    ['toString', 'toString'],
    ['hasOwnProperty', 'hasOwnProperty'],
    ['a class string', 'fixed inset-0 z-50'],
    ['markup', '<img src=x onerror=alert(1)>'],
    ['a path', '../fox'],
    ['a URL', 'https://example.com/fox.svg'],
    ['a number', 7],
    ['an object', { id: 'fox' }],
    ['an array', ['fox']],
    ['a String object', new String('fox')],
    ['a very long string', 'fox'.repeat(10_000)],
    ['an id a later release may add', 'dragon']
  ])('refuse %s', (_label, value) => {
    expect(isAvatarId(value)).toBe(false);
    expect(toAvatarId(value)).toBeNull();
  });
});

describe('memberAvatar and memberAvatarId', () => {
  const team = (memberAvatars: unknown) => ({ id: 't1', memberAvatars });

  it('answer the stored entry, and its id when the list has it', () => {
    const t = team({ m1: { id: 'fox', at: 1000 } });
    expect(memberAvatar(t, 'm1')).toEqual({ id: 'fox', at: 1000 });
    expect(memberAvatarId(t, 'm1')).toBe('fox');
  });

  it('answer a cleared choice as an entry with no id: its date still says it is the newest', () => {
    const t = team({ m1: { id: null, at: 2000 } });
    expect(memberAvatar(t, 'm1')).toEqual({ id: null, at: 2000 });
    expect(memberAvatarId(t, 'm1')).toBeNull();
  });

  it('keep an id this release does not know as stored, but never draw it', () => {
    // A later release may add avatars: an older tab must not erase them.
    const t = team({ m1: { id: 'dragon', at: 3000 } });
    expect(memberAvatar(t, 'm1')).toEqual({ id: 'dragon', at: 3000 });
    expect(memberAvatarId(t, 'm1')).toBeNull();
  });

  it('answer a copy, so a caller cannot edit the cached team through it', () => {
    const t = team({ m1: { id: 'fox', at: 1000 } });
    const entry = memberAvatar(t, 'm1') as { id: string; at: number };
    entry.id = 'owl';
    expect(memberAvatarId(t, 'm1')).toBe('fox');
  });

  it('read own properties only', () => {
    const inherited = Object.create({ m1: { id: 'fox', at: 1 } });
    expect(memberAvatar(team(inherited), 'm1')).toBeNull();
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(memberAvatar(team({}), key)).toBeNull();
      expect(memberAvatarId(team({}), key)).toBeNull();
    }
  });

  it.each([
    ['no team', null],
    ['a team that is not an object', 'team'],
    ['a team with no map', { id: 't1' }],
    ['a map that is an array', team([{ id: 'fox', at: 1 }])],
    ['a map that is a string', team('fox')],
    ['a map that is null', team(null)]
  ])('answer null for %s', (_label, t) => {
    expect(memberAvatar(t, 'm1')).toBeNull();
    expect(memberAvatarId(t, 'm1')).toBeNull();
  });

  it.each([
    ['a bare id (no date)', 'fox'],
    ['null', null],
    ['an entry with no date', { id: 'fox' }],
    ['a date that is not a number', { id: 'fox', at: '1000' }],
    ['a date that is not finite', { id: 'fox', at: Number.POSITIVE_INFINITY }],
    ['a negative date', { id: 'fox', at: -1 }],
    ['an id that is not a string', { id: 7, at: 1000 }],
    ['an id of no plausible shape', { id: 'Fox Face', at: 1000 }],
    ['an id far too long', { id: 'a'.repeat(200), at: 1000 }],
    ['an array', ['fox', 1000]]
  ])('answer null for an entry that is %s', (_label, entry) => {
    const t = team({ m1: entry });
    expect(memberAvatar(t, 'm1')).toBeNull();
    expect(memberAvatarId(t, 'm1')).toBeNull();
  });

  it('answer null for a member id that is not a string', () => {
    const t = team({ 7: { id: 'fox', at: 1 } });
    expect(memberAvatar(t, 7 as unknown as string)).toBeNull();
  });
});
