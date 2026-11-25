import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import Session from '../components/Session';
import { RetroSession, Team, User } from '../types';

/**
 * A card's reaction chips toggle the viewer's own reaction: a chip the viewer
 * reacted with is drawn in the brand tint, and says so as a state,
 * `aria-pressed` (AGENTS.md → Accessibility, "a choice that stays chosen says
 * so as a state, not only as a colour"). It said so by its colour alone, so a
 * screen reader heard "👍 2, button" whether a press would add the viewer's
 * reaction or take it back. The name is the chip's words, as before.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(() => null),
    updateSession: vi.fn(),
    persistParticipants: vi.fn(),
    applyRemoteSession: vi.fn(),
    getSessionToken: vi.fn(() => 'token-1'),
  },
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    leaveSession: vi.fn(),
    updateSession: vi.fn(),
    getCurrentSessionId: vi.fn(() => 'session-1'),
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

const session = (phase: string): RetroSession => ({
  id: 'session-1',
  teamId: 'team-1',
  name: 'Sprint 12',
  date: '2026-11-23',
  status: 'IN_PROGRESS',
  phase,
  participants: [facilitator, alice],
  icebreakerQuestion: '',
  columns: [{ id: 'todo', title: 'To Discuss', color: 'bg-slate-50', border: 'border-slate-400', icon: 'pending', text: 'text-slate-700', ring: 'focus:ring-slate-200' }],
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
    { id: 't-a', colId: 'todo', text: 'Flaky deploys', authorId: 'alice', groupId: null, votes: [], reactions: { '👍': ['fac', 'alice'], '🎉': ['alice'] } },
  ],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
});

const renderBoard = (phase: string, user: User) => {
  const current = session(phase);
  const team: Team = {
    id: 'team-1', name: 'Team', passwordHash: 'hash', members: [facilitator, alice],
    customTemplates: [], retrospectives: [current], globalActions: [],
  };
  render(<Session team={team} sessionId={current.id} currentUser={user} onExit={() => {}} />);
};

const chips = () => {
  const card = screen.getByText('Flaky deploys').closest('[data-ticket-id]') as HTMLElement;
  return within(card).getAllByTestId('ticket-reaction');
};
const chip = (emoji: string) => chips().find((element) => element.getAttribute('data-reaction') === emoji) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: false }) })) as unknown as typeof fetch;
});

afterEach(() => cleanup());

describe.each(['BRAINSTORM', 'OPEN_BOARD'])('the reaction chips of a card, in %s', (phase) => {
  it('say which reactions are the viewer’s own as pressed, and keep their words as their name', () => {
    renderBoard(phase, facilitator);
    expect(chips().map((element) => [element.getAttribute('data-reaction'), element.getAttribute('aria-pressed')])).toEqual([
      ['👍', 'true'],
      ['🎉', 'false'],
    ]);
    expect(screen.getByRole('button', { name: '👍 2', pressed: true })).toBe(chip('👍'));
    expect(screen.getByRole('button', { name: '🎉 1', pressed: false })).toBe(chip('🎉'));
  });

  it('follow a press: a reaction added is pressed, one taken back is not', () => {
    renderBoard(phase, facilitator);
    fireEvent.click(chip('🎉'));
    expect(chip('🎉')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('🎉')).toHaveAccessibleName('🎉 2');
    fireEvent.click(chip('👍'));
    expect(chip('👍')).toHaveAttribute('aria-pressed', 'false');
    expect(chip('👍')).toHaveAccessibleName('👍 1');
  });

  // A change rings the chip (useSessionMotion.ts): its ring is drawn on the
  // chip's own pseudo-element, which a chip that is not positioned would draw
  // around the whole foot row instead.
  it('are positioned, so the ring a change plays closes on the chip', () => {
    renderBoard(phase, facilitator);
    for (const element of chips()) expect(element.className.split(/\s+/)).toContain('relative');
  });

  it('are the viewer’s own: what one person pressed is not pressed for another', () => {
    renderBoard(phase, alice);
    expect(chips().map((element) => element.getAttribute('aria-pressed'))).toEqual(['true', 'true']);
    cleanup();
    renderBoard(phase, { id: 'bob', name: 'Bob', color: 'bg-emerald-500', role: 'participant' });
    expect(chips().map((element) => element.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
  });
});
