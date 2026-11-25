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
  memberAvatarEntries,
  memberAvatarId,
  mergeMemberAvatars,
  rosterIds,
  toAvatarId
} from '../utils/avatars.js';

/**
 * The closed list of avatars a person may choose, and the readers of the
 * team's choices. Every value here comes from data any team credential can
 * write (the route, a session blob, an old pod), so the rule is: compared,
 * never used as a key, a class, a URL part or a message key.
 */

// The shape of a stored avatar id: a contract with every release deployed
// since 45.0, frozen, not a naming style. Every pod and tab from 45.0 on keeps
// an entry of this shape as stored (utils/avatars.js → isMemberAvatarEntry:
// lower-case ASCII words joined by hyphens, at most 64 characters), and drops
// an entry of any other shape when it reads the map, merges two teams, or
// rebuilds the map at the team's next pick. So a later release's new id must
// fit it: widening it here and in the module together would look safe, and
// the pods still running the older release would erase those choices during
// the rollout.
const STORED_ID_SHAPE = /^[a-z]+(-[a-z]+)*$/;
const STORED_ID_MAX_LENGTH = 64;
const expectStoredShape = (id: string) => {
  expect(id).toMatch(STORED_ID_SHAPE);
  expect(id.length, id).toBeLessThanOrEqual(STORED_ID_MAX_LENGTH);
};

