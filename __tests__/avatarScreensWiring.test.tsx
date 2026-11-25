import React from 'react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Session from '../components/Session';
import HealthCheckSession from '../components/HealthCheckSession';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';
import { clearSessionRevoked, markSessionRevoked } from '../services/sessionRevocation';
import { SERVER_STAMP_WAIT_MS } from '../components/session/useOwnAvatar';
import type { HealthCheckSession as HealthCheckSessionType, MemberAvatarChoice, RetroSession, Team, User } from '../types';

/**
 * The avatars on the two session screens (AGENTS.md, *Avatars*), wired end to end
 * in jsdom: every person drawn through `sessionAvatarOf` (a picture in a named
 * session, initials in an anonymous one or for an id this release does not
 * draw), the viewer's own entry carrying the team's newer choice in the write
 * that enters the session (one more write only where the screen sends none),
 * left to the server after a pick made in the session, the picker opened
 * from the header's own avatar, and the one-time avatar hint: shown with the
 * screen, gone for the mount once a choice arrives, the session turns
 * anonymous, the join is refused, the picker opens or "Got it" is pressed,
 * and remembered only by the person's own gestures.
 */

const handlers: {
  update: ((session: unknown) => void) | null;
  denied: ((data: { sessionId: string; reason: string }) => void) | null;
  connection: ((connected: boolean) => void) | null;
} = { update: null, denied: null, connection: null };

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
    onConnectionChange: vi.fn((callback: (connected: boolean) => void) => {
      handlers.connection = callback;
      return () => {};
    }),
    onJoinDenied: vi.fn((callback: (data: { sessionId: string; reason: string }) => void) => {
      handlers.denied = callback;
      return () => {};
    }),
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

