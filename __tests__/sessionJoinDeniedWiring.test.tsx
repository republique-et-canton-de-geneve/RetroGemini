import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import HealthCheckSession from '../components/HealthCheckSession';
import { HealthCheckSession as HealthCheckSessionType, Team, User } from '../types';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';

/**
 * Audit H12 — wiring guard.
 *
 * `SessionConnectionStatus` renders the two states apart; this file pins that a
 * session component actually *reaches* the denied state and, crucially, stays
 * there. A refused join leaves the socket connected, so the next `connect`
 * event used to flip the session back to "live" and re-enable editing that
 * still could not sync. The health-check session stands in for both session
 * components — the retrospective one carries the identical handler.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(),
    getHealthCheck: vi.fn(),
    updateHealthCheckSession: vi.fn(),
    persistParticipants: vi.fn(),
    applyRemoteHealthCheckSession: vi.fn()
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

const facilitator: User = {
  id: 'facilitator-1',
  name: 'Facilitator',
  color: 'bg-indigo-500',
  role: 'facilitator'
};

const createSession = (): HealthCheckSessionType => ({
  id: 'hc-1',
  teamId: 'team-1',
  name: 'Team Health',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'SURVEY',
  templateId: 'template-1',
  templateName: 'Team Health',
  dimensions: [
    {
      id: 'dim-1',
      name: 'Communication',
      goodDescription: 'People collaborate well',
      badDescription: 'People work in silos'
    }
  ],
  participants: [facilitator],
  settings: {
    isAnonymous: false,
    revealRoti: false,
    showParticipantVotes: false
  },
  ratings: {},
  actions: [],
  roti: {},
  finishedUsers: []
});

const createTeam = (session: HealthCheckSessionType): Team => ({
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  healthChecks: [session]
});

type DeniedHandler = (data: { sessionId: string; reason: string }) => void;
type ConnectionHandler = (connected: boolean) => void;

describe('join-denied wiring in a session component', () => {
  let denied: DeniedHandler | null;
  let connection: ConnectionHandler | null;
  let onSessionExpired: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    denied = null;
    connection = null;
    onSessionExpired = vi.fn();

    const session = createSession();
    const team = createTeam(session);

    vi.mocked(dataService.getTeam).mockReturnValue(team);
    vi.mocked(dataService.getHealthCheck).mockReturnValue(session);
    vi.mocked(syncService.getCurrentSessionId).mockReturnValue(session.id);
    vi.mocked(syncService.onJoinDenied).mockImplementation((cb: DeniedHandler) => {
      denied = cb;
      return () => {};
    });
    vi.mocked(syncService.onConnectionChange).mockImplementation((cb: ConnectionHandler) => {
      connection = cb;
      return () => {};
    });

    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    });

    const session2 = createSession();
    render(
      <HealthCheckSession
        team={createTeam(session2)}
        currentUser={facilitator}
        sessionId={session2.id}
        onExit={() => undefined}
        onSessionExpired={onSessionExpired}
      />
    );
  });

  const deny = (reason = 'unauthenticated') =>
    act(() => {
      denied?.({ sessionId: 'hc-1', reason });
    });

  it('shows no connection banner while the session is healthy', () => {
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Reconnecting/i)).toBeNull();
  });

  it('surfaces the expired-session banner when the server refuses the join', () => {
    deny();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/expired/i);
    expect(screen.getByRole('button', { name: /log in again/i })).toBeTruthy();
  });

  it('routes the user back to login from the denied banner', () => {
    deny();

    screen.getByRole('button', { name: /log in again/i }).click();

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('ignores a denial aimed at a different session', () => {
    act(() => {
      denied?.({ sessionId: 'some-other-session', reason: 'forbidden' });
    });

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not go back to "live" when the socket reconnects after a denial', () => {
    deny();
    act(() => {
      connection?.(true);
    });

    // The socket is connected again, but the credential is still refused: the
    // session must not claim to be live, and must not fall back to the
    // "Reconnecting…" wording either.
    expect(screen.getByRole('button', { name: /log in again/i })).toBeTruthy();
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.queryByText(/Reconnecting/i)).toBeNull();
  });

  // The banner alone cannot prove editing stayed paused: it keys off the
  // denial, not off the live flag the write path checks. These two pin the
  // write path itself — the control case first, so the negative below cannot
  // pass vacuously.
  it('still writes through while the session is healthy', () => {
    vi.mocked(syncService.updateSession).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'DISCUSS' }));

    expect(syncService.updateSession).toHaveBeenCalled();
  });

  it('keeps editing paused after a reconnect that follows a denial', () => {
    deny();
    act(() => {
      connection?.(true);
    });
    vi.mocked(syncService.updateSession).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'DISCUSS' }));

    expect(syncService.updateSession).not.toHaveBeenCalled();
  });

  it('still shows the plain reconnecting banner for an ordinary disconnection', () => {
    act(() => {
      connection?.(false);
    });

    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/Reconnecting/i);
    expect(screen.queryByRole('button', { name: /log in again/i })).toBeNull();
  });
});
