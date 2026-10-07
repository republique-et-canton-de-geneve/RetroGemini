import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HealthCheckSession from '../components/HealthCheckSession';
import { HealthCheckSession as HealthCheckSessionType, Team, User } from '../types';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';
import { mergeRemoteHealthCheckSession } from '../components/session/mergeRemoteSession';

/**
 * The participants panel and the invite flow are shared between retros and
 * health checks, and the health check had drifted: it kept its own copy of the
 * panel, so invitations sent from a health check were never listed as "waiting
 * to join", the facilitator could not mark someone as having left, and
 * collapsing the panel collapsed it for every participant. The health check now
 * renders the same panel as the retro and records what the retro records.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(),
    getHealthCheck: vi.fn(),
    updateHealthCheckSession: vi.fn(),
    persistParticipants: vi.fn(),
    createSessionInvite: vi.fn(() => Promise.resolve({ inviteLink: 'http://localhost/?join=x' })),
    createMemberInvite: vi.fn(),
    sendInviteEmail: vi.fn(() => Promise.resolve()),
    getAuthenticatedPassword: vi.fn(() => 'pw'),
    getSessionToken: vi.fn(() => 'token')
  }
}));

type MemberJoined = (data: { userId: string; userName: string }) => void;
let memberJoined: MemberJoined | null = null;

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    updateSession: vi.fn(),
    onSessionUpdate: vi.fn(() => () => {}),
    onMemberJoined: vi.fn((cb: MemberJoined) => {
      memberJoined = cb;
      return () => {};
    }),
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
const bob: User = { id: 'b', name: 'Bob', color: 'bg-emerald-500', role: 'participant', email: 'bob@example.com' };

const createSession = (overrides: Partial<HealthCheckSessionType> = {}): HealthCheckSessionType => ({
  id: 'hc-1',
  teamId: 'team-1',
  name: 'Health Check R2606',
  date: '11/06/2026',
  status: 'IN_PROGRESS',
  phase: 'SURVEY',
  templateId: 'tpl',
  templateName: 'Team Health',
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
  members: [facilitator, alice, bob],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  healthChecks: [session]
});

const writes = () => vi.mocked(dataService.updateHealthCheckSession).mock.calls.map(([, s]) => s);
const lastWrite = () => {
  const all = writes();
  expect(all.length).toBeGreaterThan(0);
  return all[all.length - 1];
};

const renderSession = (session: HealthCheckSessionType, user: User = facilitator) => {
  const team = createTeam(session);
  vi.mocked(dataService.getTeam).mockReturnValue(team);
  vi.mocked(dataService.getHealthCheck).mockReturnValue(session);
  vi.mocked(syncService.getCurrentSessionId).mockReturnValue(session.id);
  return render(<HealthCheckSession team={team} currentUser={user} sessionId={session.id} onExit={vi.fn()} />);
};

describe('Health check participants panel, shared with the retro', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memberJoined = null;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve(null) }) as never;
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });

  it('lists the teammates invited from the health check as waiting to join', async () => {
    vi.mocked(dataService.createMemberInvite).mockResolvedValue({
      user: bob,
      inviteLink: 'http://localhost/?join=bob'
    } as never);
    renderSession(createSession());

    fireEvent.click(screen.getByRole('button', { name: 'Invite Team' }));
    const dialog = await screen.findByRole('dialog');
    // Only Bob has an email address, so he is the one preselected.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invites' }));

    await waitFor(() => expect(lastWrite().invitedUsers?.map((u) => u.id)).toEqual(['b']));
    // The invite is written onto the health check itself, as for a retro: the
    // panel is shared, and every participant's copy of it reads the session.
    expect(dataService.createMemberInvite).toHaveBeenCalledWith('team-1', 'bob@example.com', undefined, 'Bob', 'hc-1');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    const invited = await screen.findByTestId('invited-section');
    expect(within(invited).getByText('Bob')).toBeTruthy();
    expect(within(invited).getByText('Invited · waiting to join (1)')).toBeTruthy();
  });

  it('drops an invitee from the waiting list once they have joined', () => {
    renderSession(createSession({
      participants: [facilitator, alice, bob],
      invitedUsers: [{ id: 'b', name: 'Bob', email: 'bob@example.com' }]
    }));

    expect(screen.queryByTestId('invited-section')).toBeNull();
  });

  it('lets the facilitator mark a participant as having left, and stops waiting for them', () => {
    renderSession(createSession({
      participants: [facilitator, alice, bob],
      // Bob never rated; the facilitator and Alice did.
      ratings: { fac: { d1: { rating: 5 } }, a: { d1: { rating: 4 } } }
    }));
    expect(screen.getByText('2 / 3 completed survey')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Mark Bob as having left the session' }));

    expect(lastWrite().leftUsers).toEqual(['b']);
    const bobRow = screen.getAllByTestId('participant-row').find((row) => within(row).queryByText('Bob'));
    expect(within(bobRow!).getByText('Left the session')).toBeTruthy();
    expect(screen.getByText('2 / 2 completed survey')).toBeTruthy();
  });

  it('brings a participant marked as left back when they reconnect', async () => {
    renderSession(createSession({ participants: [facilitator, alice, bob], leftUsers: ['b'] }));
    expect(screen.getByText('Left the session')).toBeTruthy();

    await waitFor(() => expect(memberJoined).not.toBeNull());
    act(() => memberJoined!({ userId: 'b', userName: 'Bob' }));

    await waitFor(() => expect(lastWrite().leftUsers).toEqual([]));
    expect(screen.queryByText('Left the session')).toBeNull();
  });

  it('collapses the panel for this browser only, without writing the session', () => {
    renderSession(createSession());
    vi.mocked(dataService.updateHealthCheckSession).mockClear();
    vi.mocked(syncService.updateSession).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));

    expect(screen.getByRole('button', { name: 'Expand panel' })).toBeTruthy();
    expect(dataService.updateHealthCheckSession).not.toHaveBeenCalled();
    expect(syncService.updateSession).not.toHaveBeenCalled();
  });

  it('opens collapsed for a participant, as in a retro', () => {
    renderSession(createSession(), alice);

    expect(screen.getByRole('button', { name: 'Expand panel' })).toBeTruthy();
  });
});

describe('mergeRemoteHealthCheckSession keeps invitees a lost write race dropped', () => {
  it('re-adds an invitee missing from the incoming state, and asks for a re-send', () => {
    const prev = createSession({ invitedUsers: [{ id: 'b', name: 'Bob' }] });
    const incoming = createSession({ invitedUsers: [] });

    const { merged, divergent } = mergeRemoteHealthCheckSession(incoming, prev, {
      currentUserId: 'fac',
      ownChanges: new Map()
    });

    expect(merged.invitedUsers?.map((u) => u.id)).toEqual(['b']);
    expect(divergent).toBe(true);
  });

  it('takes the incoming list as it is when nothing was lost', () => {
    const prev = createSession({ invitedUsers: [{ id: 'b', name: 'Bob' }] });
    const incoming = createSession({ invitedUsers: [{ id: 'b', name: 'Bobby' }] });

    const { merged, divergent } = mergeRemoteHealthCheckSession(incoming, prev, {
      currentUserId: 'fac',
      ownChanges: new Map()
    });

    expect(merged.invitedUsers).toEqual([{ id: 'b', name: 'Bobby' }]);
    expect(divergent).toBe(false);
  });
});
