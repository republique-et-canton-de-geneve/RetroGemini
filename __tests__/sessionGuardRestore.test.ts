// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  findProtectedFieldViolations,
  restoreProtectedFields,
  isSameSessionState,
  PROTECTED_SESSION_FIELDS,
  PROTECTED_SETTINGS_FIELDS
} from '../server/services/sessionGuard.js';

/**
 * Incident ISS (2026-10-12): a participant whose cached team record predated a
 * Dashboard rename sent the old `name` with every write. `name` is
 * facilitator-only, so the server refused the **whole** write — the tickets in
 * it included — healed the sender, and the client re-sent the same blob three
 * times a second, forever. Each unconfirmed card left the author's screen 60 s
 * later: "the tickets disappear one by one".
 *
 * The server now restores the facilitator-only fields from its own state and
 * keeps the rest. That is only safe if restoring is exactly as strict as
 * refusing was: these tests pin that equivalence for every protected entry, so
 * a field added to the guard later is covered the day it is added.
 */

type Blob = Record<string, unknown>;

const authoritative = (): Blob => ({
  id: 's1',
  teamId: 'teamA',
  name: 'Retro B',
  date: '2026-10-12',
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  icebreakerQuestion: 'What made you smile?',
  columns: [{ id: 'c1', title: 'Went well' }],
  discussionFocusId: null,
  templateLanguage: 'en',
  closedActionsSnapshot: [{ id: 'a1', impactDeferredBy: null }],
  leftUsers: ['gone1'],
  settings: {
    isAnonymous: false,
    maxVotes: 3,
    oneVotePerTicket: false,
    revealBrainstorm: false,
    revealHappiness: false,
    revealRoti: false,
    revealActionImpact: false,
    colorBy: 'column',
    showParticipantVotes: false,
    timerInitial: 300,
    timerRunning: false,
    timerSeconds: 300
  },
  tickets: [{ id: 't0', colId: 'c1', text: 'Existing', authorId: 'fac1', votes: [] }],
  happiness: {},
  _rev: 4
});

// A value guaranteed to differ from whatever the authoritative state holds.
const differentValue = (current: unknown): unknown => {
  if (typeof current === 'boolean') return !current;
  if (typeof current === 'number') return current + 7;
  if (Array.isArray(current)) return [...current, { id: 'planted' }];
  if (current && typeof current === 'object') return { ...current, planted: true };
  if (current == null) return 'planted-value';
  return `${String(current)} (tampered)`;
};

