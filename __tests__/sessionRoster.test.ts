import { describe, expect, it } from 'vitest';
import { mergeRosterIntoParticipants, PARTICIPANT_COLOR_POOL } from '../components/session/sessionRoster';
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
