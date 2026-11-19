import { describe, it, expect } from 'vitest';
import {
  ACCEPTED_AVATAR_IDS,
  ACCEPTED_ONLY_AVATAR_IDS,
  AVATAR_FAMILIES,
  AVATAR_IDS,
  isAcceptedAvatarId,
  isAvatarId,
  isAvatarTime,
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

// Adding a picture takes two releases: the first only accepts its id (every
// pod of the rollout then stores it), the next offers and draws it. So the
// route reads a list that may be wider than the one the picker shows, never
// narrower: an offered id a pod refuses is a pick that cannot be saved.
describe('the ids the route accepts', () => {
  it('holds every offered id, then the accepted-only ones, each once', () => {
    expect(ACCEPTED_AVATAR_IDS).toEqual([...AVATAR_IDS, ...ACCEPTED_ONLY_AVATAR_IDS]);
    expect(new Set(ACCEPTED_AVATAR_IDS).size).toBe(ACCEPTED_AVATAR_IDS.length);
    for (const id of AVATAR_IDS) expect(isAcceptedAvatarId(id), id).toBe(true);
  });

  it('keeps an accepted-only id out of every family, of the stored shape, and frozen', () => {
    const offered = new Set<string>(AVATAR_IDS);
    for (const id of ACCEPTED_ONLY_AVATAR_IDS) {
      expect(offered.has(id), id).toBe(false);
      expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(isAcceptedAvatarId(id), id).toBe(true);
      // Accepted, never drawn: this release has no picture for it.
      expect(isAvatarId(id), id).toBe(false);
    }
    expect(Object.isFrozen(ACCEPTED_ONLY_AVATAR_IDS)).toBe(true);
    expect(Object.isFrozen(ACCEPTED_AVATAR_IDS)).toBe(true);
  });

  it.each([
    ['null', null],
    ['an empty string', ''],
    ['another case', 'Fox'],
    ['__proto__', '__proto__'],
    ['toString', 'toString'],
    ['a class string', 'fixed inset-0 z-50'],
    ['a number', 7],
    ['a String object', new String('fox')],
    ['an id no release accepts yet', 'dragon']
  ])('refuses %s', (_label, value) => {
    expect(isAcceptedAvatarId(value)).toBe(false);
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
    // No pick could ever be dated after these, so each would outrank every
    // later choice for good: a number too large to add one to is not a date.
    ['a date too large to count exactly', { id: 'fox', at: 1e300 }],
    ['a date one past the largest exact one', { id: 'fox', at: 2 ** 53 }],
    ['a date that is not whole milliseconds', { id: 'fox', at: 1000.5 }],
    ['an id that is not a string', { id: 7, at: 1000 }],
    ['an id of no plausible shape', { id: 'Fox Face', at: 1000 }],
    ['an id far too long', { id: 'a'.repeat(200), at: 1000 }],
    ['an array', ['fox', 1000]]
  ])('answer null for an entry that is %s', (_label, entry) => {
    const t = team({ m1: entry });
    expect(memberAvatar(t, 'm1')).toBeNull();
    expect(memberAvatarId(t, 'm1')).toBeNull();
  });

  it('keep the largest date a number counts exactly: it is still a date', () => {
    const t = team({ m1: { id: 'fox', at: Number.MAX_SAFE_INTEGER } });
    expect(memberAvatar(t, 'm1')).toEqual({ id: 'fox', at: Number.MAX_SAFE_INTEGER });
  });

  it.each([
    [0, true], [1, true], [1_795_000_000_000, true], [Number.MAX_SAFE_INTEGER, true],
    [-1, false], [0.5, false], [2 ** 53, false], [1e300, false],
    [Number.POSITIVE_INFINITY, false], [Number.NaN, false],
    ['1000', false], [null, false], [undefined, false], [{}, false]
  ])('isAvatarTime(%s) is %s', (value, expected) => {
    expect(isAvatarTime(value)).toBe(expected);
  });

  it('answer null for a member id that is not a string', () => {
    const t = team({ 7: { id: 'fox', at: 1 } });
    expect(memberAvatar(t, 7 as unknown as string)).toBeNull();
  });
});
