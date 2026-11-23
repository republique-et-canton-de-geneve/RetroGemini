import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import Session from '../components/Session';
import HealthCheckSession from '../components/HealthCheckSession';
import { HealthCheckSession as HealthCheckSessionType, RetroSession, Team, User } from '../types';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';
import { prefersMotion, restoreMotionPreference } from './helpers/motionPreference';

/**
 * When the facilitator brings a topic into focus in Discuss, both session
 * screens scroll it into view for everyone. That scroll is motion: it glides
 * the page for a reader who did not ask for less, and takes one who did there
 * at once, as every effect does (`motionAllowed()`, the rule of
 * components/common/motion/effects.ts). It used to glide for everyone: a
 * smooth scroll has no media query to stop it.
 * `__tests__/reducedMotionGate.test.ts` holds the shape of every smooth scroll
 * of the code; this holds the two screens that perform one.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(),
    getHealthCheck: vi.fn(),
    updateSession: vi.fn(),
    updateHealthCheckSession: vi.fn(),
    persistParticipants: vi.fn(),
    applyRemoteSession: vi.fn(),
    applyRemoteHealthCheckSession: vi.fn(),
    getSessionToken: vi.fn(() => null),
    getAuthenticatedPassword: vi.fn(() => null),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn(),
  },
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    leaveSession: vi.fn(),
    updateSession: vi.fn(),
    getCurrentSessionId: vi.fn(),
    onSessionUpdate: vi.fn(() => () => {}),
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

const facilitator: User = { id: 'fac', name: 'Fiona', color: 'bg-indigo-500', role: 'facilitator' };
const alice: User = { id: 'alice', name: 'Alice', color: 'bg-rose-500', role: 'participant' };

const retro = (): RetroSession => ({
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Sprint 12',
  date: '2026-11-23',
  status: 'IN_PROGRESS',
  phase: 'DISCUSS',
  participants: [facilitator, alice],
  icebreakerQuestion: '',
  columns: [{ id: 'start', title: 'Start', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'play_arrow', text: 'text-emerald-700', ring: 'focus:ring-emerald-200' }],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 300,
    timerRunning: false,
    timerInitial: 300,
  },
  tickets: [
    { id: 't-a', colId: 'start', text: 'Pair more often', authorId: 'alice', groupId: null, votes: ['fac', 'alice'] },
    { id: 't-b', colId: 'start', text: 'Write the release notes together', authorId: 'fac', groupId: null, votes: ['alice'] },
  ],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  discussionFocusId: 't-b',
});

const healthCheck = (): HealthCheckSessionType => ({
  id: 'hc-1',
  teamId: 'team-1',
  name: 'Team Health',
  date: '2026-11-23',
  status: 'IN_PROGRESS',
  phase: 'DISCUSS',
  templateId: 'template-1',
  templateName: 'Team Health',
  dimensions: [
    { id: 'd-fun', name: 'Fun', goodDescription: 'We enjoy it', badDescription: 'Boring' },
    { id: 'd-speed', name: 'Speed', goodDescription: 'Fast', badDescription: 'Slow' },
  ],
  participants: [facilitator, alice],
  settings: { isAnonymous: false, revealRoti: false, showParticipantVotes: false },
  ratings: { fac: { 'd-fun': { rating: 4 }, 'd-speed': { rating: 2 } } },
  actions: [],
  discussionFocusId: 'd-speed',
  roti: {},
  finishedUsers: [],
});

const team = (): Team => ({
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [facilitator, alice],
  customTemplates: [],
  retrospectives: [retro()],
  globalActions: [],
  healthChecks: [healthCheck()],
});

/** Every scroll the screen asks for: the element, and what it asked. */
let scrolls: Array<{ element: Element; options: unknown }>;

const SCREENS = {
  'the retrospective': {
    focused: 'Write the release notes together',
    show: (user: User) => {
      const current = team();
      vi.mocked(dataService.getTeam).mockReturnValue(current);
      vi.mocked(syncService.getCurrentSessionId).mockReturnValue('retro-1');
      render(<Session team={current} sessionId="retro-1" currentUser={user} onExit={vi.fn()} />);
    },
  },
  'the health check': {
    focused: 'Speed',
    show: (user: User) => {
      const current = team();
      vi.mocked(dataService.getTeam).mockReturnValue(current);
      vi.mocked(dataService.getHealthCheck).mockReturnValue(current.healthChecks![0]);
      vi.mocked(syncService.getCurrentSessionId).mockReturnValue('hc-1');
      render(<HealthCheckSession team={current} sessionId="hc-1" currentUser={user} onExit={vi.fn()} />);
    },
  },
} as const;

/** The scroll the screen asked for the focused topic, once it has (the screens wait a moment for the layout). */
const scrollToFocus = async (focused: string) => {
  await waitFor(() => expect(scrolls.some(({ element }) => element.textContent?.includes(focused))).toBe(true));
  return scrolls.filter(({ element }) => element.textContent?.includes(focused)).map(({ options }) => options);
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  scrolls = [];
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value(this: Element, options: unknown) { scrolls.push({ element: this, options }); },
  });
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: false }) })) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  restoreMotionPreference();
  delete (window.HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe.each(Object.entries(SCREENS))('the topic in focus in Discuss, in %s', (_name, screen) => {
  it.each([['the facilitator', facilitator], ['a participant', alice]] as const)('takes %s there at once when they asked for less motion', async (_who, user) => {
    prefersMotion('reduce');
    screen.show(user);
    const asked = await scrollToFocus(screen.focused);
    expect(asked.length).toBeGreaterThan(0);
    for (const options of asked) expect(options).toMatchObject({ behavior: 'auto', block: 'center' });
  });

  it('takes the reader there at once where the browser cannot say, as every effect does', async () => {
    restoreMotionPreference();
    screen.show(alice);
    for (const options of await scrollToFocus(screen.focused)) expect(options).toMatchObject({ behavior: 'auto' });
  });

  it('glides there for a reader who did not ask for less motion', async () => {
    prefersMotion('no-preference');
    screen.show(alice);
    for (const options of await scrollToFocus(screen.focused)) expect(options).toMatchObject({ behavior: 'smooth', block: 'center' });
  });
});