describe('restoreProtectedFields', () => {
  it('restores every top-level facilitator-only field and leaves the rest alone', () => {
    // Guards the equivalence the whole fix rests on: after restoration the
    // guard finds nothing, for every protected field, so a participant can
    // never change one by riding a legitimate change along with it.
    for (const field of PROTECTED_SESSION_FIELDS) {
      const auth = authoritative();
      const incoming = structuredClone(auth);
      incoming[field] = differentValue(auth[field]);
      incoming.tickets = [...(auth.tickets as Blob[]), { id: 't1', colId: 'c1', text: 'Mine', authorId: 'par1', votes: [] }];

      const result = restoreProtectedFields(incoming, auth);

      expect('blob' in result, field).toBe(true);
      if (!('blob' in result)) continue;
      expect(findProtectedFieldViolations(result.blob, auth), field).toEqual([]);
      expect(result.restored, field).toEqual([field]);
      // The participant's own change survives restoration.
      expect(result.blob.tickets, field).toEqual(incoming.tickets);
    }
  });

  it('restores every facilitator-only setting and keeps the timer runtime fields', () => {
    for (const field of PROTECTED_SETTINGS_FIELDS) {
      const auth = authoritative();
      const incoming = structuredClone(auth);
      const settings = incoming.settings as Blob;
      settings[field] = differentValue((auth.settings as Blob)[field]);
      // Every client legitimately writes the timer runtime fields.
      settings.timerRunning = true;
      settings.timerStartedAt = 1234;

      const result = restoreProtectedFields(incoming, auth);

      expect('blob' in result, field).toBe(true);
      if (!('blob' in result)) continue;
      expect(findProtectedFieldViolations(result.blob, auth), field).toEqual([]);
      expect(result.restored, field).toEqual([`settings.${field}`]);
      expect((result.blob.settings as Blob).timerRunning, field).toBe(true);
      expect((result.blob.settings as Blob).timerStartedAt, field).toBe(1234);
    }
  });

  it('removes a protected field the authoritative state does not have', () => {
    // "Restore" means "make it what the server has", and the server may have
    // nothing: a legacy health check has no timerInitial, a retro no reviewSummary.
    const auth = authoritative();
    delete auth.reviewSummary;
    delete (auth.settings as Blob).timerInitial;
    const incoming = structuredClone(auth);
    incoming.reviewSummary = 'Planted summary';
    (incoming.settings as Blob).timerInitial = 420;

    const result = restoreProtectedFields(incoming, auth);

    expect('blob' in result).toBe(true);
    if (!('blob' in result)) return;
    expect(result.blob).not.toHaveProperty('reviewSummary');
    expect(result.blob.settings).not.toHaveProperty('timerInitial');
    expect(result.restored).toEqual(['reviewSummary', 'settings.timerInitial']);
    expect(findProtectedFieldViolations(result.blob, auth)).toEqual([]);
  });

  it('drops leftUsers additions but keeps removals', () => {
    // Only the facilitator marks someone as having left; anyone clears a mark,
    // because every client clears the mark of a participant who reconnects.
    const auth = { ...authoritative(), leftUsers: ['gone1', 'gone2'] };
    const incoming = { ...structuredClone(auth), leftUsers: ['gone2', 'par7'] };

    const result = restoreProtectedFields(incoming, auth);

    expect('blob' in result).toBe(true);
    if (!('blob' in result)) return;
    expect(result.blob.leftUsers).toEqual(['gone2']);
    expect(result.restored).toEqual(['leftUsers']);
    expect(findProtectedFieldViolations(result.blob, auth)).toEqual([]);
  });

  it('reports nothing restored for a pure removal from leftUsers', () => {
    const auth = { ...authoritative(), leftUsers: ['gone1', 'gone2'] };
    const incoming = { ...structuredClone(auth), leftUsers: ['gone2'] };

    const result = restoreProtectedFields(incoming, auth);

    expect(result).toEqual({ blob: incoming, restored: [] });
  });

  it('refuses shapes it cannot restore field by field', () => {
    const auth = authoritative();
    expect(restoreProtectedFields({ ...structuredClone(auth), leftUsers: 'par1' }, auth)).toEqual({ reject: 'malformed' });
    expect(restoreProtectedFields({ ...structuredClone(auth), settings: 'open' }, auth)).toEqual({ reject: 'malformed' });
    expect(restoreProtectedFields({ ...structuredClone(auth), settings: [1, 2] }, auth)).toEqual({ reject: 'malformed' });
  });

  it('rebuilds the protected settings when the blob carries none', () => {
    const auth = authoritative();
    const { settings: _dropped, ...withoutSettings } = structuredClone(auth);

    const result = restoreProtectedFields(withoutSettings, auth);

    expect('blob' in result).toBe(true);
    if (!('blob' in result)) return;
    expect(findProtectedFieldViolations(result.blob, auth)).toEqual([]);
  });

  it('never mutates its inputs, and never shares a restored value with the authoritative state', () => {
    const auth = authoritative();
    const incoming = structuredClone(auth);
    incoming.columns = [{ id: 'c9', title: 'Hijacked' }];
    (incoming.settings as Blob).revealBrainstorm = true;
    incoming.leftUsers = ['gone1', 'par1'];
    const authBefore = structuredClone(auth);
    const incomingBefore = structuredClone(incoming);

    const result = restoreProtectedFields(incoming, auth);

    expect(auth).toEqual(authBefore);
    expect(incoming).toEqual(incomingBefore);
    expect('blob' in result).toBe(true);
    if (!('blob' in result)) return;
    // A later edit of the saved blob must not reach into the cached state.
    expect(result.blob.columns).not.toBe(auth.columns);
    expect(result.blob.settings).not.toBe(auth.settings);
  });

  it('returns the incoming blob untouched when nothing protected differs', () => {
    const auth = authoritative();
    const incoming = { ...structuredClone(auth), happiness: { par1: 4 } };

    expect(restoreProtectedFields(incoming, auth)).toEqual({ blob: incoming, restored: [] });
  });
});

describe('isSameSessionState', () => {
  it('ignores the revision stamp and the save time', () => {
    const auth = authoritative();
    expect(isSameSessionState({ ...structuredClone(auth), _rev: 1, _updatedAt: 'x' }, auth)).toBe(true);
  });

  it('sees a participant change, however small', () => {
    const auth = authoritative();
    expect(isSameSessionState({ ...structuredClone(auth), happiness: { par1: 4 } }, auth)).toBe(false);
  });
});
