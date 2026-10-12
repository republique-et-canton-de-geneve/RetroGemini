import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Session from '../components/Session';
import HealthCheckSession from '../components/HealthCheckSession';
import { syncService } from '../services/syncService';
import type { HealthCheckSession as HealthCheckSessionType, RetroSession, Team, User } from '../types';

/**
 * Incident ISS (2026-10-12), "tickets disappear one by one" — the session
 * screens' half of the fix, pinned for the retrospective and the health check
 * alike (a behaviour both have is written once and lands in both).
 *
 * - **The server's record is the authority for facilitator-only fields.** Both
 *   screens replaced the name of every incoming session with the one in the
 *   local team record. After a rename on the Dashboard a participant's cache
 *   kept the old name, so every write it sent carried a facilitator-only change
 *   the server refused — with the participant's cards in it.
 * - **A stalled client does not let its own work expire.** Each card stayed
 *   unconfirmed, and the 60 s pending-creation TTL removed it while refusals
 *   were still arriving. The hold is for a stall only: an ordinary lost race
 *   is refused too, and holding on every refusal kept every claim of a busy
 *   room alive for good — the TTL the own-change ledger relies on to end a
 *   two-browser disagreement never ran out.
 * - **A refused client backs off** instead of re-sending ~3x a second, and
 *   its re-sends say they are re-sends: syncService counts those, and only
 *   those, toward the stall and the backoff.
 * - **The join is requested before the socket connects**, so no write can
 *   reach a socket that has joined nothing.
 * - **A roster that changes nothing writes nothing**, nor does a
 *   `member-joined` for someone already listed.
 * - **The not-saved banner** is on both screens.
 * - **A health-check proposal survives a lost race**, as a retro card does.
 */

type Health = 'ok' | 'stalled';

const handlers: {
  update: ((session: unknown) => void) | null;
  roster: ((roster: { id: string; name: string }[]) => void) | null;
  refused: ((refusal: { sessionId: string | null; reason: string }) => void) | null;
  joined: ((member: { userId: string; userName: string }) => void) | null;
} = { update: null, roster: null, refused: null, joined: null };

// Every subscriber, not the last one: the screen, the not-saved banner and the
// header chip all listen to the health.
const healthListeners = new Set<(health: Health) => void>();

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(() => null),
    getHealthCheck: vi.fn(() => null),
    updateSession: vi.fn(),
    updateHealthCheckSession: vi.fn(),
    persistParticipants: vi.fn(),
    applyRemoteSession: vi.fn(),
    applyRemoteHealthCheckSession: vi.fn(),
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
    onMemberJoined: vi.fn((callback: (member: { userId: string; userName: string }) => void) => {
      handlers.joined = callback;
      return () => {};
    }),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn((callback: (roster: { id: string; name: string }[]) => void) => {
      handlers.roster = callback;
      return () => {};
    }),
    onActivity: vi.fn(() => () => {}),
    sendActivity: vi.fn(),
    onConnectionChange: vi.fn(() => () => {}),
    onJoinDenied: vi.fn(() => () => {}),
    onUpdateRefused: vi.fn((callback: (refusal: { sessionId: string | null; reason: string }) => void) => {
      handlers.refused = callback;
      return () => {};
    }),
    onSyncHealth: vi.fn((callback: (health: Health) => void) => {
      healthListeners.add(callback);
      return () => { healthListeners.delete(callback); };
    }),
    getSyncHealth: vi.fn(() => 'ok'),
    getResendDelayMs: vi.fn(() => 0),
    isConnected: vi.fn(() => true),
  },
}));

const me: User = { id: 'me', name: 'Mine', color: 'bg-indigo-500', role: 'participant' };
const facilitator: User = { id: 'fac', name: 'Fran', color: 'bg-rose-500', role: 'facilitator' };

const retro = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Sprint 12',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  participants: [me, facilitator],
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
    revealBrainstorm: false,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0,
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  _rev: 1,
  ...overrides,
});

const healthCheck = (overrides: Partial<HealthCheckSessionType> = {}): HealthCheckSessionType => ({
  id: 'hc-1',
  teamId: 'team-1',
  name: 'Q3 health',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'SURVEY',
  templateId: 'template-1',
  templateName: 'Team Health',
  dimensions: [{
    id: 'dim-1',
    name: 'Communication',
    goodDescription: 'People collaborate well',
    badDescription: 'People work in silos',
  }],
  participants: [me, facilitator],
  settings: { isAnonymous: false, revealRoti: false, showParticipantVotes: false },
  ratings: {},
  actions: [],
  roti: {},
  finishedUsers: [],
  _rev: 1,
  ...overrides,
});

