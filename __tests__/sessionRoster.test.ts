import { describe, expect, it } from 'vitest';
import { memberJoinedChange, mergeRosterIntoParticipants, PARTICIPANT_COLOR_POOL, sessionParticipants } from '../components/session/sessionRoster';
import type { User } from '../types';

/**
 * Incident ISS (2026-10-12). Both session screens wrote the whole session on
 * every `member-roster` event, even when the roster named exactly the people
 * already on it, and the retro's version did so by renaming the current state's
 * participant objects in place. A reconnect wave is one roster per socket, so a
 * room of twenty sent twenty writes of nothing — each one a revision bump, a
 * database write and a broadcast, and each one a race the participants' real
 * writes then had to win.
 *
 * The merge now answers `null` for a roster that changes nothing, and never
 * touches what it was given.
 */

const alice: User = { id: 'u-alice', name: 'Alice', color: 'bg-rose-500', role: 'participant' };
const bob: User = { id: 'u-bob', name: 'Bob', color: 'bg-cyan-500', role: 'facilitator' };

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

describe('mergeRosterIntoParticipants', () => {
  it('answers null when the roster names exactly the participants already listed', () => {
    const participants = deepFreeze([alice, bob]);

    expect(mergeRosterIntoParticipants(participants, [
      { id: 'u-alice', name: 'Alice' },
      { id: 'u-bob', name: 'Bob' },
    ], [])).toBeNull();
  });

  it('answers null for a roster listing the same socket twice (two tabs of one person)', () => {
    expect(mergeRosterIntoParticipants([alice], [
      { id: 'u-alice', name: 'Alice' },
      { id: 'u-alice', name: 'Alice' },
    ], [])).toBeNull();
  });

  it('answers null for an empty roster: it never removes anyone', () => {
    expect(mergeRosterIntoParticipants([alice, bob], [], [])).toBeNull();
  });

  // Codex review on PR #507: the retro used to match names exactly, and the
  // shared rule matches them case-insensitively. Two team members whose names
  // only differ in case are still two people: the name fallback is for one
  // person who came back under a new id, never for merging two known members.
  it('keeps two team members whose names only differ in case apart', () => {
    const alexUpper: User = { id: 'u-alex-1', name: 'Alex', color: 'bg-rose-500', role: 'participant' };
    const alexLower: User = { id: 'u-alex-2', name: 'alex', color: 'bg-cyan-500', role: 'participant' };
    const participants = deepFreeze([alexUpper]);

    const merged = mergeRosterIntoParticipants(participants, [
      { id: 'u-alex-1', name: 'Alex' },
      { id: 'u-alex-2', name: 'alex' },
    ], [alexUpper, alexLower]);

    expect(merged).toEqual([alexUpper, alexLower]);
  });

  it('still lets one person who rejoined under a new id take over their own row', () => {
    const merged = mergeRosterIntoParticipants([alice], [
      { id: 'u-alice-new-device', name: 'alice' },
    ], [alice]);

    expect(merged).toEqual([{ ...alice, id: 'u-alice-new-device', name: 'alice' }]);
  });

  // An avatar is a member's choice, kept under their id in the team's map.
  // The row someone takes over under a new id is matched by name, and may be
  // another person's of the same name: its picture does not pass with it.
  it('leaves the avatar behind when a row passes to a new id', () => {
    const chosen = deepFreeze([{ ...alice, avatar: 'fox', avatarAt: 100 }]);

    const merged = mergeRosterIntoParticipants(chosen, [{ id: 'u-alice-new-device', name: 'alice' }], [alice]);

    expect(merged).toEqual([{ ...alice, id: 'u-alice-new-device', name: 'alice' }]);
    expect(merged?.[0]).not.toHaveProperty('avatar');
    expect(merged?.[0]).not.toHaveProperty('avatarAt');
  });

  it("keeps the avatar of a row that only takes the roster's spelling of its name", () => {
    const chosen = deepFreeze([{ ...alice, name: 'alice ', avatar: 'fox', avatarAt: 100 }]);

    const merged = mergeRosterIntoParticipants(chosen, [{ id: alice.id, name: 'Alice' }], [alice]);

    expect(merged).toEqual([{ ...alice, name: 'Alice', avatar: 'fox', avatarAt: 100 }]);
  });

  it('adds a newcomer, with the colour and role the team record gives them', () => {
    const carol: User = { id: 'u-carol', name: 'Carol', color: 'bg-lime-500', role: 'facilitator' };

    const merged = mergeRosterIntoParticipants([alice], [
      { id: 'u-alice', name: 'Alice' },
      { id: 'u-carol', name: 'Carol' },
    ], [carol]);

    expect(merged).toEqual([alice, { id: 'u-carol', name: 'Carol', color: 'bg-lime-500', role: 'facilitator' }]);
  });

  it('gives a newcomer the team does not know a pool colour and the participant role', () => {
    const merged = mergeRosterIntoParticipants([alice], [{ id: 'guest', name: 'Guest' }], []);

    expect(merged?.[1]).toEqual({
      id: 'guest',
      name: 'Guest',
      color: PARTICIPANT_COLOR_POOL[1 % PARTICIPANT_COLOR_POOL.length],
      role: 'participant',
    });
  });

  it('matches a known participant by name regardless of case and spacing, and adopts the roster identity', () => {
    const participants = deepFreeze([{ ...alice, id: 'old-id', name: 'alice ' }]);

    const merged = mergeRosterIntoParticipants(participants, [{ id: 'u-alice', name: 'Alice' }], []);

    expect(merged).toEqual([{ ...alice, id: 'u-alice', name: 'Alice' }]);
  });

  it('never mutates the participants it was given (they belong to the rendered state)', () => {
    // Frozen: an in-place rename throws in strict mode instead of silently
    // editing the state React is still rendering.
    const participants = deepFreeze([{ ...alice, id: 'old-id' }, bob]);

    const merged = mergeRosterIntoParticipants(participants, [
      { id: 'u-alice', name: 'Alice' },
      { id: 'u-dan', name: 'Dan' },
    ], []);

    expect(participants[0].id).toBe('old-id');
    expect(participants).toHaveLength(2);
    expect(merged).not.toBe(participants);
    expect(merged?.[1]).toBe(bob);
  });
});

