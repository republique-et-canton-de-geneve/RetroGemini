import { describe, it, expect } from 'vitest';
import { ownAvatarChoice, ownAvatarEntry, sessionAvatarOf } from '../components/session/sessionAvatars';
import type { Team, User } from '../types';

/**
 * The one rule that decides which avatar a session shows, and what the
 * viewer's own client writes on entering one (PLAN 18.1): the newer `at` wins,
 * values are copied as stored, `toAvatarId` is applied only to draw, and an
 * anonymous session shows no picture at all (it would say who wrote a card).
 */

const person = (id: string, extra: Partial<User> = {}): User => ({ id, name: id.toUpperCase(), color: 'bg-rose-500', role: 'participant', ...extra });

const teamWith = (memberAvatars: unknown): Team =>
  ({ id: 't1', name: 'Team', members: [], memberAvatars } as unknown as Team);

const sessionWith = (participants: User[], isAnonymous = false) => ({ id: 's1', isAnonymous, participants });

const deepCopy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('sessionAvatarOf', () => {
  const team = teamWith({ ada: { id: 'fox', at: 100 }, bob: { id: 'owl', at: 200 } });

  it('draws nothing in an anonymous session, whatever the entry or the team holds', () => {
    const session = sessionWith([person('ada', { avatar: 'cat', avatarAt: 300 }), person('bob')], true);
    expect(sessionAvatarOf(session, team, 'ada')).toBeNull();
    expect(sessionAvatarOf(session, team, 'bob')).toBeNull();
    expect(sessionAvatarOf(session, team, 'nobody')).toBeNull();
  });

  // Both stored session types keep the flag in `settings` (RetroSettings,
  // HealthCheckSettings): a resolver reading only a top-level flag would draw
  // every picture of a real anonymous session.
  it('draws nothing in an anonymous session as the screens store it, under settings', () => {
    const named = [person('ada', { avatar: 'cat', avatarAt: 300 }), person('bob')];
    const retro = { id: 'r1', participants: named, settings: { isAnonymous: true } };
    const healthCheck = { id: 'hc1', templateId: 'x', participants: named, settings: { isAnonymous: true, revealRoti: false } };
    expect(sessionAvatarOf(retro, team, 'ada')).toBeNull();
    expect(sessionAvatarOf(retro, team, 'bob')).toBeNull();
    expect(sessionAvatarOf(healthCheck, team, 'ada')).toBeNull();
    expect(sessionAvatarOf({ ...retro, settings: { isAnonymous: false } }, team, 'ada')).toBe('cat');
    expect(sessionAvatarOf({ ...retro, settings: { isAnonymous: false } }, team, 'bob')).toBe('owl');
  });

  it("takes the entry's avatar when the entry is at least as new as the team's choice", () => {
    expect(sessionAvatarOf(sessionWith([person('ada', { avatar: 'cat', avatarAt: 150 })]), team, 'ada')).toBe('cat');
    // A tie is the same choice, written by the server into both: the entry's.
    expect(sessionAvatarOf(sessionWith([person('ada', { avatar: 'cat', avatarAt: 100 })]), team, 'ada')).toBe('cat');
    // An entry stating an avatar, with no team choice at all, is the only word.
    expect(sessionAvatarOf(sessionWith([person('carol', { avatar: 'cat', avatarAt: 5 })]), team, 'carol')).toBe('cat');
  });

  // The newer `at` wins when drawing too: a pick made on the Dashboard of
  // another tab stamps no session, so a viewer whose team copy holds it must
  // not draw the older picture the entry still states.
  it("takes the team's choice when it is newer than the entry's", () => {
    expect(sessionAvatarOf(sessionWith([person('ada', { avatar: 'cat', avatarAt: 50 })]), team, 'ada')).toBe('fox');
    expect(sessionAvatarOf(sessionWith([person('ada', { avatar: null, avatarAt: 50 })]), team, 'ada')).toBe('fox');
    // An entry with no time (or one that is not a time) counts as 0.
    expect(sessionAvatarOf(sessionWith([person('ada', { avatar: 'cat' })]), team, 'ada')).toBe('fox');
    expect(sessionAvatarOf(sessionWith([person('ada', { avatar: 'cat', avatarAt: 'soon' as unknown as number })]), team, 'ada')).toBe('fox');
  });

  it('draws nothing for an entry that states null and is the newer word', () => {
    const session = sessionWith([person('ada', { avatar: null, avatarAt: 150 })]);
    expect(sessionAvatarOf(session, team, 'ada')).toBeNull();
  });

  it("takes the team's choice when the entry states none, or there is no entry", () => {
    expect(sessionAvatarOf(sessionWith([person('ada')]), team, 'ada')).toBe('fox');
    expect(sessionAvatarOf(sessionWith([]), team, 'bob')).toBe('owl');
    expect(sessionAvatarOf(sessionWith([]), team, 'carol')).toBeNull();
  });

  it('draws nothing for an id this release does not draw, from the entry or the team', () => {
    expect(sessionAvatarOf(sessionWith([person('ada', { avatar: 'unicorn', avatarAt: 150 })]), team, 'ada')).toBeNull();
    expect(sessionAvatarOf(sessionWith([]), teamWith({ ada: { id: 'unicorn', at: 1 } }), 'ada')).toBeNull();
  });

  it('refuses intruder values and a hostile map', () => {
    for (const avatar of ['__proto__', 'constructor', 'fixed inset-0', '<svg>', 'Fox', ' fox']) {
      expect(sessionAvatarOf(sessionWith([person('ada', { avatar, avatarAt: 150 })]), team, 'ada'), avatar).toBeNull();
    }
    const hostile = teamWith(JSON.parse('{"__proto__": {"id": "fox", "at": 1}, "ada": "fox", "bob": {"id": 3, "at": 1}}'));
    expect(sessionAvatarOf(sessionWith([]), hostile, 'ada')).toBeNull();
    // An inherited key never answers: only the map's own entries are choices.
    const inherited = teamWith(Object.create({ carol: { id: 'fox', at: 1 } }));
    expect(sessionAvatarOf(sessionWith([]), inherited, 'carol')).toBeNull();
    expect(sessionAvatarOf(sessionWith([]), hostile, 'bob')).toBeNull();
    expect(sessionAvatarOf(sessionWith([]), hostile, 'toString')).toBeNull();
    expect(sessionAvatarOf(sessionWith([]), teamWith(['fox']), '0')).toBeNull();
  });

  it('survives a session or team that is missing or malformed', () => {
    expect(sessionAvatarOf(null, team, 'ada')).toBe('fox');
    expect(sessionAvatarOf(undefined, null, 'ada')).toBeNull();
    expect(sessionAvatarOf({ isAnonymous: false, participants: 'nope' } as never, team, 'ada')).toBe('fox');
    expect(sessionAvatarOf({ isAnonymous: false, participants: [null, 3] } as never, team, 'ada')).toBe('fox');
  });

  it('is one function for both session types (it reads only isAnonymous and participants)', () => {
    const healthCheck = { id: 'hc1', templateId: 'x', isAnonymous: false, participants: [person('ada', { avatar: 'bee', avatarAt: 150 })] };
    expect(sessionAvatarOf(healthCheck, team, 'ada')).toBe('bee');
    expect(sessionAvatarOf({ ...healthCheck, isAnonymous: true }, team, 'ada')).toBeNull();
  });
});

