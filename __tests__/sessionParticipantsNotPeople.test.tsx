import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import Session from '../components/Session';
import HealthCheckSession from '../components/HealthCheckSession';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';
import type { HealthCheckSession as HealthCheckSessionType, RetroSession, Team, User } from '../types';

/**
 * Every client writes a session's participant list, and the server stores its
 * entries as they come. An entry that is not an object with a string id and
 * name — `null` above all, the one a JSON write turns `undefined` into — made
 * both session screens throw for everyone in the room: the retrospective as it
 * opened (`reconcileParticipantsList`), the health check as it checked whether
 * to list its viewer (`entersWriting`), and each of them in every write. The
 * screens now take every session they hold through `listedPeople`
 * (`components/session/sessionRoster.ts`): the one they open with, each one
 * the server sends, and the copy a write starts from. The shared list's own
 * rule is pinned in `sessionRoster.test.ts`.
 */

let sessionUpdate: ((session: unknown) => void) | null = null;
let rosterUpdate: ((roster: { id: string; name: string }[]) => void) | null = null;

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(() => null),
    getHealthCheck: vi.fn(),
    updateSession: vi.fn(),
    updateHealthCheckSession: vi.fn(),
    applyRemoteSession: vi.fn(),
    applyRemoteHealthCheckSession: vi.fn(),
    persistParticipants: vi.fn(),
    getHealthCheckTemplates: vi.fn(() => []),
    getAuthenticatedPassword: vi.fn(() => 'pw'),
    getSessionToken: vi.fn(() => 'token'),
  },
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    leaveSession: vi.fn(),
    updateSession: vi.fn(),
    getCurrentSessionId: vi.fn(),
    onSessionUpdate: vi.fn((callback: (session: unknown) => void) => {
      sessionUpdate = callback;
      return () => {};
    }),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn((callback: (roster: { id: string; name: string }[]) => void) => {
      rosterUpdate = callback;
      return () => {};
    }),
    onActivity: vi.fn(() => () => {}),
    sendActivity: vi.fn(),
    onConnectionChange: vi.fn(() => () => {}),
    onJoinDenied: vi.fn(() => () => {}),
    onUpdateRefused: vi.fn(() => () => {}),
    onSyncHealth: vi.fn(() => () => {}),
    getSyncHealth: vi.fn(() => 'ok'),
    getResendDelayMs: vi.fn(() => 0),
    isConnected: vi.fn(() => true),
  },
}));

const fran: User = { id: 'fac', name: 'Fran', color: 'bg-indigo-500', role: 'facilitator' };
const alice: User = { id: 'u-alice', name: 'Alice', color: 'bg-rose-500', role: 'participant' };
// Listed before the people, so that no `some()` stops at a person first.
const NOT_PEOPLE = [null, 'Alice', 42, { id: 'u-x' }, { name: 'Bob' }, { id: 7, name: 'Seven' }, { id: 'u-y', name: {} }];
const listing = (...people: User[]) => [...NOT_PEOPLE, ...people] as unknown as User[];
const proposal = { id: 'a1', text: 'Fix the pipeline', assigneeId: null, done: false, type: 'proposal', proposalVotes: { 'u-alice': 'up' } } as unknown as RetroSession['actions'][number];

const retro = (phase: string, participants: User[]): RetroSession => ({
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Retro',
  date: '2026-11-24',
  status: 'IN_PROGRESS',
  phase,
  participants,
  icebreakerQuestion: '',
  columns: [{ id: 'col-1', title: 'Well', color: 'bg-emerald-500', border: 'border-emerald-500', icon: 'sentiment_satisfied', text: 'text-emerald-700', ring: 'ring-emerald-300' }],
  settings: { isAnonymous: false, maxVotes: 5, oneVotePerTicket: false, revealBrainstorm: true, revealHappiness: true, revealRoti: true, timerSeconds: 0, timerRunning: false, timerInitial: 0 },
  tickets: [{ id: 't1', colId: 'col-1', text: 'Deploys are scary', authorId: 'u-alice', groupId: null, votes: [] }],
  groups: [],
  actions: [proposal],
  happiness: {},
  roti: { 'u-alice': 3 } as unknown as RetroSession['roti'],
  finishedUsers: [],
});

