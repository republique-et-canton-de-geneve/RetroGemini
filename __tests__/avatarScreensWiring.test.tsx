import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Session from '../components/Session';
import HealthCheckSession from '../components/HealthCheckSession';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';
import type { HealthCheckSession as HealthCheckSessionType, MemberAvatarChoice, RetroSession, Team, User } from '../types';

/**
 * The avatars on the two session screens (PLAN 6 and 18.1), wired end to end
 * in jsdom: every person drawn through `sessionAvatarOf` (a picture in a named
 * session, initials in an anonymous one or for an id this release does not
 * draw), the viewer's own entry written once on entering when the team holds a
 * newer choice, and the picker opened from the header's own avatar.
 */

const handlers: { update: ((session: unknown) => void) | null } = { update: null };

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(() => null),
    getHealthCheck: vi.fn(() => null),
    updateSession: vi.fn(),
    updateHealthCheckSession: vi.fn(),
    persistParticipants: vi.fn(),
    applyRemoteSession: vi.fn(),
    applyRemoteHealthCheckSession: vi.fn(),
    setMemberAvatar: vi.fn(),
  },
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    leaveSession: vi.fn(),
    updateSession: vi.fn(),
    getCurrentSessionId: vi.fn(() => null),
    onSessionUpdate: vi.fn((callback: (session: unknown) => void) => {
      handlers.update = callback;
      return () => {};
    }),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn(() => () => {}),
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

const me: User = { id: 'me', name: 'Mina', color: 'bg-indigo-500', role: 'participant' };
const fran: User = { id: 'fran', name: 'Fran', color: 'bg-rose-500', role: 'facilitator' };

const retro = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Sprint 12',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  participants: [me, fran],
  icebreakerQuestion: '',
  columns: [{
    id: 'col-1',
    title: 'What Went Well',
    color: 'bg-emerald-500',
    border: 'border-emerald-500',
    icon: 'sentiment_satisfied',
    text: 'text-emerald-700',
    ring: 'ring-emerald-300',
  }],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0,
  },
  tickets: [{ id: 't1', colId: 'col-1', text: 'Fran wrote this', authorId: 'fran', votes: [] }],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  _rev: 1,
  ...overrides,
} as RetroSession);

const healthCheck = (overrides: Partial<HealthCheckSessionType> = {}): HealthCheckSessionType => ({
  id: 'hc-1',
  teamId: 'team-1',
  name: 'Q3 health',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'SURVEY',
  templateId: 'template-1',
  templateName: 'Team Health',
  dimensions: [{ id: 'dim-1', name: 'Communication', goodDescription: 'Good', badDescription: 'Bad' }],
  participants: [me, fran],
  settings: { isAnonymous: false, revealRoti: false, showParticipantVotes: false },
  ratings: {},
  actions: [],
  roti: {},
  finishedUsers: [],
  _rev: 1,
  ...overrides,
});

const team = (memberAvatars: Record<string, MemberAvatarChoice> | undefined, overrides: Partial<Team> = {}): Team => ({
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [{ ...me }, { ...fran }],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  healthChecks: [],
  ...(memberAvatars ? { memberAvatars } : {}),
  ...overrides,
});

const CHOICES: Record<string, MemberAvatarChoice> = { me: { id: 'owl', at: 100 }, fran: { id: 'fox', at: 100 } };

type Kind = 'retro' | 'health check';

const renderScreen = (kind: Kind, theTeam: Team, local: RetroSession | HealthCheckSessionType, user: User = me, extra: Record<string, unknown> = {}) => {
  vi.mocked(syncService.getCurrentSessionId).mockReturnValue(local.id);
  if (kind === 'retro') {
    const withSession = { ...theTeam, retrospectives: [local as RetroSession] };
    return { team: withSession, ...render(<Session team={withSession} sessionId={local.id} currentUser={user} onExit={() => {}} {...extra} />) };
  }
  const withSession = { ...theTeam, healthChecks: [local as HealthCheckSessionType] };
  return { team: withSession, ...render(<HealthCheckSession team={withSession} sessionId={local.id} currentUser={user} onExit={() => {}} {...extra} />) };
};

