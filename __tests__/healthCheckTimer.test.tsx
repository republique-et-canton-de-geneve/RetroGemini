import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import HealthCheckSession from '../components/HealthCheckSession';
import { HealthCheckSession as HealthCheckSessionType, HealthCheckSettings, Team, User } from '../types';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';

/**
 * Health checks run the retrospective's countdown — the same `SessionTimer`,
 * the same helpers — rendered by the real `HealthCheckSession` here, so what
 * is pinned is the wiring: the header shows it, the facilitator's gestures and
 * phase changes reach the session through its single write path, and a health
 * check stored before the timer existed works without anyone writing on its
 * behalf.
 *
 * That last point is a server rule, not a nicety: `sessionGuard.js` refuses a
 * participant's write that changes `settings.timerInitial`, so a participant
 * client that "repaired" a legacy record by seeding the timer fields would
 * have every write it makes — ratings included — refused.
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

const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);

const facilitator: User = { id: 'fac', name: 'Fran', color: 'bg-indigo-500', role: 'facilitator' };
const alice: User = { id: 'a', name: 'Alice', color: 'bg-rose-500', role: 'participant' };

// No timer field at all: a health check stored before health checks had one.
const legacySettings = (): HealthCheckSettings => ({ isAnonymous: false, revealRoti: false, showParticipantVotes: false });

const createSession = (overrides: Partial<HealthCheckSessionType> = {}): HealthCheckSessionType => ({
  id: 'hc-1',
  teamId: 'team-1',
  name: 'Health Check R2606',
  date: '11/06/2026',
  status: 'IN_PROGRESS',
  phase: 'SURVEY',
  templateId: 'team_health_fr',
  templateName: 'Bilan de santé (FR)',
  dimensions: [{ id: 'd1', name: 'Autonomie', goodDescription: 'Good', badDescription: 'Bad' }],
  participants: [facilitator, alice],
  settings: legacySettings(),
  ratings: { fac: { d1: { rating: 5 } } },
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

const renderSession = (session: HealthCheckSessionType, user: User = facilitator) => {
  const team = createTeam(session);
  vi.mocked(dataService.getTeam).mockReturnValue(team);
  vi.mocked(dataService.getHealthCheck).mockReturnValue(session);
  vi.mocked(syncService.getCurrentSessionId).mockReturnValue(session.id);
  return render(<HealthCheckSession team={team} currentUser={user} sessionId={session.id} onExit={vi.fn()} />);
};

/** Every session the component persisted, in order. */
const writes = (): HealthCheckSessionType[] =>
  vi.mocked(dataService.updateHealthCheckSession).mock.calls.map(([, written]) => written);

/** Every session the component broadcast, in order. */
const synced = (): HealthCheckSessionType[] =>
  vi.mocked(syncService.updateSession).mock.calls.map(([sent]) => sent as HealthCheckSessionType);

/** The time: one `span.font-mono.font-bold.text-lg`, the element the e2e suite reads. */
const display = (): HTMLElement => {
  const faces = document.querySelectorAll('span.font-mono.font-bold.text-lg');
  expect(faces).toHaveLength(1);
  return faces[0] as HTMLElement;
};

const tick = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

let play: MockInstance<HTMLMediaElement['play']>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  // jsdom does not implement media playback, and an expiry plays the alarm.
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn()
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  play.mockRestore();
});

