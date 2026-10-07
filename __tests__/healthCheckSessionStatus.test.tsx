import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import HealthCheckSession from '../components/HealthCheckSession';
import Dashboard from '../components/Dashboard';
import { HealthCheckSession as HealthCheckSessionType, Team, User } from '../types';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';

/**
 * Field report: health checks stayed "IN PROGRESS" on the dashboard after the
 * session had ended. A retro is marked CLOSED the moment the facilitator opens
 * its Close phase; a health check was only marked CLOSED when the facilitator
 * clicked its exit button, so closing the tab at the end — or that single last
 * write being lost — left it in progress for good. A stuck health check also
 * kept capturing participants, because the app sends a participant who lands
 * on the dashboard into the first health check still in progress.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(),
    getHealthCheck: vi.fn(),
    updateHealthCheckSession: vi.fn(),
    persistParticipants: vi.fn(),
    getHealthCheckTemplates: vi.fn(() => []),
    getAuthenticatedPassword: vi.fn(() => 'pw'),
    getSessionToken: vi.fn(() => 'token')
  }
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    updateSession: vi.fn(),
    onSessionUpdate: vi.fn(() => () => {}),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn(() => () => {}),
    getCurrentSessionId: vi.fn(),
    leaveSession: vi.fn(),
    onConnectionChange: vi.fn(() => () => {}),
    onJoinDenied: vi.fn(() => () => {}),
    isConnected: vi.fn(() => true)
  }
}));

const facilitator: User = { id: 'fac', name: 'Fran', color: 'bg-indigo-500', role: 'facilitator' };
const alice: User = { id: 'a', name: 'Alice', color: 'bg-rose-500', role: 'participant' };

const createSession = (overrides: Partial<HealthCheckSessionType> = {}): HealthCheckSessionType => ({
  id: 'hc-1',
  teamId: 'team-1',
  name: 'Health Check R2606',
  date: '11/06/2026',
  status: 'IN_PROGRESS',
  phase: 'REVIEW',
  templateId: 'team_health_fr',
  templateName: 'Bilan de santé (FR)',
  dimensions: [{ id: 'd1', name: 'Autonomie', goodDescription: 'Good', badDescription: 'Bad' }],
  participants: [facilitator, alice],
  settings: { isAnonymous: false, revealRoti: false, showParticipantVotes: false },
  ratings: { fac: { d1: { rating: 5 } }, a: { d1: { rating: 4 } } },
  actions: [],
  discussionFocusId: null,
  roti: {},
  finishedUsers: [],
  ...overrides
});

const createTeam = (session: HealthCheckSessionType): Team => ({
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [facilitator, alice],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  healthChecks: [session]
});

const lastWrite = (): HealthCheckSessionType => {
  const calls = vi.mocked(dataService.updateHealthCheckSession).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1];
};

const renderSession = (session: HealthCheckSessionType, user: User = facilitator, onExit = vi.fn()) => {
  const team = createTeam(session);
  vi.mocked(dataService.getTeam).mockReturnValue(team);
  vi.mocked(dataService.getHealthCheck).mockReturnValue(session);
  vi.mocked(syncService.getCurrentSessionId).mockReturnValue(session.id);
  render(<HealthCheckSession team={team} currentUser={user} sessionId={session.id} onExit={onExit} />);
  return { onExit };
};

describe('Health check status follows the phase, like a retrospective', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    });
  });

  it('is marked CLOSED as soon as the facilitator opens the Close phase', () => {
    renderSession(createSession({ phase: 'REVIEW' }));

    fireEvent.click(screen.getByRole('button', { name: 'Next: Close' }));

    const written = lastWrite();
    expect(written.phase).toBe('CLOSE');
    expect(written.status).toBe('CLOSED');
    // The same blob goes to the other participants, so the status reaches the
    // server even when the facilitator then simply closes the tab.
    const synced = vi.mocked(syncService.updateSession).mock.calls.at(-1)?.[0] as HealthCheckSessionType;
    expect(synced.status).toBe('CLOSED');
  });

  it('stays closed while the facilitator reads the results back through the phases', () => {
    // "View Results" opens a finished health check at Close, which shows only
    // the ROTI; the detail is read by clicking back to Review or Discuss. If
    // that browsing reopened it, leaving would put it back "IN PROGRESS" and
    // the participant redirect would capture people again.
    const { onExit } = renderSession(createSession({ phase: 'CLOSE', status: 'CLOSED' }));

    // The phase bar names phases with `common.phase.*`.
    fireEvent.click(screen.getByRole('button', { name: 'REVIEW' }));
    expect(lastWrite().phase).toBe('REVIEW');
    expect(lastWrite().status).toBe('CLOSED');

    fireEvent.click(screen.getByRole('button', { name: 'Leave the health check' }));
    expect(onExit).toHaveBeenCalled();
    const statusWrites = vi.mocked(dataService.updateHealthCheckSession).mock.calls.map(([, s]) => s.status);
    expect(statusWrites).not.toContain('IN_PROGRESS');
  });

  it('stays in progress when the facilitator steps out to the dashboard mid-survey', () => {
    const { onExit } = renderSession(createSession({ phase: 'SURVEY' }));

    fireEvent.click(screen.getByRole('button', { name: 'Leave the health check' }));

    expect(onExit).toHaveBeenCalled();
    const statusWrites = vi.mocked(dataService.updateHealthCheckSession).mock.calls
      .map(([, s]) => s.status);
    expect(statusWrites).not.toContain('CLOSED');
  });

  it('heals a health check left in progress at its Close phase when the facilitator leaves it', () => {
    const { onExit } = renderSession(createSession({ phase: 'CLOSE', status: 'IN_PROGRESS' }));

    fireEvent.click(screen.getByRole('button', { name: 'Return to Dashboard' }));

    expect(onExit).toHaveBeenCalled();
    expect(lastWrite().status).toBe('CLOSED');
  });

  it('never reopens a health check the previous exit rule closed before its Close phase', () => {
    // The old rule closed a health check at whatever phase the facilitator left
    // it, so CLOSED records sit at Survey, Discuss and Review. Viewing one and
    // leaving must not put it back in progress — the participant redirect
    // would send people into it again.
    const { onExit } = renderSession(createSession({ phase: 'DISCUSS', status: 'CLOSED' }));

    fireEvent.click(screen.getByRole('button', { name: 'Leave the health check' }));

    expect(onExit).toHaveBeenCalled();
    const statusWrites = vi.mocked(dataService.updateHealthCheckSession).mock.calls
      .map(([, s]) => s.status);
    expect(statusWrites).not.toContain('IN_PROGRESS');
  });

  it('never offers a participant a phase button that does nothing, even once closed', () => {
    // Only the facilitator changes phase; the buttons used to turn on for
    // participants of a closed health check while their click did nothing.
    renderSession(createSession({ phase: 'CLOSE', status: 'CLOSED' }), alice);

    expect((screen.getByRole('button', { name: 'SURVEY' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('never lets a participant change the status on their way out', () => {
    const { onExit } = renderSession(createSession({ phase: 'CLOSE', status: 'IN_PROGRESS' }), alice);
    vi.mocked(dataService.updateHealthCheckSession).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Leave Health Check' }));

    expect(onExit).toHaveBeenCalled();
    const statusWrites = vi.mocked(dataService.updateHealthCheckSession).mock.calls
      .map(([, s]) => s.status);
    expect(statusWrites).not.toContain('CLOSED');
  });
});

describe('Dashboard shows a finished health check as closed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ enabled: false })
    }) as never;
  });

  const renderDashboard = (session: HealthCheckSessionType) =>
    render(
      <Dashboard
        team={createTeam(session)}
        currentUser={facilitator}
        onOpenSession={vi.fn()}
        onOpenHealthCheck={vi.fn()}
        onRefresh={vi.fn()}
        initialTab="HEALTH_CHECKS"
      />
    );

  it('reads a record stuck in progress at its Close phase as closed', () => {
    // The shape the field report showed: the session ran to its end, but the
    // stored status never left IN_PROGRESS.
    renderDashboard(createSession({ phase: 'CLOSE', status: 'IN_PROGRESS' }));

    expect(screen.queryByText('IN PROGRESS')).toBeNull();
    expect(screen.getByText('CLOSED')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View Results' })).toBeTruthy();
  });

  it('still shows a health check that is genuinely running as in progress', () => {
    renderDashboard(createSession({ phase: 'DISCUSS', status: 'IN_PROGRESS' }));

    expect(screen.getByText('IN PROGRESS')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
  });
});