const healthCheck = (phase: HealthCheckSessionType['phase'], participants: User[]): HealthCheckSessionType => ({
  id: 'hc-1',
  teamId: 'team-1',
  name: 'Health check',
  date: '24/11/2026',
  status: 'IN_PROGRESS',
  phase,
  templateId: 'team_health_en',
  templateName: 'Team health',
  dimensions: [{ id: 'd1', name: 'Autonomy', goodDescription: 'Good', badDescription: 'Bad' }],
  participants,
  settings: { isAnonymous: false, revealRoti: true, showParticipantVotes: true },
  ratings: { 'u-alice': { d1: { rating: 4 } } },
  actions: [proposal] as unknown as HealthCheckSessionType['actions'],
  discussionFocusId: null,
  roti: { 'u-alice': 3 } as unknown as HealthCheckSessionType['roti'],
  finishedUsers: [],
});

const teamWith = (retros: RetroSession[], healthChecks: HealthCheckSessionType[]): Team => ({
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [fran, alice],
  customTemplates: [],
  retrospectives: retros,
  globalActions: [],
  healthChecks,
});

const lastSyncedParticipants = () => {
  const calls = vi.mocked(syncService.updateSession).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return (calls[calls.length - 1][0] as { participants?: unknown[] }).participants;
};

const openRetro = (session: RetroSession) => {
  const team = teamWith([session], []);
  vi.mocked(dataService.getTeam).mockReturnValue(team);
  vi.mocked(syncService.getCurrentSessionId).mockReturnValue(session.id);
  return render(<Session team={team} sessionId={session.id} currentUser={fran} onExit={() => {}} />);
};

const openHealthCheck = (session: HealthCheckSessionType) => {
  const team = teamWith([], [session]);
  vi.mocked(dataService.getTeam).mockReturnValue(team);
  vi.mocked(dataService.getHealthCheck).mockReturnValue(session);
  vi.mocked(syncService.getCurrentSessionId).mockReturnValue(session.id);
  return render(<HealthCheckSession team={team} sessionId={session.id} currentUser={fran} onExit={() => {}} />);
};