describe('Health check timer — a health check stored before it had one', () => {
  it('shows the facilitator the Survey timebox, ready to start', () => {
    // Guards: a legacy record (no timer fields) showing no timer, 0:00, NaN or
    // the retrospective's 5:00 instead of the Survey's 7:00.
    renderSession(createSession());

    expect(display()).toHaveTextContent('7:00');
    expect(screen.getByRole('button', { name: 'Start timer' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Set the timer (7:00)' })).toContainElement(display());
  });

  it('shows a participant the time and no control', () => {
    // Guards: the facilitator's controls reaching a participant, whose
    // timerInitial writes the server refuses.
    renderSession(createSession(), alice);

    expect(display()).toHaveTextContent('7:00');
    expect(display().closest('button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start timer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set the timer/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+30s' })).not.toBeInTheDocument();
  });

  it('writes nothing for the facilitator just by opening it', () => {
    // Guards: the phase default being written back on the reader's behalf
    // (a mount-time "repair" of the missing timer fields).
    const session = createSession();
    renderSession(session);
    tick(3000);

    expect(dataService.updateHealthCheckSession).not.toHaveBeenCalled();
    // The facilitator re-broadcasts the session it opened (presence), as it
    // was stored: no timer field is added to it.
    for (const sent of synced()) {
      expect(sent.settings).toEqual(legacySettings());
    }
  });

  it('writes nothing for a participant just by opening it', () => {
    // Guards: the same repair on a participant's client, where it would also
    // be refused by the server as a timerInitial change.
    renderSession(createSession(), alice);
    tick(3000);

    expect(dataService.updateHealthCheckSession).not.toHaveBeenCalled();
    expect(syncService.updateSession).not.toHaveBeenCalled();
    expect(display()).toHaveTextContent('7:00');
  });

  it('never gains timer fields from a participant rating a dimension', () => {
    // Guards: the participant's ordinary writes carrying a seeded timerInitial
    // — the server would refuse the rating along with it.
    renderSession(createSession(), alice);

    fireEvent.click(screen.getByRole('button', { name: '4' }));
    tick(3000);

    expect(writes()).toHaveLength(1);
    expect(writes()[0].ratings.a).toEqual({ d1: { rating: 4 } });
    for (const written of [...writes(), ...synced()]) {
      expect(written.settings).toEqual(legacySettings());
      expect(written.settings).not.toHaveProperty('timerInitial');
    }
  });
});

describe('Health check timer — the facilitator runs it', () => {
  it('starts in one write stamped with the run, broadcast as written', () => {
    // Guards: the health check's onUpdate not reaching its updateSession, a
    // start written in two writes, or a start that does not stamp the run.
    renderSession(createSession());

    fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));

    expect(writes()).toHaveLength(1);
    const [written] = writes();
    expect(written.phase).toBe('SURVEY');
    expect(written.settings).toEqual({
      ...legacySettings(),
      timerRunning: true,
      timerStartedAt: T0,
      timerInitial: 420,
      timerSeconds: 420,
      timerAcknowledged: false
    });
    expect(syncService.updateSession).toHaveBeenCalledWith(written);
    expect(synced().at(-1)?.settings).toEqual(written.settings);
  });

  it('counts down from the start without writing per tick', () => {
    // Guards: a display that does not tick inside the health check, or a
    // write per second (every client derives the time from the start).
    renderSession(createSession());
    fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));

    tick(5000);
    expect(display()).toHaveTextContent('6:55');
    tick(60_000);
    expect(display()).toHaveTextContent('5:55');
    expect(screen.getByRole('button', { name: 'Pause timer' })).toBeInTheDocument();
    expect(writes()).toHaveLength(1);
  });

  it('stops a running timer at the next phase timebox in the phase write itself', () => {
    // Guards: setPhase not resetting the timer (a 7-minute Survey run would
    // keep counting into Discuss), or resetting it in a second write that the
    // server refuses as stale.
    renderSession(createSession());
    fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
    tick(10_000);
    vi.mocked(dataService.updateHealthCheckSession).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Next: Discuss' }));

    expect(writes()).toHaveLength(1);
    const [moved] = writes();
    expect(moved.phase).toBe('DISCUSS');
    expect(moved.settings).toMatchObject({
      timerRunning: false,
      timerSeconds: 480,
      timerInitial: 480,
      timerAcknowledged: false
    });
    expect(moved.settings.timerStartedAt).toBeUndefined();
    expect(display()).toHaveTextContent('8:00');
    expect(screen.getByRole('button', { name: 'Start timer' })).toBeInTheDocument();
    tick(5000);
    expect(display()).toHaveTextContent('8:00');
  });

  it.each([
    ['REVIEW', 180, '3:00'],
    ['DISCUSS', 480, '8:00'],
    ['CLOSE', 180, '3:00']
  ] as const)('sets the timer to the %s timebox when the phase bar opens it', (phase, seconds, shown) => {
    // Guards: a health-check phase taking the retrospective's timebox for the
    // phase id they share (DISCUSS, REVIEW, CLOSE), or the default of the
    // phase being left.
    renderSession(createSession());

    fireEvent.click(screen.getByRole('button', { name: phase }));

    expect(writes()).toHaveLength(1);
    expect(writes()[0].phase).toBe(phase);
    expect(writes()[0].settings).toMatchObject({
      timerRunning: false,
      timerSeconds: seconds,
      timerInitial: seconds,
      timerAcknowledged: false
    });
    expect(display()).toHaveTextContent(shown);
  });

  it('brings the Survey timebox back when the phase bar returns to Survey', () => {
    // Guards: the Survey default lost once the record carries timer fields
    // written for another phase.
    renderSession(createSession({ phase: 'REVIEW', settings: { ...legacySettings(), timerSeconds: 180, timerInitial: 180, timerRunning: false } }));
    expect(display()).toHaveTextContent('3:00');

    fireEvent.click(screen.getByRole('button', { name: 'SURVEY' }));

    expect(writes()).toHaveLength(1);
    expect(writes()[0].settings).toMatchObject({ timerSeconds: 420, timerInitial: 420, timerRunning: false });
    expect(display()).toHaveTextContent('7:00');
  });
});

