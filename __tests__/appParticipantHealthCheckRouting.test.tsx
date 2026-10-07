import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { dataService } from '../services/dataService';
import { HealthCheckSession, RetroSession, Team, User } from '../types';

/**
 * The other half of the field report about health checks stuck "IN PROGRESS":
 * a participant who lands on the dashboard is sent into the first health check
 * still in progress, before any retro. A health check that ran to its Close
 * phase but kept its stored IN_PROGRESS therefore captured participants for
 * months. The redirect now reads the effective status (utils/sessionStatus.ts).
 */

vi.mock('../services/dataService', () => ({
  OPEN_SESSION_STORAGE_KEY: 'retro-open-session',
  dataService: {
    hydrateFromServer: vi.fn(() => Promise.resolve()),
    refreshFromServer: vi.fn(() => Promise.resolve()),
    getAllTeams: vi.fn(() => []),
    listTeams: vi.fn(() => Promise.resolve([])),
    getTeam: vi.fn(),
    getSessionToken: vi.fn(() => 'rg1.session-token'),
    restoreSession: vi.fn(),
    ensureSessionPlaceholder: vi.fn(),
    ensureHealthCheckPlaceholder: vi.fn(),
    persistParticipants: vi.fn(),
    updateSession: vi.fn(),
    applyRemoteSession: vi.fn(),
    getHealthCheck: vi.fn(),
    // The dashboard renders for a moment before the redirect moves the
    // participant on, so what it reads on mount must exist.
    getAuthenticatedPassword: vi.fn(() => null),
    getHealthCheckTemplates: vi.fn(() => []),
    updateHealthCheckSession: vi.fn(),
    applyRemoteHealthCheckSession: vi.fn()
  }
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    updateSession: vi.fn(),
    leaveSession: vi.fn(),
    sendActivity: vi.fn(),
    onSessionUpdate: vi.fn(() => () => {}),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn(() => () => {}),
    onActivity: vi.fn(() => () => {}),
    onConnectionChange: vi.fn(() => () => {}),
    onJoinDenied: vi.fn(() => () => {}),
    getCurrentSessionId: vi.fn(),
    isConnected: vi.fn(() => true)
  }
}));

const facilitator: User = {
  id: 'fac-1',
  name: 'Fran',
  color: 'bg-indigo-500',
  role: 'facilitator'
};

const retro: RetroSession = {
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Sprint 42 retro',
  date: '2026-07-29T00:00:00.000Z',
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  participants: [facilitator],
  icebreakerQuestion: '',
  columns: [
    {
      id: 'col-good',
      title: 'Went well',
      color: 'bg-emerald-500',
      border: 'border-emerald-500',
      icon: 'sentiment_satisfied',
      text: 'text-emerald-700',
      ring: 'ring-emerald-300'
    }
  ],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: []
};

const team: Team = {
  id: 'team-1',
  name: 'Rocket Squad',
  passwordHash: 'scrypt$stub',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [retro],
  globalActions: []
};

const participant: User = { id: 'p-1', name: 'Pat', color: 'bg-rose-500', role: 'participant' };

const healthCheck = (overrides: Partial<HealthCheckSession>): HealthCheckSession => ({
  id: 'hc-old',
  teamId: 'team-1',
  name: 'Health Check R2603',
  date: '24/02/2026',
  status: 'IN_PROGRESS',
  phase: 'CLOSE',
  templateId: 'team_health_en',
  templateName: 'Team Health Check',
  dimensions: [{ id: 'd1', name: 'Speed', goodDescription: 'Fast', badDescription: 'Slow' }],
  participants: [facilitator, participant],
  settings: { isAnonymous: false, revealRoti: false },
  ratings: {},
  actions: [],
  roti: {},
  finishedUsers: [],
  ...overrides
});

const storedView = () => JSON.parse(localStorage.getItem('retro-open-session') ?? '{}').view;

describe('participants landing on the dashboard', () => {
  const originalFetch = global.fetch;

  const restoreOnDashboard = (healthChecks: HealthCheckSession[]) => {
    const withParticipant: Team = { ...team, members: [facilitator, participant], healthChecks };
    vi.mocked(dataService.getTeam).mockReturnValue(withParticipant);
    vi.mocked(dataService.getHealthCheck).mockImplementation((_t, id) => healthChecks.find((h) => h.id === id));
    localStorage.setItem(
      'retro-open-session',
      JSON.stringify({
        teamId: team.id,
        userId: participant.id,
        userName: participant.name,
        view: 'DASHBOARD',
        sessionToken: 'rg1.session-token'
      })
    );
    render(<App />);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // App mirrors the open session in the URL, and a session path wins over
    // the stored view on restore: start every case from the root.
    window.history.replaceState({}, '', '/');
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: '34.0', announcements: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    ) as unknown as typeof fetch;
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('are not sent into a health check stuck in progress at its Close phase', async () => {
    restoreOnDashboard([healthCheck({ phase: 'CLOSE', status: 'IN_PROGRESS' })]);

    // The live retro, not the months-old health check.
    await screen.findByRole('button', { name: 'BRAINSTORM' });
    await waitFor(() => expect(storedView()).toBe('SESSION'));
  });

  it('are still sent into a health check that is genuinely running', async () => {
    restoreOnDashboard([healthCheck({ id: 'hc-live', phase: 'SURVEY', status: 'IN_PROGRESS' })]);

    await waitFor(() => expect(storedView()).toBe('HEALTH_CHECK'));
    expect(JSON.parse(localStorage.getItem('retro-open-session') ?? '{}').activeHealthCheckId).toBe('hc-live');
  });
});