const renderScreen = (
  kind: Kind,
  theTeam: Team,
  local: RetroSession | HealthCheckSessionType,
  user: User = me,
  extra: Record<string, unknown> = {},
  options: Pick<RenderOptions, 'wrapper'> = {}
) => {
  vi.mocked(syncService.getCurrentSessionId).mockReturnValue(local.id);
  if (kind === 'retro') {
    const withSession = { ...theTeam, retrospectives: [local as RetroSession] };
    return { team: withSession, ...render(<Session team={withSession} sessionId={local.id} currentUser={user} onExit={() => {}} {...extra} />, options) };
  }
  const withSession = { ...theTeam, healthChecks: [local as HealthCheckSessionType] };
  return { team: withSession, ...render(<HealthCheckSession team={withSession} sessionId={local.id} currentUser={user} onExit={() => {}} {...extra} />, options) };
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
  handlers.denied = null;
  handlers.connection = null;
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

    // A retrospective always sends one write on entering (its presence), and
    // that write carries the choice: a write of the avatar's own went out
    // from the same revision, and the server refused one of the two. A health
    // check sends none for a person it already lists, so the entry is its own
    // write there.
    it("carries the viewer's choice into the session with the team's newer choice, and nobody else's", () => {
      renderScreen(kind, team(undefined), sessionOf(kind));
      const baseline = writes().length;
      cleanup();
      vi.clearAllMocks();

      const { team: rendered } = renderScreen(kind, team(CHOICES), sessionOf(kind));
      expect(writes().length).toBe(kind === 'retro' ? baseline : baseline + 1);
      expect(writes().length).toBeGreaterThan(0);
      for (const sent of writes()) {
        expect(sent.participants?.find((p) => p.id === 'me')).toMatchObject({ avatar: 'owl', avatarAt: 100 });
        // Fran's entry is Fran's own client's to write.
        expect(sent.participants?.find((p) => p.id === 'fran')).not.toHaveProperty('avatar');
      }
      // A copy: the cached member rows never gain the field, and no roster post carries one.
      expect(rendered.members.every((member) => !('avatar' in member))).toBe(true);
      expect(me).not.toHaveProperty('avatar');
    });

    // Someone who is not in the session yet: the write that adds them carries
    // their choice. It used to go out without it, and the avatar followed in
    // a write of its own from the same revision: refused, healed, sent again.
    it('adds a newcomer with their choice in the write that adds them, and sends no write more for it', () => {
      renderScreen(kind, team(undefined), sessionOf(kind, { participants: [fran] }));
      const baseline = writes().length;
      expect(baseline).toBeGreaterThan(0);
      cleanup();
      vi.clearAllMocks();

      renderScreen(kind, team(CHOICES), sessionOf(kind, { participants: [fran] }));
      expect(writes().length).toBe(baseline);
      for (const sent of writes()) {
        expect(sent.participants?.find((p) => p.id === 'me')).toMatchObject({ avatar: 'owl', avatarAt: 100 });
        expect(sent.participants?.find((p) => p.id === 'fran')).not.toHaveProperty('avatar');
      }
      expect(me).not.toHaveProperty('avatar');
    });

    // Someone the session lists and marked as having left, who comes back:
    // the write that takes the mark off carries their choice. Sent first in a
    // write of its own, the entry left from the same revision as that write,
    // the server refused the second, and the mark stayed: nothing sends a
    // lost "I am back" again.
    it('takes the "has left" mark off and carries the choice in one write', () => {
      const away = () => sessionOf(kind, { leftUsers: ['me'] });
      renderScreen(kind, team(undefined), away());
      const baseline = writes().length;
      expect(baseline).toBe(1);
      cleanup();
      vi.clearAllMocks();

      renderScreen(kind, team(CHOICES), away());
      expect(writes()).toHaveLength(1);
      const sent = writes()[0] as { participants?: User[]; leftUsers?: string[] };
      expect(sent.leftUsers).toEqual([]);
      expect(sent.participants?.find((p) => p.id === 'me')).toMatchObject({ avatar: 'owl', avatarAt: 100 });
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

  // The server stamps the entry of the session a pick was made in, right
  // after it answers. Written by the client at once as well, the entry left
  // from the revision that stamp was about to move, and the server refused
  // one of the two on every pick.
  describe('the own entry after a pick made in the session', () => {
    // These run on a fake clock with a dialog open. The screen leaves on that
    // clock and the clock runs dry before the real one comes back: jsdom
    // starts its rendering interval with whatever `setInterval` is installed
    // when the focus moves, and one left waiting on a clock that is gone
    // never fires again (no animation frame for the rest of the file).
    afterEach(() => {
      cleanup();
      if (vi.isFakeTimers()) act(() => { vi.runOnlyPendingTimers(); });
      vi.useRealTimers();
    });

    const settle = async () => {
      for (let turn = 0; turn < 10; turn += 1) await act(async () => { await Promise.resolve(); });
    };

    const pickCat = async () => {
      vi.useFakeTimers();
      const answered = { me: { id: 'cat', at: 300 } };
      vi.mocked(dataService.setMemberAvatar).mockResolvedValue(answered);
      const onTeamAvatars = vi.fn();
      const local = sessionOf(kind);
      const view = renderScreen(kind, team(undefined), local, me, { onTeamAvatars });
      fireEvent.click(screen.getByRole('button', { name: /choose my avatar/ }));
      const dialog = screen.getByRole('dialog', { name: 'Choose my avatar' });
      fireEvent.click(within(dialog).getByRole('tab', { name: /animals/i }));
      fireEvent.click(within(dialog).getByRole('button', { name: /^Cat$/ }));
      await settle();
      expect(onTeamAvatars).toHaveBeenCalledWith('team-1', answered);
      vi.mocked(syncService.updateSession).mockClear();
      // App's part: the answered map on a new team object.
      const next = { ...view.team, memberAvatars: answered };
      if (kind === 'retro') view.rerender(<Session team={next} sessionId="retro-1" currentUser={me} onExit={() => {}} onTeamAvatars={onTeamAvatars} />);
      else view.rerender(<HealthCheckSession team={next} sessionId="hc-1" currentUser={me} onExit={() => {}} onTeamAvatars={onTeamAvatars} />);
      return local;
    };

    it("shows the pick at once and writes nothing: the server's stamp is on its way", async () => {
      const local = await pickCat();
      expect(writes()).toEqual([]);
      // The viewer already sees their choice, from the team's map.
      expect(screen.getByRole('button', { name: /choose my avatar/ }).querySelector('[data-avatar-art="cat"]')).not.toBeNull();

      // The stamp arrives: the entry agrees, and nothing was ever written for it.
      act(() => {
        handlers.update?.(JSON.parse(JSON.stringify({ ...local, participants: [{ ...me, avatar: 'cat', avatarAt: 300 }, fran], _rev: 2 })));
      });
      act(() => { vi.advanceTimersByTime(SERVER_STAMP_WAIT_MS * 2); });
      expect(writes()).toEqual([]);
    });

    it('writes the entry itself when the stamp has not come', async () => {
      await pickCat();
      act(() => { vi.advanceTimersByTime(SERVER_STAMP_WAIT_MS - 1); });
      expect(writes()).toEqual([]);
      act(() => { vi.advanceTimersByTime(1); });
      expect(writes()).toHaveLength(1);
      expect(writes()[0].participants?.find((p) => p.id === 'me')).toMatchObject({ avatar: 'cat', avatarAt: 300 });
      act(() => { vi.advanceTimersByTime(SERVER_STAMP_WAIT_MS * 2); });
      expect(writes()).toHaveLength(1);
    });

    it("waits through other people's writes, then writes the entry on the newest state", async () => {
      const local = await pickCat();
      // Another person's write lands, built on the entry without the pick: no stamp yet.
      act(() => {
        handlers.update?.(JSON.parse(JSON.stringify({ ...local, _rev: 2, finishedUsers: ['fran'] })));
      });
      expect(writes()).toEqual([]);
      // The wait over, the entry goes out, built on that newer state.
      act(() => { vi.advanceTimersByTime(SERVER_STAMP_WAIT_MS); });
      expect(writes()).toHaveLength(1);
      expect(writes()[0]).toMatchObject({ finishedUsers: ['fran'] });
      expect(writes()[0].participants?.find((p) => p.id === 'me')).toMatchObject({ avatar: 'cat', avatarAt: 300 });
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

  // The one-time hint that the avatar can be changed (AGENTS.md, *Avatars*):
  // a band under the header, and a dot on the opener while it shows.
  describe('the avatar hint', () => {
    const HINT = 'New: choose your avatar';
    const HINT_KEY = 'retro-avatar-hint-seen';
    const header = () => document.querySelector('header') as HTMLElement;
    const opener = () => header().querySelector('[data-viewer-avatar]') as HTMLElement;
    const dot = () => opener().querySelector('[data-avatar-hint-dot]');

    beforeEach(() => {
      localStorage.removeItem(HINT_KEY);
    });

    it('shows under the header to a viewer with no choice in a named session, the opener marked', () => {
      renderScreen(kind, team(undefined), sessionOf(kind));
      const note = screen.getByRole('note', { name: HINT });
      // After the header in reading order, outside it.
      expect(header().compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(header().contains(note)).toBe(false);
      expect(dot()).not.toBeNull();
      // The only pictures on the page are its samples: nobody here chose one.
      expect(pictures()).toEqual(['fox', 'rocket', 'moon']);
      expect([...document.querySelectorAll('[data-avatar-art]')].every((art) => note.contains(art))).toBe(true);
    });

    it('is not shown in an anonymous session, nor to a viewer who chose, a cleared choice included', () => {
      renderScreen(kind, team(undefined), anonymousOf(kind));
      expect(screen.queryByRole('note', { name: HINT })).toBeNull();
      expect(dot()).toBeNull();
      // Nothing of it reaches the page: an anonymous session draws no picture at all.
      expect(pictures()).toEqual([]);
      cleanup();
      renderScreen(kind, team({ me: { id: 'owl', at: 100 } }), sessionOf(kind));
      expect(screen.queryByRole('note', { name: HINT })).toBeNull();
      cleanup();
      renderScreen(kind, team({ me: { id: null, at: 100 } }), sessionOf(kind));
      expect(screen.queryByRole('note', { name: HINT })).toBeNull();
      expect(dot()).toBeNull();
    });

    it('goes, remembered, once the picker opens from the header, and does not come back', () => {
      renderScreen(kind, team(undefined), sessionOf(kind));
      fireEvent.click(screen.getByRole('button', { name: /choose my avatar/ }));
      expect(screen.getByRole('dialog', { name: 'Choose my avatar' })).toBeInTheDocument();
      expect(screen.queryByRole('note', { name: HINT })).toBeNull();
      expect(dot()).toBeNull();
      expect(JSON.parse(localStorage.getItem(HINT_KEY) ?? 'null')).toEqual(['me']);
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('note', { name: HINT })).toBeNull();
    });

    it("opens the picker from its own button, and Escape gives the focus to the header's avatar", async () => {
      const user = userEvent.setup();
      renderScreen(kind, team(undefined), sessionOf(kind));
      await user.click(screen.getByRole('button', { name: 'Choose my avatar' }));
      expect(await screen.findByRole('dialog', { name: 'Choose my avatar' })).toBeInTheDocument();
      expect(screen.queryByRole('note', { name: HINT })).toBeNull();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.activeElement).toBe(opener());
      expect(JSON.parse(localStorage.getItem(HINT_KEY) ?? 'null')).toEqual(['me']);
    });

    it("takes the opener's width: from 360px for a facilitator, at every width for a participant", () => {
      renderScreen(kind, team(undefined), sessionOf(kind), fran);
      const classes = (element: Element) => element.className.split(/\s+/);
      expect(classes(screen.getByRole('note', { name: HINT }))).toEqual(expect.arrayContaining(['hidden', 'min-[360px]:flex']));
      expect(classes(opener())).toEqual(expect.arrayContaining(['hidden', 'min-[360px]:flex']));
      cleanup();
      renderScreen(kind, team(undefined), sessionOf(kind));
      expect(classes(screen.getByRole('note', { name: HINT }))).not.toContain('hidden');
    });

    it('goes when the session turns anonymous, and stays gone when it names its authors again', () => {
      renderScreen(kind, team(undefined), sessionOf(kind));
      expect(screen.getByRole('note', { name: HINT })).toBeInTheDocument();
      act(() => { handlers.update?.(JSON.parse(JSON.stringify({ ...anonymousOf(kind), _rev: 5 }))); });
      expect(screen.queryByRole('note', { name: HINT })).toBeNull();
      act(() => { handlers.update?.(JSON.parse(JSON.stringify({ ...sessionOf(kind), _rev: 6 }))); });
      expect(screen.queryByRole('note', { name: HINT })).toBeNull();
      expect(dot()).toBeNull();
      // It was never dismissed: another screen shows it again.
      expect(localStorage.getItem(HINT_KEY)).toBeNull();
    });

    // "Got it" says the person has read it: remembered for this member in this
    // browser, so the next screen they open does not show it again.
    it('goes, remembered, when "Got it" is pressed, and a new mount of the screen shows none', async () => {
      const user = userEvent.setup();
      renderScreen(kind, team(undefined), sessionOf(kind));
      const note = screen.getByRole('note', { name: HINT });
      expect(dot()).not.toBeNull();

      await user.click(within(note).getByRole('button', { name: 'Got it' }));
      expect(screen.queryByRole('note', { name: HINT })).toBeNull();
      expect(dot()).toBeNull();
      expect(JSON.parse(localStorage.getItem(HINT_KEY) ?? 'null')).toEqual(['me']);
      cleanup();

      renderScreen(kind, team(undefined), sessionOf(kind));
      expect(screen.queryByRole('note', { name: HINT })).toBeNull();
      expect(dot()).toBeNull();
    });

    // A pick made in the person's other browser, open on the same session: the
    // server stamps their entry here, as it does for every pick that names the
    // session. The band goes in the render that draws the picture, never a
    // frame later, and nothing is written here: the choice is the server's,
    // and stops the hint in every browser.
    it('goes in the render that draws a choice made in another browser, and writes nothing', () => {
      const local = sessionOf(kind);
      // Every commit of the screen: a Profiler's onRender runs in the commit,
      // once the DOM is written, where the checks after act() see only the
      // last one. The band and the dot are never drawn beside the picture the
      // stamped entry brings.
      const drawnBeside: string[] = [];
      const Commits: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <React.Profiler
          id="screen"
          onRender={() => {
            if (!document.querySelector('header [data-viewer-avatar] [data-avatar-art="cat"]')) return;
            if (document.querySelector('[data-avatar-hint]')) drawnBeside.push('band');
            if (document.querySelector('[data-avatar-hint-dot]')) drawnBeside.push('dot');
          }}
        >
          {children}
        </React.Profiler>
      );
      renderScreen(kind, team(undefined), local, me, {}, { wrapper: Commits });
      expect(screen.getByRole('note', { name: HINT })).toBeInTheDocument();
      expect(dot()).not.toBeNull();

      act(() => {
        handlers.update?.(JSON.parse(JSON.stringify({ ...local, participants: [{ ...me, avatar: 'cat', avatarAt: 300 }, fran], _rev: 2 })));
      });
      expect(opener().querySelector('[data-avatar-art="cat"]')).not.toBeNull();
      expect(screen.queryByRole('note', { name: HINT })).toBeNull();
      expect(dot()).toBeNull();
      expect(drawnBeside).toEqual([]);
      expect(localStorage.getItem(HINT_KEY)).toBeNull();
    });

    // The server refused the join: the picker could not save a choice, so the
    // band goes and nothing brings it back while the screen lasts. It was
    // never dismissed, so it is not remembered.
    it('goes when the join is refused, unwritten, and stays gone afterwards', () => {
      const local = sessionOf(kind);
      renderScreen(kind, team(undefined), local);
      expect(screen.getByRole('note', { name: HINT })).toBeInTheDocument();
      expect(dot()).not.toBeNull();

      act(() => { handlers.denied?.({ sessionId: local.id, reason: 'unauthenticated' }); });
      // The connection banner says why, with the way out.
      expect(screen.getByRole('button', { name: 'Log in again' })).toBeInTheDocument();
      expect(screen.queryByRole('note', { name: HINT })).toBeNull();
      expect(dot()).toBeNull();

      // Afterwards: the connection drops and comes back. Neither screen forgets
      // a refused join today, and if one ever did, the hint would still stay
      // gone for the mount.
      act(() => { handlers.connection?.(false); });
      act(() => { handlers.connection?.(true); });
      expect(screen.queryByRole('note', { name: HINT })).toBeNull();
      expect(dot()).toBeNull();
      expect(localStorage.getItem(HINT_KEY)).toBeNull();
    });

    // The team's password was changed under the session: the picker could
    // not save a choice, so the band goes. Another tab's new token clears the
    // revocation, the session is live again, and the band stays gone: nothing
    // brings it back while the screen lasts. It was never dismissed, so it is
    // not remembered.
    it("goes when the credential is revoked, unwritten, and stays gone once another tab's token clears the revocation", () => {
      onTestFinished(clearSessionRevoked);
      renderScreen(kind, team(undefined), sessionOf(kind));
      expect(screen.getByRole('note', { name: HINT })).toBeInTheDocument();
      expect(dot()).not.toBeNull();

      act(() => { markSessionRevoked(); });
      // The connection banner says why, with the way out.
      expect(screen.getByRole('button', { name: 'Log in again' })).toBeInTheDocument();
      expect(screen.queryByRole('note', { name: HINT })).toBeNull();
      expect(dot()).toBeNull();

      act(() => { clearSessionRevoked(); });
      expect(screen.queryByRole('button', { name: 'Log in again' })).toBeNull();
      expect(screen.queryByRole('note', { name: HINT })).toBeNull();
      expect(dot()).toBeNull();
      expect(localStorage.getItem(HINT_KEY)).toBeNull();
    });

    // A key's "Got it" hands the keyboard on to the first drawn control after
    // the band. jsdom applies no stylesheet, so that is the phase's own first
    // control: the Brainstorm bar's "I'm Finished" in a retrospective, the
    // survey's first score in a health check.
    it('hands the keyboard to the first control after the band when a key presses "Got it", and is remembered', () => {
      renderScreen(kind, team(undefined), sessionOf(kind));
      const note = screen.getByRole('note', { name: HINT });
      const gotIt = within(note).getByRole('button', { name: 'Got it' });
      act(() => { gotIt.focus(); });
      // A key's click: Enter or Space sends one with no count.
      fireEvent.click(gotIt, { detail: 0 });
      expect(screen.queryByRole('note', { name: HINT })).toBeNull();
      expect(dot()).toBeNull();
      expect(JSON.parse(localStorage.getItem(HINT_KEY) ?? 'null')).toEqual(['me']);
      const firstAfterTheBand = kind === 'retro'
        ? screen.getByRole('button', { name: "I'm Finished" })
        : within(screen.getByRole('heading', { name: 'Communication' }).parentElement as HTMLElement).getByRole('button', { name: '1' });
      expect(firstAfterTheBand).toHaveFocus();
    });

    // Left with neither of its buttons pressed nor the picker opened, the band
    // is not remembered: the next screen the person opens shows it again.
    it('is shown again at the next mount when the screen is left without a gesture', () => {
      const first = renderScreen(kind, team(undefined), sessionOf(kind));
      expect(screen.getByRole('note', { name: HINT })).toBeInTheDocument();
      first.unmount();
      expect(localStorage.getItem(HINT_KEY)).toBeNull();

      renderScreen(kind, team(undefined), sessionOf(kind));
      expect(screen.getByRole('note', { name: HINT })).toBeInTheDocument();
      expect(dot()).not.toBeNull();
    });
  });
});