describe('A participant entry that is not a person', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionUpdate = null;
    rosterUpdate = null;
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    global.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ enabled: false }) })) as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
  });

  it.each(['ICEBREAKER', 'BRAINSTORM', 'VOTE', 'DISCUSS', 'CLOSE'])(
    'leaves a retrospective open in %s, and out of what it writes',
    (phase) => {
      expect(() => openRetro(retro(phase, listing(fran, alice)))).not.toThrow();
      expect(lastSyncedParticipants()).toEqual([fran, alice]);
    }
  );

  it.each(['SURVEY', 'DISCUSS', 'REVIEW', 'CLOSE'] as const)(
    'leaves a health check open in %s, and out of what it writes',
    (phase) => {
      // The viewer is not listed yet, so opening writes them in.
      expect(() => openHealthCheck(healthCheck(phase, listing(alice)))).not.toThrow();
      expect(lastSyncedParticipants()).toEqual([alice, fran]);
    }
  );

  // A session the team record does not hold yet (created since the record
  // was read): the first state the server sends is the one the screen opens
  // with, and the health check checked whether to list its viewer on it.
  it.each(['retrospective', 'health check'] as const)(
    'is left out of the first state of a %s the team record does not hold yet',
    (kind) => {
      const team = teamWith([], []);
      vi.mocked(dataService.getTeam).mockReturnValue(team);
      vi.mocked(dataService.getHealthCheck).mockReturnValue(undefined);
      const first = kind === 'retrospective' ? retro('DISCUSS', listing(alice)) : healthCheck('DISCUSS', listing(alice));
      vi.mocked(syncService.getCurrentSessionId).mockReturnValue(first.id);
      render(kind === 'retrospective'
        ? <Session team={team} sessionId={first.id} currentUser={fran} onExit={() => {}} />
        : <HealthCheckSession team={team} sessionId={first.id} currentUser={fran} onExit={() => {}} />);

      expect(() => act(() => sessionUpdate?.({ ...first, _rev: 1 }))).not.toThrow();
      expect(lastSyncedParticipants()).toEqual([alice, fran]);
    }
  );

  // A write the screen sends before it holds a session starts from the team
  // record's copy, read from the cache, entries that are not people included.
  it.each(['retrospective', 'health check'] as const)(
    'is left out of a %s write that starts from the team record’s copy',
    (kind) => {
      const cached = kind === 'retrospective' ? retro('DISCUSS', listing(alice)) : healthCheck('DISCUSS', listing(alice));
      const shown = teamWith([], []);
      vi.mocked(dataService.getTeam).mockReturnValue(kind === 'retrospective' ? teamWith([cached as RetroSession], []) : shown);
      vi.mocked(dataService.getHealthCheck).mockReturnValue(kind === 'health check' ? cached as HealthCheckSessionType : undefined);
      vi.mocked(syncService.getCurrentSessionId).mockReturnValue(cached.id);
      render(kind === 'retrospective'
        ? <Session team={shown} sessionId={cached.id} currentUser={fran} onExit={() => {}} />
        : <HealthCheckSession team={shown} sessionId={cached.id} currentUser={fran} onExit={() => {}} />);

      expect(() => act(() => rosterUpdate?.([{ id: fran.id, name: fran.name }]))).not.toThrow();
      expect(lastSyncedParticipants()).toEqual([alice, fran]);
    }
  );

  // A person whose email is not a string is still a person: listed, and
  // matched against the invitees by id and name alone (sessionInvitees.ts).
  // Read as text, the number threw in the participants panel. In a
  // retrospective the guest must not be a team member, whose email the
  // team record writes over the session's as it opens.
  it.each(['retrospective', 'health check'] as const)('lists a person whose email is not a string, in a %s', (kind) => {
    const gus = { id: 'g-1', name: 'Gus', color: 'bg-sky-500', role: 'participant', email: 5 } as unknown as User;
    expect(() => (kind === 'retrospective'
      ? openRetro(retro('BRAINSTORM', [fran, alice, gus]))
      : openHealthCheck(healthCheck('SURVEY', [fran, alice, gus])))).not.toThrow();
    expect(screen.getAllByText('Gus').length).toBeGreaterThan(0);
  });

  // The first state the server sends, then a later one (the merge), then a
  // write: the roster naming the viewer, whom the later state no longer lists.
  it('is left out of the states a retrospective takes from the server, and out of its next write', () => {
    openRetro(retro('DISCUSS', [fran, alice]));
    expect(() => act(() => sessionUpdate?.({ ...retro('DISCUSS', listing(fran, alice)), _rev: 1 }))).not.toThrow();
    expect(() => act(() => sessionUpdate?.({ ...retro('CLOSE', listing(alice)), _rev: 2 }))).not.toThrow();
    vi.mocked(syncService.updateSession).mockClear();

    act(() => rosterUpdate?.([{ id: fran.id, name: fran.name }]));

    expect(lastSyncedParticipants()).toEqual([alice, fran]);
  });

  it('is left out of the states a health check takes from the server, and out of its next write', () => {
    openHealthCheck(healthCheck('DISCUSS', [fran, alice]));
    expect(() => act(() => sessionUpdate?.({ ...healthCheck('DISCUSS', listing(fran, alice)), _rev: 1 }))).not.toThrow();
    expect(() => act(() => sessionUpdate?.({ ...healthCheck('CLOSE', listing(alice)), _rev: 2 }))).not.toThrow();
    vi.mocked(syncService.updateSession).mockClear();

    act(() => rosterUpdate?.([{ id: fran.id, name: fran.name }]));

    expect(lastSyncedParticipants()).toEqual([alice, fran]);
  });
});