/**
 * Review finding D on the incident ISS branch. Both screens handled
 * `member-joined` with a closure over the session they were mounted with, so
 * anyone who joined later looked missing on every reconnect and the whole
 * session was written again each time. The rule is now the roster's, for a
 * roster of one, and it answers `null` when there is nothing to write.
 */
describe('memberJoinedChange', () => {
  it('answers null for someone already listed and not marked as left', () => {
    const state = deepFreeze({ participants: [alice, bob], leftUsers: [] as string[] });

    expect(memberJoinedChange(state, { id: 'u-bob', name: 'Bob' }, [])).toBeNull();
  });

  it('adds a newcomer by the roster rule', () => {
    const carol: User = { id: 'u-carol', name: 'Carol', color: 'bg-lime-500', role: 'participant' };

    const change = memberJoinedChange({ participants: [alice] }, { id: 'u-carol', name: 'Carol' }, [carol]);

    expect(change).toEqual({ participants: [alice, { id: 'u-carol', name: 'Carol', color: 'bg-lime-500', role: 'participant' }] });
  });

  it('clears the "has left" mark of someone who reconnects, and touches nothing else', () => {
    const state = deepFreeze({ participants: [alice, bob], leftUsers: ['u-bob', 'u-other'] });

    const change = memberJoinedChange(state, { id: 'u-bob', name: 'Bob' }, []);

    expect(change).toEqual({ leftUsers: ['u-other'] });
    expect(state.leftUsers).toEqual(['u-bob', 'u-other']);
  });

  it('does both in one change for a newcomer who was marked as left', () => {
    const change = memberJoinedChange({ participants: [alice], leftUsers: ['guest'] }, { id: 'guest', name: 'Guest' }, []);

    expect(change?.participants?.map((p) => p.id)).toEqual(['u-alice', 'guest']);
    expect(change?.leftUsers).toEqual([]);
  });

  it('treats a session that has not loaded yet as having nobody', () => {
    expect(memberJoinedChange(undefined, { id: 'u-alice', name: 'Alice' }, [alice])?.participants).toEqual([
      { id: 'u-alice', name: 'Alice', color: 'bg-rose-500', role: 'participant' },
    ]);
  });
});

// The list the session screens draw people from, and where the board and the
// Discuss topic find a card's author (utils/cardHue.ts): one person per id and
// per name, as `getParticipants` in Session.tsx and HealthCheckSession.tsx.
describe('sessionParticipants', () => {
  const claire: User = { id: 'u-claire', name: 'Claire', color: 'bg-indigo-500', role: 'participant' };

  it('lists the session’s participants in their order, and the viewer last when it does not list them yet', () => {
    expect(sessionParticipants([alice, bob], claire)).toEqual([alice, bob, claire]);
  });

  it('lists the viewer once, as the session holds them, when it does', () => {
    const listedClaire = { ...claire, color: 'bg-lime-500' };
    expect(sessionParticipants([listedClaire, alice], claire)).toEqual([listedClaire, alice]);
  });

  it('lists the viewer alone for a session with nobody yet', () => {
    expect(sessionParticipants(undefined, claire)).toEqual([claire]);
    expect(sessionParticipants([], claire)).toEqual([claire]);
  });

  it('lists each id once, the first entry kept', () => {
    expect(sessionParticipants([alice, { ...alice, color: 'bg-lime-500' }, bob], bob)).toEqual([alice, bob]);
  });

  // The stated residual (AGENTS.md → *The presence panel merges participants
  // by name*): two people whose names differ only in case are listed once.
  it('lists each name once, matched trimmed and in any case, the first one listed kept', () => {
    const alexUpper: User = { id: 'u-alex-1', name: 'Alex', color: 'bg-rose-500', role: 'participant' };
    const alexLower: User = { id: 'u-alex-2', name: ' alex ', color: 'bg-cyan-500', role: 'participant' };
    expect(sessionParticipants([alexUpper, alexLower, bob], bob)).toEqual([alexUpper, bob]);
    // The viewer too, when someone listed before them has their name.
    expect(sessionParticipants([alexUpper], alexLower)).toEqual([alexUpper]);
  });

  it('never mutates the participants it was given (they belong to the rendered state)', () => {
    const participants = deepFreeze([alice, bob]);
    expect(() => sessionParticipants(participants, claire)).not.toThrow();
    expect(participants).toEqual([alice, bob]);
  });
});
