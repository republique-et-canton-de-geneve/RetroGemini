import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SESSION_EPOCH,
  SESSION_REVOKED_ERROR,
  TeamAuthRowCorruptError,
  isSessionCurrent,
  newSessionEpoch,
  parseTeamAuthRow,
  sessionVerdict
} from '../server/services/sessionEpoch.js';

/**
 * Decision D3b — the rule that decides whether a team session token outlived a
 * password rotation. Pure, and shared by every HTTP route and the socket, so
 * the two cannot disagree about one token.
 */

const NO_ROW = { exists: true, sessionEpoch: DEFAULT_SESSION_EPOCH, revokedAt: null };
const ROTATED = { exists: true, sessionEpoch: 'kq3V0b7tZ2mN8xQe1Lw4pA', revokedAt: 1_000_000 };

describe('isSessionCurrent', () => {
  it('accepts a token minted under the current epoch and refuses any other', () => {
    expect(isSessionCurrent({ sessionEpoch: ROTATED.sessionEpoch, createdAt: 1 }, ROTATED)).toBe(true);
    expect(isSessionCurrent({ sessionEpoch: 'another', createdAt: 2_000_000 }, ROTATED)).toBe(false);
  });

  it("reads a team with no row as the epoch '0'", () => {
    expect(isSessionCurrent({ sessionEpoch: '0', createdAt: 1 }, NO_ROW)).toBe(true);
    // A token minted under a rotated epoch is refused once the row is gone
    // (a database rolled back to before the rotation): the safe direction.
    expect(isSessionCurrent({ sessionEpoch: 'abc', createdAt: 1 }, NO_ROW)).toBe(false);
    // And a '0' token is refused once the team has rotated.
    expect(isSessionCurrent({ sessionEpoch: '0', createdAt: 5_000_000 }, ROTATED)).toBe(false);
  });

  it('keeps a legacy token (no claim) current until a rotation made after it was issued', () => {
    expect(isSessionCurrent({ sessionEpoch: null, createdAt: 1 }, NO_ROW)).toBe(true);
    expect(isSessionCurrent({ sessionEpoch: null, createdAt: ROTATED.revokedAt - 1 }, ROTATED)).toBe(false);
    expect(isSessionCurrent({ sessionEpoch: null, createdAt: ROTATED.revokedAt }, ROTATED)).toBe(true);
    expect(isSessionCurrent({ sessionEpoch: null, createdAt: ROTATED.revokedAt + 1 }, ROTATED)).toBe(true);
  });

  it('refuses a legacy token whose issue time cannot be read once the team has rotated', () => {
    expect(isSessionCurrent({ sessionEpoch: null }, ROTATED)).toBe(false);
    // ... and keeps a test double's `{ teamId }` current while nothing rotated.
    expect(isSessionCurrent({ teamId: 't1' } as never, NO_ROW)).toBe(true);
  });
});

describe('sessionVerdict', () => {
  it('names the three outcomes', () => {
    expect(sessionVerdict({ sessionEpoch: '0' }, NO_ROW)).toBe('current');
    expect(sessionVerdict({ sessionEpoch: '0' }, ROTATED)).toBe('revoked');
    expect(sessionVerdict({ sessionEpoch: '0' }, { ...NO_ROW, exists: false })).toBe('team_not_found');
  });

  it('answers with the code every team route sends', () => {
    expect(SESSION_REVOKED_ERROR).toBe('session_revoked');
  });
});

describe('newSessionEpoch', () => {
  it("is 22 base64url characters, never '0', and never repeats", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const epoch = newSessionEpoch();
      expect(epoch).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(epoch).not.toBe(DEFAULT_SESSION_EPOCH);
      seen.add(epoch);
    }
    expect(seen.size).toBe(200);
  });
});

describe('parseTeamAuthRow', () => {
  it('reads what the rule needs', () => {
    expect(parseTeamAuthRow(JSON.stringify({ v: 1, sessionEpoch: 'e1', revokedAt: 5 }), 't1'))
      .toEqual({ sessionEpoch: 'e1', revokedAt: 5 });
  });

  it('ignores a later version and fields it does not know', () => {
    expect(parseTeamAuthRow(JSON.stringify({ v: 2, sessionEpoch: 'e2', revokedAt: 7, scope: 'all' }), 't1'))
      .toEqual({ sessionEpoch: 'e2', revokedAt: 7 });
  });

  it.each([
    ['not JSON', '{"not json'],
    ['not an object', '"e1"'],
    ['an array', '[]'],
    ['a missing epoch', JSON.stringify({ revokedAt: 5 })],
    ['an empty epoch', JSON.stringify({ sessionEpoch: '', revokedAt: 5 })],
    ['a numeric epoch', JSON.stringify({ sessionEpoch: 3, revokedAt: 5 })],
    ['a missing revokedAt', JSON.stringify({ sessionEpoch: 'e1' })],
    ['a non-finite revokedAt', '{"sessionEpoch":"e1","revokedAt":"soon"}']
  ])('refuses %s with an error naming the team and never the text', (_label, text) => {
    let caught: unknown = null;
    try {
      parseTeamAuthRow(text, 'team-42');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TeamAuthRowCorruptError);
    expect((caught as TeamAuthRowCorruptError).teamId).toBe('team-42');
    expect((caught as Error).message).toContain('team-42');
    expect((caught as Error).message).not.toContain(text);
  });
});