describe('the avatar list', () => {
  it('holds six families of twenty, in the order the picker shows them', () => {
    expect(AVATAR_FAMILIES.map((family) => family.id)).toEqual(['animals', 'monsters', 'objects', 'shapes', 'nature', 'games']);
    for (const family of AVATAR_FAMILIES) expect(family.avatars).toHaveLength(20);
    expect(AVATAR_FAMILIES[0].avatars.slice(0, 3)).toEqual(['fox', 'owl', 'cat']);
    expect(AVATAR_FAMILIES[5].avatars.at(-1)).toBe('roller-skate');
  });

  it('lists 120 unique ids of the stored shape, every family in order', () => {
    expect(AVATAR_IDS).toHaveLength(120);
    expect(new Set(AVATAR_IDS).size).toBe(120);
    expect(AVATAR_IDS).toEqual(AVATAR_FAMILIES.flatMap((family) => family.avatars));
    for (const id of AVATAR_IDS) expectStoredShape(id);
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
      expectStoredShape(id);
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

// The one reader of the whole map, and of the roster it is bounded and
// re-keyed by: the avatar route rebuilds the map from these on every pick,
// and the merge of two teams carries what they answer, so neither can keep
// what the other drops.
describe('memberAvatarEntries', () => {
  it('answers copies of the valid entries, in stored order', () => {
    const map = { ada: { id: 'fox', at: 3 }, bob: { id: null, at: 1 }, later: { id: 'space-whale', at: 2, extra: true } };
    const team = { memberAvatars: map };
    const entries = memberAvatarEntries(team);
    // An id this release does not know is kept as stored, an extra field dropped.
    expect(entries).toEqual([['ada', { id: 'fox', at: 3 }], ['bob', { id: null, at: 1 }], ['later', { id: 'space-whale', at: 2 }]]);
    entries[0][1].id = 'owl';
    expect(map.ada).toEqual({ id: 'fox', at: 3 });
  });

  it('leaves out a key that is no member id and an entry that is no stored choice', () => {
    // JSON.parse gives the map an own `__proto__` key, as a stored record can.
    const memberAvatars = JSON.parse('{"__proto__": {"id": "fox", "at": 1}, "ok": {"id": "fox", "at": 5}}');
    Object.assign(memberAvatars, {
      'with space': { id: 'fox', at: 5 },
      [`m${'x'.repeat(64)}`]: { id: 'fox', at: 5 },
      bare: 'fox',
      undated: { id: 'fox' },
      tooLate: { id: 'fox', at: 1e300 },
      shapeless: { id: 'Fox Face', at: 5 }
    });
    expect(Object.prototype.hasOwnProperty.call(memberAvatars, '__proto__')).toBe(true);
    expect(memberAvatarEntries({ memberAvatars })).toEqual([['ok', { id: 'fox', at: 5 }]]);
  });

  it.each([
    ['no team', null],
    ['a team that is not an object', 'team'],
    ['a team with no map', { id: 't1' }],
    ['a map that is an array', { memberAvatars: [{ id: 'fox', at: 1 }] }],
    ['a map that is a string', { memberAvatars: 'fox' }],
    ['a map that is null', { memberAvatars: null }]
  ])('answers no entry for %s', (_label, team) => {
    expect(memberAvatarEntries(team)).toEqual([]);
  });
});

describe('rosterIds', () => {
  it('holds the ids of both roster lists', () => {
    const team = { members: [{ id: 'a' }, { id: 'b' }], archivedMembers: [{ id: 'old' }] };
    expect([...rosterIds(team)]).toEqual(['a', 'b', 'old']);
  });

  it('reads a row only when it is an object with a string id', () => {
    const team = { members: [null, 'a', 7, ['b'], { id: 3 }, { name: 'no id' }, { id: 'c' }], archivedMembers: 'nobody' };
    expect([...rosterIds(team)]).toEqual(['c']);
  });

  it('is empty for no team, or a team with no lists', () => {
    expect(rosterIds(null).size).toBe(0);
    expect(rosterIds('team').size).toBe(0);
    expect(rosterIds({ id: 't1' }).size).toBe(0);
  });
});

// A pick's answer is the map as the route stored it at that pick's write. A
// copy of the team read later (a refresh answered first) can hold a later
// choice of another member: taken whole, the answer put that member back to
// their older choice on that browser until its next refresh.
describe('mergeMemberAvatars', () => {
  const team = (memberAvatars: unknown) => ({ id: 't1', memberAvatars });

  it("keeps each member's newer entry, the answered one on a tie, and a member only one side holds", () => {
    const cached = team({ ada: { id: 'owl', at: 2000 }, bob: { id: 'fox', at: 100 }, cy: { id: 'cat', at: 10 } });
    const answered = { ada: { id: 'cat', at: 500 }, bob: { id: 'bee', at: 900 }, cy: { id: 'moon', at: 10 }, dee: { id: null, at: 40 } };
    expect(mergeMemberAvatars(cached, answered)).toEqual({
      ada: { id: 'owl', at: 2000 },
      bob: { id: 'bee', at: 900 },
      cy: { id: 'moon', at: 10 },
      dee: { id: null, at: 40 }
    });
  });

  // The route dates a pick by its clock alone after the largest date, which
  // has no next one: the answer that carries that pick is the newer word,
  // though its date is the smaller.
  it('ranks the largest date below every other, as the route replaces it', () => {
    expect(mergeMemberAvatars(team({ ada: { id: 'owl', at: Number.MAX_SAFE_INTEGER } }), { ada: { id: 'fox', at: 1234 } }))
      .toEqual({ ada: { id: 'fox', at: 1234 } });
    expect(mergeMemberAvatars(team({ ada: { id: 'fox', at: 1234 } }), { ada: { id: 'owl', at: Number.MAX_SAFE_INTEGER } }))
      .toEqual({ ada: { id: 'fox', at: 1234 } });
  });

  it('leaves out what is no stored choice on either side, and answers a new object', () => {
    const map = { ada: { id: 'fox', at: 1 }, junk: 'fox', 'with space': { id: 'owl', at: 1 } };
    const cached = team(map);
    const merged = mergeMemberAvatars(cached, { bob: { id: 'owl' }, cy: { id: 'cat', at: 1e300 }, dee: { id: 'bee', at: 3 } });
    expect(merged).toEqual({ ada: { id: 'fox', at: 1 }, dee: { id: 'bee', at: 3 } });
    expect(merged).not.toBe(map);
    expect(cached.memberAvatars).toBe(map);
    expect(map).toEqual({ ada: { id: 'fox', at: 1 }, junk: 'fox', 'with space': { id: 'owl', at: 1 } });
  });

  it('reads a missing team or map, or an answer that is no map, as empty', () => {
    expect(mergeMemberAvatars(null, { ada: { id: 'fox', at: 1 } })).toEqual({ ada: { id: 'fox', at: 1 } });
    expect(mergeMemberAvatars(team(undefined), { ada: { id: 'fox', at: 1 } })).toEqual({ ada: { id: 'fox', at: 1 } });
    expect(mergeMemberAvatars(team({ ada: { id: 'fox', at: 1 } }), ['fox'])).toEqual({ ada: { id: 'fox', at: 1 } });
    expect(mergeMemberAvatars(team({ ada: { id: 'fox', at: 1 } }), null)).toEqual({ ada: { id: 'fox', at: 1 } });
  });
});
