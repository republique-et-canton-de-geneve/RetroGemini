import { describe, expect, it } from 'vitest';
import type { HealthCheckSession, RetroSession } from '../types';

/**
 * H6 — the optimistic-concurrency stamp that the whole `update-session`
 * protocol depends on must be visible to the type checker.
 *
 * The real gate for this file is `npm run type-check`: without `_rev` /
 * `_updatedAt` on the session types every object literal below is an excess
 * property error and every `session._rev` read is a TS2339. That is the point
 * — a refactor that "tidies" a spread and drops the stamp now gets compiler
 * feedback instead of silently degrading the session-sync CAS (invariant 1)
 * into last-write-wins.
 *
 * The runtime assertions are deliberately thin; they exist so the guard also
 * shows up as a test, not only as a compile step.
 */

const baseRetro: RetroSession = {
  id: 's1',
  teamId: 't1',
  name: 'Sprint 42',
  date: '2026-01-01',
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  icebreakerQuestion: '',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 3,
    oneVotePerTicket: false,
    revealBrainstorm: false,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 300,
    timerRunning: false,
    timerInitial: 300
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: []
};

const baseHealthCheck: HealthCheckSession = {
  id: 'hc1',
  teamId: 't1',
  name: 'Q1 health check',
  date: '2026-01-01',
  status: 'IN_PROGRESS',
  phase: 'SURVEY',
  templateId: 'tpl1',
  templateName: 'Default',
  dimensions: [],
  settings: {
    isAnonymous: false,
    revealRoti: false
  },
  ratings: {},
  actions: [],
  roti: {},
  finishedUsers: []
};

describe('session revision metadata is typed', () => {
  it('carries the CAS stamp on a retrospective session', () => {
    const stamped: RetroSession = {
      ...baseRetro,
      _rev: 7,
      _updatedAt: '2026-01-01T00:00:00.000Z'
    };

    // A spread must preserve the stamp — this is exactly the refactor the
    // typing guards against.
    const copy: RetroSession = { ...stamped };

    expect(copy._rev).toBe(7);
    expect(copy._updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('carries the CAS stamp on a health-check session', () => {
    const stamped: HealthCheckSession = {
      ...baseHealthCheck,
      _rev: 3,
      _updatedAt: '2026-01-01T00:00:00.000Z'
    };

    const copy: HealthCheckSession = { ...stamped };

    expect(copy._rev).toBe(3);
  });

  it('treats an unstamped session as revision 0, the way syncService does', () => {
    // A session created client-side has never been stamped by the server.
    expect(baseRetro._rev).toBeUndefined();
    expect(Number(baseRetro._rev) || 0).toBe(0);
  });
});
