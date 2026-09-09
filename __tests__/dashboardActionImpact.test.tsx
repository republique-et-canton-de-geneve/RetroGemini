import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Dashboard from '../components/Dashboard';
import { ActionItem, RetroSession, Team, User } from '../types';

// Two integration points the pure modules cannot cover on their own: that the
// Closed filter picks the closure comparator, and that a retro row shows its
// impact line only once there is something to show.
vi.mock('../services/dataService', () => ({
  dataService: {
    getHealthCheckTemplates: vi.fn(() => []),
    addGlobalAction: vi.fn(),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn(),
    setActionImpactRatingEnabled: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
    updateSessionName: vi.fn(),
    updateHealthCheckName: vi.fn(),
    createSession: vi.fn(),
    saveTemplate: vi.fn(),
    deleteTeam: vi.fn(),
    deleteRetrospective: vi.fn(),
    createHealthCheckSession: vi.fn(),
    deleteHealthCheck: vi.fn(),
    saveHealthCheckTemplate: vi.fn(),
    deleteHealthCheckTemplate: vi.fn(),
    changeTeamPassword: vi.fn(),
    renameTeam: vi.fn(),
    getTeam: vi.fn(),
    getAuthenticatedPassword: vi.fn(() => 'pw')
  }
}));

const facilitator: User = { id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };

const action = (overrides: Partial<ActionItem>): ActionItem => ({
  id: 'a',
  text: 'Action',
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  ...overrides
});

const retro = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'r1',
  teamId: 'team-1',
  name: 'Sprint 169',
  date: '6/1/2026',
  status: 'CLOSED',
  phase: 'CLOSE',
  icebreakerQuestion: '',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: true,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
});

const buildTeam = (overrides: Partial<Team> = {}): Team => ({
  id: 'team-1',
  name: 'Test Team',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  ...overrides
});

const renderDashboard = (team: Team, initialTab: 'ACTIONS' | 'RETROS' = 'RETROS') =>
  render(
    <Dashboard
      team={team}
      currentUser={facilitator}
      onOpenSession={vi.fn()}
      onOpenHealthCheck={vi.fn()}
      onRefresh={vi.fn()}
      initialTab={initialTab}
    />
  );

describe('Dashboard - closed action ordering', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ enabled: false })
    }) as never;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // The reported confusion: the Closed list looked randomly ordered because it
  // answered with creation order.
  it('orders the Closed filter by closing date, not creation date', async () => {
    const team = buildTeam({
      globalActions: [
        action({
          id: 'old-but-fresh',
          text: 'Opened in January, closed yesterday',
          done: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          closedAt: '2026-06-01T00:00:00.000Z'
        }),
        action({
          id: 'new-but-stale',
          text: 'Opened in May, closed in May',
          done: true,
          createdAt: '2026-05-01T00:00:00.000Z',
          closedAt: '2026-05-02T00:00:00.000Z'
        })
      ]
    });

    renderDashboard(team, 'ACTIONS');
    screen.getByRole('button', { name: 'Closed' }).click();

    const inputs = await screen.findAllByDisplayValue(/Opened in/);
    expect(inputs.map((el) => (el as HTMLInputElement).value)).toEqual([
      'Opened in January, closed yesterday',
      'Opened in May, closed in May'
    ]);
  });
});

describe('Dashboard - retro impact summary', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ enabled: false })
    }) as never;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('shows the action count, the score and how many were rated', () => {
    const team = buildTeam({
      retrospectives: [
        retro({
          actions: [
            action({ id: 'a1', impactRatings: { u1: 3, u2: 3 } }),
            action({ id: 'a2', impactRatings: { u1: 1 } }),
            action({ id: 'a3' })
          ]
        })
      ]
    });

    renderDashboard(team);

    // The score leads the row as stars, so it is readable at a glance when
    // scanning the list; the sentence it replaces survives as the pill's
    // accessible name.
    const summary = screen.getByTestId('retro-impact-summary');
    expect(summary.querySelector('[aria-label="Average impact 2 out of 3"]')).toBeTruthy();
    expect(summary.textContent).toContain('3 actions');
    expect(summary.textContent).toContain('2 rated');
  });

  // Never "0/3": that reads as a damning verdict when the truth is that nobody
  // has answered yet. The round is one retro behind by design.
  it('shows nothing at all for a retro whose actions nobody has rated', () => {
    const team = buildTeam({
      retrospectives: [retro({ actions: [action({ id: 'a1' })] })]
    });

    renderDashboard(team);

    expect(screen.queryByTestId('retro-impact-summary')).toBeNull();
  });

  it('flags the actions that were added outside the retrospective', () => {
    const team = buildTeam({
      globalActions: [
        action({
          id: 'outside',
          createdAt: '2026-05-15T00:00:00.000Z',
          impactRatings: { u1: 3 }
        })
      ],
      retrospectives: [
        retro({ id: 'r2', date: '6/1/2026', actions: [action({ id: 'inside', impactRatings: { u1: 1 } })] }),
        retro({ id: 'r1', date: '5/1/2026' })
      ]
    });

    renderDashboard(team);

    const summaries = screen.getAllByTestId('retro-impact-summary');
    expect(summaries[0].textContent).toContain('2 actions');
    expect(summaries[0].textContent).toContain('1 added outside');
  });

  it('shows no impact line when the team turned the rating off', () => {
    const team = buildTeam({
      actionImpactRatingEnabled: false,
      retrospectives: [retro({ actions: [action({ id: 'a1', impactRatings: { u1: 3 } })] })]
    });

    renderDashboard(team);

    expect(screen.queryByTestId('retro-impact-summary')).toBeNull();
  });
});