describe('Health check timer — a participant watching a run end', () => {
  const runningFor = (seconds: number): HealthCheckSettings => ({
    ...legacySettings(),
    timerRunning: true,
    timerStartedAt: T0,
    timerInitial: seconds,
    timerSeconds: seconds,
    timerAcknowledged: false
  });

  it('writes the expiry once without touching timerInitial, then silences it for everyone', () => {
    // Guards: a participant's expiry or acknowledgement changing timerInitial
    // (the server refuses the write), an expiry written per tick, and an alarm
    // sounded more than once for one run.
    renderSession(createSession({ settings: runningFor(3) }), alice);
    expect(display()).toHaveTextContent('0:03');

    tick(3000);

    expect(writes()).toHaveLength(1);
    expect(writes()[0].settings).toEqual({
      ...runningFor(3),
      timerRunning: false,
      timerSeconds: 0
    });
    expect(play).toHaveBeenCalledTimes(1);
    tick(5000);
    expect(writes()).toHaveLength(1);
    expect(play).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Time is up (0:00): stop the alarm' }));

    expect(writes()).toHaveLength(2);
    expect(writes()[1].settings).toMatchObject({
      timerAcknowledged: true,
      timerSeconds: 3,
      timerInitial: 3,
      timerRunning: false
    });
    expect(display()).toHaveTextContent('0:03');
    expect(display().closest('button')).toBeNull();
  });
});

describe('Health check timer — rendered once', () => {
  it.each(['SURVEY', 'DISCUSS', 'REVIEW', 'CLOSE'] as const)('shows one time display in %s', (phase) => {
    // Guards: a second timer face (a copy in the phase view, or one per
    // header breakpoint) that the e2e suite's single-element read would trip on.
    renderSession(createSession({ phase }));

    expect(document.querySelectorAll('span.font-mono.font-bold.text-lg')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^(Start|Pause) timer$/ })).toHaveLength(1);
  });

  it('shows one time display to a participant', () => {
    renderSession(createSession(), alice);

    expect(document.querySelectorAll('span.font-mono.font-bold.text-lg')).toHaveLength(1);
  });
});