const team = (overrides: Partial<Team> = {}): Team => ({
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [me, facilitator],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  healthChecks: [],
  ...overrides,
});

const renderRetro = (local: RetroSession, user: User = me) => {
  vi.mocked(syncService.getCurrentSessionId).mockReturnValue(local.id);
  return render(
    <Session team={team({ retrospectives: [local] })} sessionId={local.id} currentUser={user} onExit={() => {}} />
  );
};

const renderHealthCheck = (local: HealthCheckSessionType, user: User = me) => {
  vi.mocked(syncService.getCurrentSessionId).mockReturnValue(local.id);
  return render(
    <HealthCheckSession team={team({ healthChecks: [local] })} sessionId={local.id} currentUser={user} onExit={() => {}} />
  );
};

const deliver = (state: unknown) => act(() => { handlers.update?.(JSON.parse(JSON.stringify(state))); });
const refuse = (sessionId: string) => act(() => { handlers.refused?.({ sessionId, reason: 'protected-fields' }); });
const deliverRoster = (roster: { id: string; name: string }[]) => act(() => { handlers.roster?.(roster); });
const memberJoins = (userId: string, userName: string) => act(() => { handlers.joined?.({ userId, userName }); });
// What syncService does on a stall: the value first, then every subscriber.
const setHealth = (health: Health) => act(() => {
  vi.mocked(syncService.getSyncHealth).mockReturnValue(health);
  healthListeners.forEach((listener) => listener(health));
});

const writes = <S,>() => vi.mocked(syncService.updateSession).mock.calls.map(([blob]) => blob as unknown as S);
const lastWrite = <S,>() => writes<S>()[writes<S>().length - 1];
const lastWriteOptions = () => vi.mocked(syncService.updateSession).mock.calls.at(-1)?.[1];

const addCard = (text: string) => {
  const field = screen.getByPlaceholderText('Add an idea...');
  fireEvent.change(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: 'Enter' });
};

const rate = (value: number) => fireEvent.click(screen.getByRole('button', { name: String(value) }));
const isSelected = (value: number) => screen.getByRole('button', { name: String(value) }).className.includes('bg-retro-primary');