const sessionOf = (kind: Kind, overrides: Record<string, unknown> = {}) =>
  kind === 'retro' ? retro(overrides as Partial<RetroSession>) : healthCheck(overrides as Partial<HealthCheckSessionType>);

const anonymousOf = (kind: Kind) =>
  kind === 'retro'
    ? retro({ settings: { ...retro().settings, isAnonymous: true } })
    : healthCheck({ settings: { ...healthCheck().settings, isAnonymous: true } });

const writes = () => vi.mocked(syncService.updateSession).mock.calls.map(([blob]) => blob as unknown as { participants?: User[] });
const pictures = () => [...document.querySelectorAll('[data-avatar-art]')].map((element) => element.getAttribute('data-avatar-art'));

beforeEach(() => {
  vi.clearAllMocks();
  handlers.update = null;
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  global.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ enabled: false }) })) as unknown as typeof fetch;
});

describe.each<Kind>(['retro', 'health check'])('avatars on the %s screen', (kind) => {
  it("draws each person's picture in a named session: the panel rows and the header's own avatar", () => {
    // As the facilitator, whose panel opens expanded.
    renderScreen(kind, team(CHOICES), sessionOf(kind), fran);
    const rows = screen.getAllByTestId('participant-row');
    const rowArt = rows.map((row) => row.querySelector('[data-avatar-art]')?.getAttribute('data-avatar-art') ?? null);
    expect(rowArt).toEqual(expect.arrayContaining(['owl', 'fox']));
    // A picture has no disc: the presence dot sits on its box's corner, off the art.
    const dots = rows.filter((row) => row.querySelector('[data-presence-dot]'));
    expect(dots.length).toBeGreaterThan(0);
    for (const row of dots) {
      const dot = row.querySelector('[data-presence-dot]')!;
      const hasPicture = !!row.querySelector('[data-avatar-art]');
      expect(dot.className.split(/\s+/)).toEqual(expect.arrayContaining(hasPicture ? ['-bottom-1', '-right-1.5'] : ['-bottom-0.5', '-right-0.5']));
    }
    const opener = screen.getByRole('button', { name: 'Fran, choose my avatar' });
    expect(opener.querySelector('[data-avatar-art="fox"]')).not.toBeNull();
    // A card names its author with their picture (the retro board only).
    if (kind === 'retro') expect(screen.getByRole('img', { name: 'Fran' }).getAttribute('data-avatar-art')).toBe('fox');
  });

  // A picture is drawn for a person who is in the session. An invitee still
  // expected is a placeholder (a dashed circle holding initials, the "Invited"
  // chip): the picture they chose arrives with them, it is not shown greyed
  // out while they are away. A decision, held here so that it stays one.
  it('draws an invitee still expected as initials, never as the picture they chose', () => {
    const tom: User = { id: 'tom', name: 'Tom', color: 'bg-amber-500', role: 'participant' };
    const withInvitee = team({ ...CHOICES, tom: { id: 'cat', at: 100 } }, { members: [{ ...me }, { ...fran }, { ...tom }] });
    renderScreen(kind, withInvitee, sessionOf(kind, { invitedUsers: [{ id: 'tom', name: 'Tom' }] }), fran);

    const invited = screen.getAllByTestId('invited-row');
    expect(invited).toHaveLength(1);
    expect(invited[0].textContent).toContain('Tom');
    expect(invited[0].textContent).toContain('TO');
    expect(invited[0].querySelector('[data-avatar-art]')).toBeNull();
    expect(pictures()).not.toContain('cat');
    // The people who are here keep theirs.
    expect(pictures()).toEqual(expect.arrayContaining(['owl', 'fox']));
  });

  it('draws no picture anywhere in an anonymous session, whatever the team chose', () => {
    renderScreen(kind, team(CHOICES), anonymousOf(kind), fran);
    expect(screen.getAllByTestId('participant-row').length).toBeGreaterThan(1);
    expect(pictures()).toEqual([]);
    cleanup();
    renderScreen(kind, team(CHOICES), anonymousOf(kind));
    expect(pictures()).toEqual([]);
    // The header's own avatar shows the initials and is named by them.
    expect(screen.getByRole('button', { name: 'MI, Mina, choose my avatar' })).toBeTruthy();
  });

  it('draws the initials for an id this release does not draw', () => {
    renderScreen(kind, team({ me: { id: 'dragon-from-a-later-release', at: 100 } }), sessionOf(kind));
    expect(pictures()).toEqual([]);
    expect(screen.getByRole('button', { name: 'MI, Mina, choose my avatar' })).toBeTruthy();
  });

  it("takes a picture off at once when the session turns anonymous (another client's write)", () => {
    renderScreen(kind, team(CHOICES), sessionOf(kind));
    expect(pictures().length).toBeGreaterThan(0);
    act(() => { handlers.update?.(JSON.parse(JSON.stringify({ ...anonymousOf(kind), _rev: 5 }))); });
    expect(pictures()).toEqual([]);
  });

  describe('the own entry on entering', () => {
    it('writes nothing more than today when nobody chose an avatar', () => {
      renderScreen(kind, team(undefined), sessionOf(kind));
      expect(writes().filter((blob) => blob.participants?.some((p) => 'avatar' in p))).toEqual([]);
    });

    it("writes one copy of the viewer's own entry with the team's newer choice, and nobody else's", () => {
      renderScreen(kind, team(undefined), sessionOf(kind));
      const baseline = writes().length;
      cleanup();
      vi.clearAllMocks();

      const { team: rendered } = renderScreen(kind, team(CHOICES), sessionOf(kind));
      expect(writes().length).toBe(baseline + 1);
      const sent = writes().find((blob) => blob.participants?.some((p) => p.id === 'me' && 'avatar' in p))!;
      expect(sent.participants?.find((p) => p.id === 'me')).toMatchObject({ avatar: 'owl', avatarAt: 100 });
      // Fran's entry is Fran's own client's to write.
      expect(sent.participants?.find((p) => p.id === 'fran')).not.toHaveProperty('avatar');
      // A copy: the cached member rows never gain the field, and no roster post carries one.
      expect(rendered.members.every((member) => !('avatar' in member))).toBe(true);
      expect(me).not.toHaveProperty('avatar');
    });

    it('writes nothing when the entry is already as new as the choice', () => {
      renderScreen(kind, team(undefined), sessionOf(kind));
      const baseline = writes().length;
      cleanup();
      vi.clearAllMocks();

      const current = sessionOf(kind, { participants: [{ ...me, avatar: 'owl', avatarAt: 100 }, fran] });
      renderScreen(kind, team(CHOICES), current);
      expect(writes().length).toBe(baseline);
    });

    it("writes again when the team's map changes while in the session", () => {
      const { team: rendered, rerender } = renderScreen(kind, team(CHOICES), sessionOf(kind));
      const after = writes().length;
      const next = { ...rendered, memberAvatars: { ...CHOICES, me: { id: 'cat', at: 200 } } };
      if (kind === 'retro') rerender(<Session team={next} sessionId="retro-1" currentUser={me} onExit={() => {}} />);
      else rerender(<HealthCheckSession team={next} sessionId="hc-1" currentUser={me} onExit={() => {}} />);
      expect(writes().length).toBe(after + 1);
      expect(writes().at(-1)!.participants?.find((p) => p.id === 'me')).toMatchObject({ avatar: 'cat', avatarAt: 200 });
      expect(pictures()).toContain('cat');
    });
  });

  describe('the picker', () => {
    it('opens from the header avatar, by keyboard too, and stores a pick with the session id', async () => {
      const user = userEvent.setup();
      const answered = { me: { id: 'cat', at: 300 } };
      vi.mocked(dataService.setMemberAvatar).mockResolvedValue(answered);
      const onTeamAvatars = vi.fn();
      const local = sessionOf(kind);
      renderScreen(kind, team(undefined), local, me, { onTeamAvatars });

      const opener = screen.getByRole('button', { name: /choose my avatar/ });
      opener.focus();
      await user.keyboard('{Enter}');
      const dialog = await screen.findByRole('dialog', { name: 'Choose my avatar' });

      fireEvent.click(within(dialog).getByRole('tab', { name: /animals/i }));
      fireEvent.click(within(dialog).getByRole('button', { name: /^Cat$/ }));
      await waitFor(() => expect(onTeamAvatars).toHaveBeenCalledWith('team-1', answered));
      expect(dataService.setMemberAvatar).toHaveBeenCalledWith('me', 'cat', local.id);
    });
  });
});
