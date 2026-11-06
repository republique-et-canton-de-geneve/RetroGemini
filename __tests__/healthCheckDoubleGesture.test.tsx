import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HealthCheckSession from '../components/HealthCheckSession';
import { HealthCheckSession as HealthCheckSessionType, Team, User } from '../types';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';

/**
 * Review finding (pass 17 of 42.1): the guard that keeps the next press of a
 * double click, or the next tap of a double tap, off a control the first one
 * moved under the pointer lived in the retrospective alone. The health check
 * renders the same proposal rows: a double click on a proposal's Cancel
 * deleted the proposal being edited, one on its Delete deleted the next one
 * too — with their votes, for everyone, asking nothing. Both session types
 * mount one guard now (components/session/doubleGestureGuard.ts).
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(),
    getHealthCheck: vi.fn(),
    updateHealthCheckSession: vi.fn(),
    persistParticipants: vi.fn()
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
    onUpdateRefused: vi.fn(() => () => {}),
    onSyncHealth: vi.fn(() => () => {}),
    getSyncHealth: vi.fn(() => 'ok'),
    getResendDelayMs: vi.fn(() => 0),
    isConnected: vi.fn(() => true)
  }
}));

const facilitator: User = { id: 'facilitator-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };
const alice: User = { id: 'p1', name: 'Alice', color: 'bg-rose-500', role: 'participant' };

const proposal = (id: string, text: string) => ({
  id, text, assigneeId: null, done: false, type: 'proposal' as const, linkedTicketId: 'dim-1', proposalVotes: { p1: 'up' as const }
});

const createSession = (): HealthCheckSessionType => ({
  id: 'hc-1',
  teamId: 'team-1',
  name: 'Team Health',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'DISCUSS',
  templateId: 'template-1',
  templateName: 'Team Health',
  dimensions: [{ id: 'dim-1', name: 'Communication', goodDescription: 'People collaborate well', badDescription: 'People work in silos' }],
  participants: [facilitator, alice],
  settings: { isAnonymous: false, revealRoti: false, showParticipantVotes: false },
  ratings: { p1: { 'dim-1': { rating: 2, comment: 'Needs more clarity' } } },
  actions: [
    proposal('a1', 'Write the notes the day before'),
    proposal('a2', 'Ask support to review the notes'),
    proposal('a3', 'Publish the notes on the wiki')
  ],
  discussionFocusId: 'dim-1',
  roti: {},
  finishedUsers: []
});

const renderSession = () => {
  const session = createSession();
  const team: Team = {
    id: 'team-1', name: 'Team', passwordHash: 'hash', members: [facilitator, alice],
    customTemplates: [], retrospectives: [], globalActions: [], healthChecks: [session]
  };
  vi.mocked(dataService.getTeam).mockReturnValue(team);
  vi.mocked(dataService.getHealthCheck).mockReturnValue(session);
  vi.mocked(syncService.getCurrentSessionId).mockReturnValue(session.id);
  return render(<HealthCheckSession team={team} currentUser={facilitator} sessionId={session.id} onExit={vi.fn()} />);
};

const writes = () => vi.mocked(syncService.updateSession).mock.calls.length;
const proposals = () => {
  const calls = vi.mocked(syncService.updateSession).mock.calls;
  const last = calls[calls.length - 1]?.[0] as HealthCheckSessionType | undefined;
  return last?.actions.map((a) => a.text);
};

// A browser stamps an event from the page's load, a clock of its own; jsdom
// stamps it with Date.now(). Both are held, from two origins, so that a time
// read from the wrong clock is seen.
const heldClock = () => {
  const start = Date.now();
  let eventTime = 1000;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
  const stamp = vi.spyOn(Event.prototype, 'timeStamp', 'get').mockImplementation(() => eventTime);
  return {
    at: (ms: number) => { clock.mockReturnValue(start + ms); eventTime = 1000 + ms; },
    restore: () => { clock.mockRestore(); stamp.mockRestore(); }
  };
};
const touch = { touches: [{ clientX: 50, clientY: 50 }] };
// A press of the mouse, or the one a browser emulates for a tap on a control.
const press = (element: HTMLElement, detail: number, touched: boolean) => {
  if (touched) {
    fireEvent.touchStart(element, touch);
    fireEvent.touchEnd(element, touch);
  }
  const pressed = fireEvent.mouseDown(element, { detail, clientX: 50, clientY: 50 });
  fireEvent.mouseUp(element, { detail, clientX: 50, clientY: 50 });
  const clicked = fireEvent.click(element, { detail, clientX: 50, clientY: 50 });
  return { pressed, clicked };
};
const nothingPressed = { pressed: false, clicked: false };
const pressedAndClicked = { pressed: true, clicked: true };
const ways: Array<[string, boolean, number]> = [
  ['a double click', false, 2],
  ['a double tap (as Firefox counts it)', true, 1],
];

describe('the health check’s next press or tap, once the first took its own control off the page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });

  it.each(ways)('deletes no proposal with %s on the Cancel of its editor', async (_how, touched, detail) => {
    const user = userEvent.setup();
    renderSession();
    await user.click(await screen.findByText('Write the notes the day before'));
    const before = writes();

    const clock = heldClock();
    try {
      expect(press(screen.getByRole('button', { name: 'Cancel the edit' }), 1, touched)).toEqual(pressedAndClicked);
      expect(screen.queryByRole('button', { name: 'Cancel the edit' })).toBeNull();
      clock.at(150);
      expect(press(screen.getAllByRole('button', { name: 'Delete proposal' })[0], detail, touched)).toEqual(nothingPressed);
    } finally {
      clock.restore();
    }

    expect(screen.getByText('Write the notes the day before')).toBeTruthy();
    expect(writes()).toBe(before);
  });

  it.each(ways)('deletes one proposal with %s on its Delete', async (_how, touched, detail) => {
    renderSession();
    await screen.findByText('Write the notes the day before');
    const before = writes();

    const clock = heldClock();
    try {
      expect(press(screen.getAllByRole('button', { name: 'Delete proposal' })[0], 1, touched)).toEqual(pressedAndClicked);
      clock.at(150);
      expect(press(screen.getAllByRole('button', { name: 'Delete proposal' })[0], detail, touched)).toEqual(nothingPressed);
      // A press of its own, past the double click's half second, deletes.
      clock.at(1500);
      expect(press(screen.getAllByRole('button', { name: 'Delete proposal' })[0], 1, touched)).toEqual(pressedAndClicked);
    } finally {
      clock.restore();
    }

    expect(writes() - before).toBe(2);
    expect(proposals()).toEqual(['Publish the notes on the wiki']);
  });
});
