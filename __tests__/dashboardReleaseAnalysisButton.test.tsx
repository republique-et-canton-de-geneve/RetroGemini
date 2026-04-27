import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Dashboard from '../components/Dashboard';
import { Team, User, RetroSession } from '../types';

vi.mock('../services/dataService', () => ({
  dataService: {
    getHealthCheckTemplates: vi.fn(() => []),
    addGlobalAction: vi.fn(),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn(),
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
    getAuthenticatedPassword: vi.fn(() => 'pw')
  }
}));

const facilitator: User = {
  id: 'fac-1',
  name: 'Facilitator',
  color: 'bg-indigo-500',
  role: 'facilitator'
};

const baseRetro = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'r1',
  teamId: 'team-1',
  name: 'Sprint 169',
  date: '2026-02-17',
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

const buildTeam = (retros: RetroSession[]): Team => ({
  id: 'team-1',
  name: 'Test Team',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives: retros,
  globalActions: []
});

const renderDashboard = (team: Team) =>
  render(
    <Dashboard
      team={team}
      currentUser={facilitator}
      onOpenSession={vi.fn()}
      onOpenHealthCheck={vi.fn()}
      onRefresh={vi.fn()}
      initialTab="RETROS"
    />
  );

describe('Dashboard release analysis button', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('hides the Analyze release button when AI is disabled', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/ai-status')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: false }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;

    const team = buildTeam([baseRetro()]);
    renderDashboard(team);

    // Wait long enough for the AI status fetch effect to settle.
    await waitFor(() => {
      expect(screen.queryByTestId('open-release-analysis')).toBeNull();
    });
  });

  it('hides the Analyze release button when there are no retrospectives, even if AI is enabled', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/ai-status')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: true }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;

    const team = buildTeam([]);
    renderDashboard(team);

    await waitFor(() => {
      expect(screen.queryByTestId('open-release-analysis')).toBeNull();
    });
  });

  it('shows the Analyze release button when AI is enabled and retros exist', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/ai-status')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: true }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;

    const team = buildTeam([baseRetro({ id: 'r1', name: 'Sprint 169' })]);
    renderDashboard(team);

    await waitFor(() => {
      expect(screen.getByTestId('open-release-analysis')).toBeTruthy();
    });
  });
});