describe('session sync wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.update = null;
    handlers.roster = null;
    handlers.refused = null;
    handlers.joined = null;
    healthListeners.clear();
    vi.mocked(syncService.connect).mockImplementation(() => Promise.resolve());
    vi.mocked(syncService.getSyncHealth).mockReturnValue('ok');
    vi.mocked(syncService.getResendDelayMs).mockReturnValue(0);
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('the server is the authority for the session name', () => {
    it('retro: a participant whose team record predates a rename writes the server name with its card', () => {
      renderRetro(retro({ name: 'Old name' }));
      deliver(retro({ name: 'Renamed on the Dashboard', _rev: 3 }));

      addCard('Ship smaller');

      const sent = lastWrite<RetroSession>();
      expect(sent.tickets.map((t) => t.text)).toEqual(['Ship smaller']);
      expect(sent.name).toBe('Renamed on the Dashboard');
    });

    it('health check: a participant whose team record predates a rename writes the server name with its rating', () => {
      renderHealthCheck(healthCheck({ name: 'Old name' }));
      deliver(healthCheck({ name: 'Renamed on the Dashboard', _rev: 3 }));

      rate(4);

      const sent = lastWrite<HealthCheckSessionType>();
      expect(sent.ratings.me?.['dim-1']?.rating).toBe(4);
      expect(sent.name).toBe('Renamed on the Dashboard');
    });
  });

  describe('the join is requested before the socket connects', () => {
    it('retro', () => {
      vi.mocked(syncService.connect).mockReturnValue(new Promise(() => {}));
      renderRetro(retro());

      expect(syncService.joinSession).toHaveBeenCalledWith('retro-1', me.id, me.name);
    });

    it('health check', () => {
      vi.mocked(syncService.connect).mockReturnValue(new Promise(() => {}));
      renderHealthCheck(healthCheck());

      expect(syncService.joinSession).toHaveBeenCalledWith('hc-1', me.id, me.name);
    });
  });

  describe('own work outlives the TTL while sync is stalled', () => {
    const T0 = new Date('2026-10-12T09:00:00Z').getTime();

    it('retro: a card written before the stall stays while refusals continue, and until they stop for a minute', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      vi.mocked(syncService.getSyncHealth).mockReturnValue('stalled');
      renderRetro(retro());
      deliver(retro());
      addCard('Do not lose me');

      // Every heal is the server's state without the card: it refused the write.
      vi.setSystemTime(T0 + 50_000);
      refuse('retro-1');
      deliver(retro());
      expect(screen.getByText('Do not lose me')).toBeTruthy();

      // Past the 60 s TTL, refusals still arriving: the card must stay.
      vi.setSystemTime(T0 + 100_000);
      refuse('retro-1');
      deliver(retro());
      expect(screen.getByText('Do not lose me')).toBeTruthy();

      // Refusals stopped; a minute after the last one the TTL bounds it again.
      vi.setSystemTime(T0 + 170_000);
      deliver(retro());
      expect(screen.queryByText('Do not lose me')).toBeNull();
    });

    it('health check: a rating made before the stall stays while refusals continue', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      vi.mocked(syncService.getSyncHealth).mockReturnValue('stalled');
      renderHealthCheck(healthCheck());
      deliver(healthCheck());
      rate(2);

      vi.setSystemTime(T0 + 50_000);
      refuse('hc-1');
      deliver(healthCheck());
      expect(isSelected(2)).toBe(true);

      vi.setSystemTime(T0 + 100_000);
      refuse('hc-1');
      deliver(healthCheck());
      expect(isSelected(2)).toBe(true);
    });

    // A stall needs ten seconds of re-sends, so whatever was written before it
    // began still has most of its TTL left when it does: the transition itself
    // holds it, with no refusal needed.
    it('retro: the moment sync stalls holds what is unconfirmed, without waiting for a refusal', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      renderRetro(retro());
      deliver(retro());
      addCard('Held at the stall');

      vi.setSystemTime(T0 + 50_000);
      setHealth('stalled');

      vi.setSystemTime(T0 + 100_000);
      deliver(retro());
      expect(screen.getByText('Held at the stall')).toBeTruthy();

      // Held once, for a minute: nothing extends it after that.
      vi.setSystemTime(T0 + 111_000);
      deliver(retro());
      expect(screen.queryByText('Held at the stall')).toBeNull();
    });

    it('health check: the moment sync stalls holds an unconfirmed rating', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      renderHealthCheck(healthCheck());
      deliver(healthCheck());
      rate(3);

      vi.setSystemTime(T0 + 50_000);
      setHealth('stalled');

      vi.setSystemTime(T0 + 100_000);
      deliver(healthCheck());
      expect(isSelected(3)).toBe(true);
    });
  });

  // A refusal on its own is an ordinary lost race: every client writes the
  // timer expiry and the leftUsers clear at the same instant, and all but one
  // are refused. Holding on each one kept every claim of a busy room alive for
  // as long as the room was busy — and the TTL is what ends a disagreement
  // between two browsers of one participant that the ledger cannot settle.
  describe('refusals while sync is healthy leave the TTL alone', () => {
    const T0 = new Date('2026-10-12T09:00:00Z').getTime();

    it('retro: an unconfirmed card still expires a minute after it was written', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      renderRetro(retro());
      deliver(retro());
      addCard('Lost a race');

      vi.setSystemTime(T0 + 50_000);
      refuse('retro-1');
      deliver(retro());
      expect(screen.getByText('Lost a race')).toBeTruthy();

      vi.setSystemTime(T0 + 61_000);
      refuse('retro-1');
      deliver(retro());
      expect(screen.queryByText('Lost a race')).toBeNull();
    });

    it('health check: an unconfirmed rating claim still expires, and the server is taken at its word', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      renderHealthCheck(healthCheck());
      deliver(healthCheck());
      rate(2);

      vi.setSystemTime(T0 + 50_000);
      refuse('hc-1');

      vi.setSystemTime(T0 + 61_000);
      refuse('hc-1');
      deliver(healthCheck());
      expect(isSelected(2)).toBe(false);
    });
  });

  describe('a client under a refusal streak re-sends with the backoff syncService asks for', () => {
    it('retro', () => {
      vi.useFakeTimers();
      vi.mocked(syncService.getResendDelayMs).mockReturnValue(4_000);
      renderRetro(retro());
      deliver(retro());
      addCard('Back off');
      // The user's own write is not a re-send: it must not count toward a stall.
      expect(lastWriteOptions()).toBeUndefined();
      const before = writes().length;

      deliver(retro()); // healed away: the merge re-asserts the card and re-sends
      act(() => { vi.advanceTimersByTime(1_000); });
      expect(writes().length).toBe(before);

      act(() => { vi.advanceTimersByTime(3_500); });
      expect(writes().length).toBe(before + 1);
      expect(lastWrite<RetroSession>().tickets.map((t) => t.text)).toEqual(['Back off']);
      // Marked, so syncService counts it toward the stall and the backoff.
      expect(lastWriteOptions()).toEqual({ resend: true });
    });

    it('health check', () => {
      vi.useFakeTimers();
      vi.mocked(syncService.getResendDelayMs).mockReturnValue(4_000);
      renderHealthCheck(healthCheck());
      deliver(healthCheck());
      rate(5);
      expect(lastWriteOptions()).toBeUndefined();
      const before = writes().length;

      deliver(healthCheck());
      act(() => { vi.advanceTimersByTime(1_000); });
      expect(writes().length).toBe(before);

      act(() => { vi.advanceTimersByTime(3_500); });
      expect(writes().length).toBe(before + 1);
      expect(lastWrite<HealthCheckSessionType>().ratings.me?.['dim-1']?.rating).toBe(5);
      expect(lastWriteOptions()).toEqual({ resend: true });
    });
  });

  describe('a health-check proposal survives a lost race, as a retro card does', () => {
    const discussing = (overrides: Partial<HealthCheckSessionType> = {}) =>
      healthCheck({ phase: 'DISCUSS', discussionFocusId: 'dim-1', ...overrides });

    const propose = (text: string) => {
      const field = screen.getByPlaceholderText('Propose an action...');
      fireEvent.change(field, { target: { value: text } });
      fireEvent.keyDown(field, { key: 'Enter' });
    };

    it('keeps a proposal the heal does not know, and re-sends it', () => {
      vi.useFakeTimers();
      renderHealthCheck(discussing());
      deliver(discussing());
      propose('Pair on deploys');
      // The field was cleared: the screen is the only copy of the text.
      expect((screen.getByPlaceholderText('Propose an action...') as HTMLInputElement).value).toBe('');
      const before = writes().length;

      deliver(discussing({ _rev: 2 })); // another write won; ours was refused
      expect(screen.getByText('Pair on deploys')).toBeTruthy();

      act(() => { vi.advanceTimersByTime(500); });
      expect(writes().length).toBe(before + 1);
      expect(lastWrite<HealthCheckSessionType>().actions.map((a) => a.text)).toEqual(['Pair on deploys']);
      expect(lastWriteOptions()).toEqual({ resend: true });
    });

    it('takes the server copy once it has the proposal, and stops re-sending it', () => {
      vi.useFakeTimers();
      renderHealthCheck(discussing());
      deliver(discussing());
      propose('Pair on deploys');
      const written = lastWrite<HealthCheckSessionType>();
      const before = writes().length;

      deliver({ ...written, _rev: 2 });
      deliver(discussing({ _rev: 3 })); // the facilitator deleted it since

      act(() => { vi.advanceTimersByTime(500); });
      expect(screen.queryByText('Pair on deploys')).toBeNull();
      expect(writes().length).toBe(before);
    });
  });

  describe('a member-joined for someone already listed writes nothing', () => {
    const late: User = { id: 'late', name: 'Lou', color: 'bg-cyan-500', role: 'participant' };

    // The handler is subscribed once, at mount, and used to read the session it
    // was mounted with: anyone who joined after that was "missing" for good,
    // and every reconnect of theirs wrote the whole session again.
    it('retro', () => {
      renderRetro(retro());
      deliver(retro({ participants: [me, facilitator, late], _rev: 2 }));
      const before = writes().length;

      memberJoins('late', 'Lou');
      memberJoins('fac', 'Fran');
      expect(writes().length).toBe(before);

      // A newcomer is still written, once.
      memberJoins('new', 'Newcomer');
      memberJoins('new', 'Newcomer');
      expect(writes().length).toBe(before + 1);
      expect(lastWrite<RetroSession>().participants?.map((p) => p.id)).toEqual(['me', 'fac', 'late', 'new']);
    });

    it('health check', () => {
      renderHealthCheck(healthCheck());
      deliver(healthCheck({ participants: [me, facilitator, late], _rev: 2 }));
      const before = writes().length;

      memberJoins('late', 'Lou');
      memberJoins('fac', 'Fran');
      expect(writes().length).toBe(before);

      memberJoins('new', 'Newcomer');
      memberJoins('new', 'Newcomer');
      expect(writes().length).toBe(before + 1);
      expect(lastWrite<HealthCheckSessionType>().participants?.map((p) => p.id)).toEqual(['me', 'fac', 'late', 'new']);
    });

    it('retro: someone listed and marked as left is brought back in one write', () => {
      renderRetro(retro());
      deliver(retro({ participants: [me, facilitator, late], leftUsers: ['late'], _rev: 2 }));
      const before = writes().length;

      memberJoins('late', 'Lou');

      expect(writes().length).toBe(before + 1);
      expect(lastWrite<RetroSession>().leftUsers).toEqual([]);
      expect(lastWrite<RetroSession>().participants?.map((p) => p.id)).toEqual(['me', 'fac', 'late']);
    });
  });

  describe('a roster that changes nothing writes nothing', () => {
    it('retro', () => {
      renderRetro(retro());
      deliver(retro());
      const before = writes().length;

      deliverRoster([{ id: 'me', name: 'Mine' }, { id: 'fac', name: 'Fran' }]);
      deliverRoster([{ id: 'me', name: 'Mine' }, { id: 'fac', name: 'Fran' }]);
      expect(writes().length).toBe(before);

      // A newcomer is still written, once.
      deliverRoster([{ id: 'me', name: 'Mine' }, { id: 'fac', name: 'Fran' }, { id: 'new', name: 'Newcomer' }]);
      deliverRoster([{ id: 'me', name: 'Mine' }, { id: 'fac', name: 'Fran' }, { id: 'new', name: 'Newcomer' }]);
      expect(writes().length).toBe(before + 1);
      expect(lastWrite<RetroSession>().participants?.map((p) => p.id)).toEqual(['me', 'fac', 'new']);
    });

    it('health check', () => {
      renderHealthCheck(healthCheck());
      deliver(healthCheck());
      const before = writes().length;

      deliverRoster([{ id: 'me', name: 'Mine' }, { id: 'fac', name: 'Fran' }]);
      deliverRoster([{ id: 'me', name: 'Mine' }, { id: 'fac', name: 'Fran' }]);
      expect(writes().length).toBe(before);

      deliverRoster([{ id: 'me', name: 'Mine' }, { id: 'fac', name: 'Fran' }, { id: 'new', name: 'Newcomer' }]);
      deliverRoster([{ id: 'me', name: 'Mine' }, { id: 'fac', name: 'Fran' }, { id: 'new', name: 'Newcomer' }]);
      expect(writes().length).toBe(before + 1);
      expect(lastWrite<HealthCheckSessionType>().participants?.map((p) => p.id)).toEqual(['me', 'fac', 'new']);
    });
  });

  describe('the not-saved banner is on both session screens', () => {
    it('retro', () => {
      vi.mocked(syncService.getSyncHealth).mockReturnValue('stalled');
      renderRetro(retro());

      expect(screen.getByRole('alert').textContent).toContain('Your changes are not being saved.');
    });

    it('health check', () => {
      vi.mocked(syncService.getSyncHealth).mockReturnValue('stalled');
      renderHealthCheck(healthCheck());

      expect(screen.getByRole('alert').textContent).toContain('Your changes are not being saved.');
    });
  });

  // Review finding G: the banner said nothing was being saved while the header
  // chip above it pulsed a green "Live". Both headers, one rule — and the
  // stalled chip does not step aside on a phone the way "Live" does.
  describe('the header chip agrees with the banner on both session screens', () => {
    const hiddenOnPhones = (element: HTMLElement) => {
      for (let node: HTMLElement | null = element; node && node.tagName !== 'HEADER'; node = node.parentElement) {
        if (node.classList.contains('hidden')) return true;
      }
      return false;
    };

    it('retro', () => {
      renderRetro(retro());
      expect(screen.getByText('Live')).toBeTruthy();

      setHealth('stalled');

      expect(screen.queryByText('Live')).toBeNull();
      const chip = screen.getByTitle('Your changes are not being saved.');
      expect(chip.textContent).toContain('Not saving');
      expect(hiddenOnPhones(chip)).toBe(false);
    });

    it('health check', () => {
      renderHealthCheck(healthCheck());
      expect(screen.getByText('Live')).toBeTruthy();

      setHealth('stalled');

      expect(screen.queryByText('Live')).toBeNull();
      const chip = screen.getByTitle('Your changes are not being saved.');
      expect(chip.textContent).toContain('Not saving');
      expect(hiddenOnPhones(chip)).toBe(false);
    });
  });
});