describe('ownAvatarEntry', () => {
  const team = teamWith({ ada: { id: 'fox', at: 100 } });

  it('returns a copy of the own entry with the newer choice of the map', () => {
    const session = sessionWith([person('ada', { avatar: 'owl', avatarAt: 40 }), person('bob')]);
    const entry = ownAvatarEntry(session, team, 'ada');
    expect(entry).toEqual({ ...session.participants[0], avatar: 'fox', avatarAt: 100 });
    expect(entry).not.toBe(session.participants[0]);
  });

  it('treats an entry that never stated an avatar as older than any choice', () => {
    const session = sessionWith([person('ada')]);
    expect(ownAvatarEntry(session, team, 'ada')).toMatchObject({ id: 'ada', avatar: 'fox', avatarAt: 100 });
  });

  it('writes nothing when the entry is as new as the choice, or newer', () => {
    expect(ownAvatarEntry(sessionWith([person('ada', { avatar: 'fox', avatarAt: 100 })]), team, 'ada')).toBeNull();
    expect(ownAvatarEntry(sessionWith([person('ada', { avatar: 'cat', avatarAt: 150 })]), team, 'ada')).toBeNull();
  });

  it('writes nothing without an own entry, or without a choice', () => {
    expect(ownAvatarEntry(sessionWith([person('bob')]), team, 'ada')).toBeNull();
    expect(ownAvatarEntry(sessionWith([person('ada')]), teamWith({}), 'ada')).toBeNull();
    expect(ownAvatarEntry(sessionWith([person('ada')]), teamWith(undefined), 'ada')).toBeNull();
    expect(ownAvatarEntry(sessionWith([person('ada')]), null, 'ada')).toBeNull();
    expect(ownAvatarEntry(null, team, 'ada')).toBeNull();
  });

  it('carries a clear (null) as a value of its own', () => {
    const cleared = teamWith({ ada: { id: null, at: 300 } });
    expect(ownAvatarEntry(sessionWith([person('ada', { avatar: 'fox', avatarAt: 100 })]), cleared, 'ada'))
      .toMatchObject({ avatar: null, avatarAt: 300 });
  });

  it('copies an id this release does not draw as stored, never erasing it', () => {
    const newer = teamWith({ ada: { id: 'space-whale', at: 500 } });
    expect(ownAvatarEntry(sessionWith([person('ada')]), newer, 'ada')).toMatchObject({ avatar: 'space-whale', avatarAt: 500 });
  });

  it('reads a malformed avatarAt as 0', () => {
    const session = sessionWith([person('ada', { avatar: 'cat', avatarAt: Number.NaN })]);
    expect(ownAvatarEntry(session, team, 'ada')).toMatchObject({ avatar: 'fox', avatarAt: 100 });
    const asText = sessionWith([{ ...person('ada'), avatarAt: '999' } as unknown as User]);
    expect(ownAvatarEntry(asText, team, 'ada')).toMatchObject({ avatar: 'fox', avatarAt: 100 });
  });

  it("never touches another person's entry, nor mutates its inputs", () => {
    const session = sessionWith([person('ada'), person('bob', { avatar: 'owl', avatarAt: 1 })]);
    const map = { ada: { id: 'fox', at: 100 }, bob: { id: 'cat', at: 900 } };
    const before = deepCopy({ session, map });
    expect(ownAvatarEntry(session, teamWith(map), 'ada')?.id).toBe('ada');
    expect(ownAvatarEntry(session, teamWith(map), 'ada')).not.toHaveProperty('name', 'BOB');
    expect({ session, map }).toEqual(before);
  });

  it('writes in an anonymous session too: the choice is kept for when the session names its authors', () => {
    const session = sessionWith([person('ada')], true);
    expect(ownAvatarEntry(session, team, 'ada')).toMatchObject({ avatar: 'fox', avatarAt: 100 });
    expect(sessionAvatarOf({ ...session, participants: [ownAvatarEntry(session, team, 'ada')!] }, team, 'ada')).toBeNull();
  });
});

describe('ownAvatarChoice', () => {
  const team = teamWith({ ada: { id: 'fox', at: 100 } });

  it("marks the team's choice when the entry is not newer", () => {
    expect(ownAvatarChoice(sessionWith([person('ada', { avatar: 'cat', avatarAt: 100 })]), team, 'ada')).toBe('fox');
    expect(ownAvatarChoice(sessionWith([person('ada')]), team, 'ada')).toBe('fox');
    expect(ownAvatarChoice(null, team, 'ada')).toBe('fox');
    expect(ownAvatarChoice(null, teamWith({}), 'ada')).toBeNull();
  });

  it('marks a newer entry, a cleared one included (a pick from another browser reached the session first)', () => {
    expect(ownAvatarChoice(sessionWith([person('ada', { avatar: 'cat', avatarAt: 150 })]), team, 'ada')).toBe('cat');
    expect(ownAvatarChoice(sessionWith([person('ada', { avatar: null, avatarAt: 150 })]), team, 'ada')).toBeNull();
  });

  it("is the viewer's own and stays readable in an anonymous session", () => {
    expect(ownAvatarChoice(sessionWith([person('ada')], true), team, 'ada')).toBe('fox');
  });
});
