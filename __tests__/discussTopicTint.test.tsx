import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import Session from '../components/Session';
import { cardTones } from '../utils/cardTones';
import { participantToneHex } from '../utils/participantColors';
import type { Column, Group, RetroSession, RetroSettings, Team, Ticket, User } from '../types';

/**
 * A Discuss topic is a card of the board, painted as the board paints it
 * (AGENTS.md, *A card's colour*: "a Discuss topic and the comments dialog's
 * card show the same tint as the board").
 *
 * 45.0 tinted a topic with the column it sits in. The board takes the column
 * the card was written in first, and its author's tone when it is coloured by
 * author (never in an anonymous session), so a card grouped across columns, or
 * any card of a board coloured by author, changed colour between the Vote phase
 * and Discuss.
 *
 * Each case renders one session twice on the real screen, at the Vote phase
 * (the board) and at Discuss, and reads the card's paint on both.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(() => null),
    updateSession: vi.fn(),
    persistParticipants: vi.fn(),
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

const facilitator: User = { id: 'fac-1', name: 'Claire', color: 'bg-indigo-500', role: 'facilitator' };
const lucas: User = { id: 'p-1', name: 'Lucas', color: 'bg-emerald-500', role: 'participant' };
const ines: User = { id: 'p-2', name: 'Inès', color: 'bg-rose-500', role: 'participant' };

const column = (id: string, customColor: string): Column => ({
  id, title: `Column ${id}`, color: 'bg-slate-50', border: 'border-slate-300', icon: 'play_arrow',
  text: 'text-slate-700', ring: 'focus:ring-slate-200', customColor
});
// Two columns whose hues are none of the people's tones.
const START = column('col-start', '#3B82F6');
const STOP = column('col-stop', '#F59E0B');

const ticket = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: 't1', colId: START.id, text: 'Reviews wait two days', authorId: lucas.id, groupId: null, votes: [], ...overrides
});

const settings = (overrides: Partial<RetroSettings> = {}): RetroSettings => ({
  isAnonymous: false,
  maxVotes: 5,
  oneVotePerTicket: false,
  revealBrainstorm: true,
  revealHappiness: false,
  revealRoti: false,
  timerSeconds: 0,
  timerRunning: false,
  timerInitial: 0,
  ...overrides
});

interface Case {
  settings?: Partial<RetroSettings>;
  tickets: Ticket[];
  groups?: Group[];
  people?: User[];
}

const sessionAt = (phase: 'VOTE' | 'DISCUSS', c: Case): RetroSession => ({
  id: 'session-1',
  teamId: 'team-1',
  name: 'Retro',
  date: '2026-11-20',
  status: 'IN_PROGRESS',
  phase,
  participants: c.people ?? [facilitator, lucas, ines],
  discussionFocusId: null,
  discussionNextTopicVotes: {},
  icebreakerQuestion: '',
  columns: [START, STOP],
  settings: settings(c.settings),
  tickets: c.tickets,
  groups: c.groups ?? [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: []
});

const teamOf = (session: RetroSession, people: User[]): Team => ({
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: people,
  customTemplates: [],
  retrospectives: [session],
  globalActions: []
});

/** jsdom reports an inline colour as `rgb(r, g, b)`: back to the hex the code wrote. */
const hexOf = (rgb: string): string | null =>
  rgb ? `#${(rgb.match(/\d+/g) ?? []).slice(0, 3).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}` : null;

/** A card's tint and line as painted (inline), or nulls for the white card. */
const paintOf = (element: HTMLElement) => ({ tint: hexOf(element.style.backgroundColor), line: hexOf(element.style.borderColor) });

const paintAt = async (phase: 'VOTE' | 'DISCUSS', c: Case, selector: string) => {
  const session = sessionAt(phase, c);
  const { container, unmount } = render(
    <Session team={teamOf(session, c.people ?? [facilitator, lucas, ines])} sessionId={session.id} currentUser={facilitator} onExit={() => {}} />
  );
  const element = await waitFor(() => {
    const found = container.querySelector(selector) as HTMLElement | null;
    expect(found, `${selector} at ${phase}`).not.toBeNull();
    return found as HTMLElement;
  });
  const paint = paintOf(element);
  unmount();
  return paint;
};

/** The card on the board (the Vote phase) and the same card as a Discuss topic. */
const boardAndTopic = async (c: Case, id = 't1') => ({
  board: await paintAt('VOTE', c, `[data-ticket-id="${id}"]`),
  topic: await paintAt('DISCUSS', c, `[data-topic-id="${id}"]`)
});

const tonesOf = (hex: string) => {
  const tones = cardTones(hex)!;
  return { tint: tones.tint, line: tones.line };
};

describe('a Discuss topic takes the tint the board gives its card', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('a card grouped into another column keeps the colour of the column it was written in', async () => {
    // Taken into a "Stop" group, then left alone when the group dissolved:
    // it sits in "Stop" and was written in "Start" (the "from ..." chip).
    const { board, topic } = await boardAndTopic({ tickets: [ticket({ colId: STOP.id, originColId: START.id })] });
    expect(board).toEqual(tonesOf('#3b82f6'));
    expect(topic).toEqual(board);
  });

  it('a board coloured by author paints the topic in its author’s tone', async () => {
    const { board, topic } = await boardAndTopic({ settings: { colorBy: 'author' }, tickets: [ticket()] });
    expect(board).toEqual(tonesOf(participantToneHex(lucas.color).pop));
    expect(topic).toEqual(board);
  });

  it('never by author in an anonymous session, whatever "Colour by" stores', async () => {
    const { board, topic } = await boardAndTopic({ settings: { colorBy: 'author', isAnonymous: true }, tickets: [ticket()] });
    expect(board).toEqual(tonesOf('#3b82f6'));
    expect(topic).toEqual(board);
  });

  // The board finds a card's author among the people it lists (Session.tsx →
  // getParticipants): the viewer included, and each name once, so of two
  // people whose names differ only in case it lists the first. The topic
  // finds its author in the same list, so it is painted as the board paints
  // the card, whichever of the two wrote it.
  it.each([
    ['the first', 'p-1'],
    ['the second', 'p-3'],
  ])('finds the author where the board does, when two people share a name (%s wrote the card)', async (_which, authorId) => {
    const lucasLower: User = { id: 'p-3', name: 'lucas', color: 'bg-cyan-500', role: 'participant' };
    const people = [facilitator, lucas, lucasLower, ines];
    const { board, topic } = await boardAndTopic({ settings: { colorBy: 'author' }, tickets: [ticket({ authorId })], people });
    expect(topic).toEqual(board);
  });

  // A group has many authors and no column of origin: as a topic it takes the
  // tint of the column it sits in, whatever the board is coloured by. (The
  // board draws a group as a neutral panel around its cards, which keep their
  // own tints.)
  it.each(['topic', 'author'] as const)('a group topic takes its column’s tint, the board coloured by %s', async (colorBy) => {
    const group: Group = { id: 'g1', title: 'Slow reviews', colId: STOP.id, votes: [] };
    const tickets = [
      ticket({ colId: STOP.id, originColId: START.id, groupId: group.id }),
      ticket({ id: 't2', colId: STOP.id, authorId: ines.id, groupId: group.id, text: 'Nobody owns the queue' })
    ];
    const topic = await paintAt('DISCUSS', { settings: { colorBy }, tickets, groups: [group] }, '[data-topic-id="g1"]');
    expect(topic).toEqual(tonesOf('#f59e0b'));
  });
});
