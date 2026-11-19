import { describe, expect, it } from 'vitest';
import type { Group, RetroSession, Ticket } from '../types';
import { MAX_CARD_BURST, MAX_PEOPLE_BURST, NO_MOTION, arrivedPeople, diffSessionMotion, flightPath, staggerDelays } from '../utils/sessionMotion';

const ticket = (id: string, over: Partial<Ticket> = {}): Ticket => ({
  id,
  colId: 'start',
  text: `card ${id}`,
  authorId: 'ana',
  groupId: null,
  votes: [],
  ...over,
});

const session = (over: Partial<RetroSession> = {}): RetroSession =>
  ({
    id: 'retro-1',
    teamId: 'team',
    phase: 'BRAINSTORM',
    columns: [{ id: 'start' }, { id: 'stop' }],
    settings: { revealBrainstorm: false },
    tickets: [],
    groups: [],
    finishedUsers: [],
    ...over,
  }) as unknown as RetroSession;

const me = { viewerId: 'me', ownPendingIds: new Set<string>() };

describe('diffSessionMotion', () => {
  // A phase change remounts the whole board, and a card remounts when it
  // changes group or column: what just happened is read from two states, never
  // from an element appearing.
  it('finds nothing without two states of one session in one phase', () => {
    const next = session({ tickets: [ticket('a')] });
    expect(diffSessionMotion(undefined, next, me)).toBe(NO_MOTION);
    expect(diffSessionMotion(next, undefined, me)).toBe(NO_MOTION);
    expect(diffSessionMotion(session({ id: 'retro-0' }), next, me)).toBe(NO_MOTION);
    expect(diffSessionMotion(session({ phase: 'GROUP' }), next, me)).toBe(NO_MOTION);
  });

  it('finds nothing when nothing changed', () => {
    const state = session({ tickets: [ticket('a', { votes: ['me'], reactions: { '👍': ['ana'] } })], finishedUsers: ['ana'] });
    const motion = diffSessionMotion(state, structuredClone(state), me);
    expect(motion).toEqual(NO_MOTION);
  });

  describe('cards', () => {
    it("tells a teammate's new card from one this client just created", () => {
      const prev = session({ tickets: [ticket('a')] });
      const next = session({ tickets: [ticket('a'), ticket('b'), ticket('mine', { authorId: 'me' })] });
      const motion = diffSessionMotion(prev, next, { viewerId: 'me', ownPendingIds: new Set(['mine']) });
      expect(motion.arrivedCards).toEqual(['b']);
      expect(motion.ownCards).toEqual(['mine']);
    });

    // The same person in a second browser is a teammate to this one: only the
    // browser that typed the card flies it out of its own field.
    it('counts a card of mine written in another browser as an arrival', () => {
      const motion = diffSessionMotion(session(), session({ tickets: [ticket('elsewhere', { authorId: 'me' })] }), me);
      expect(motion.arrivedCards).toEqual(['elsewhere']);
      expect(motion.ownCards).toEqual([]);
    });

    it('does not see a card that moved, was grouped or was edited as new', () => {
      const prev = session({ tickets: [ticket('a'), ticket('b')] });
      const next = session({
        tickets: [ticket('b', { colId: 'stop', text: 'edited' }), ticket('a', { groupId: 'g1' })],
        groups: [{ id: 'g1', title: '', colId: 'start', votes: [] } as Group],
      });
      const motion = diffSessionMotion(prev, next, me);
      expect(motion.arrivedCards).toEqual([]);
      expect(motion.ownCards).toEqual([]);
    });

    // A healed state, a restore or a reconnection after minutes away brings many
    // cards in one write: a board that lights up everywhere says nothing.
    it('animates no arrival when more cards than a burst come at once', () => {
      const many = Array.from({ length: MAX_CARD_BURST + 1 }, (_, i) => ticket(`n${i}`));
      expect(diffSessionMotion(session(), session({ tickets: many }), me).arrivedCards).toEqual([]);
      expect(diffSessionMotion(session(), session({ tickets: many.slice(0, MAX_CARD_BURST) }), me).arrivedCards).toHaveLength(MAX_CARD_BURST);
    });

    it('still flies my own card when a burst of others arrives with it', () => {
      const many = Array.from({ length: MAX_CARD_BURST + 1 }, (_, i) => ticket(`n${i}`));
      const motion = diffSessionMotion(session(), session({ tickets: [...many, ticket('mine', { authorId: 'me' })] }), {
        viewerId: 'me',
        ownPendingIds: new Set(['mine']),
      });
      expect(motion.ownCards).toEqual(['mine']);
      expect(motion.arrivedCards).toEqual([]);
    });
  });

  describe('the reveal', () => {
    it("lists the cards that were hidden from this viewer, in the board's order", () => {
      const tickets = [ticket('a'), ticket('mine', { authorId: 'me' }), ticket('b', { authorId: 'bo' })];
      const prev = session({ tickets });
      const next = session({ tickets, settings: { revealBrainstorm: true } as RetroSession['settings'] });
      expect(diffSessionMotion(prev, next, me).revealedCards).toEqual(['a', 'b']);
    });

    it('happens on an open board too, and nowhere the cards were never hidden', () => {
      const tickets = [ticket('a')];
      const shown = { revealBrainstorm: true } as RetroSession['settings'];
      expect(diffSessionMotion(session({ phase: 'OPEN_BOARD', tickets }), session({ phase: 'OPEN_BOARD', tickets, settings: shown }), me).revealedCards).toEqual(['a']);
      expect(diffSessionMotion(session({ phase: 'VOTE', tickets }), session({ phase: 'VOTE', tickets, settings: shown }), me).revealedCards).toEqual([]);
    });

    it('is not replayed when the cards are hidden again, nor for a card that arrives already shown', () => {
      const shown = { revealBrainstorm: true } as RetroSession['settings'];
      expect(diffSessionMotion(session({ tickets: [ticket('a')], settings: shown }), session({ tickets: [ticket('a')] }), me).revealedCards).toEqual([]);
      expect(diffSessionMotion(session({ settings: shown }), session({ tickets: [ticket('a')], settings: shown }), me).revealedCards).toEqual([]);
    });
  });

  describe('counts', () => {
    it('names a reaction whose count grew, never one that shrank or came with a new card', () => {
      const prev = session({ tickets: [ticket('a', { reactions: { '👍': ['ana'], '🎉': ['ana', 'bo'] } })] });
      const next = session({
        tickets: [ticket('a', { reactions: { '👍': ['ana', 'me'], '🎉': ['ana'], '❤️': ['bo'] } }), ticket('new', { reactions: { '👍': ['bo'] } })],
      });
      expect(diffSessionMotion(prev, next, me).reactions).toEqual(['a:👍', 'a:❤️']);
    });

    it('names the columns whose number of entries changed: a group counts once', () => {
      const prev = session({ tickets: [ticket('a'), ticket('b'), ticket('c', { colId: 'stop' })] });
      const grouped = session({
        tickets: [ticket('a', { groupId: 'g1' }), ticket('b', { groupId: 'g1' }), ticket('c', { colId: 'stop' })],
        groups: [{ id: 'g1', title: '', colId: 'start', votes: [] } as Group],
      });
      expect(diffSessionMotion(prev, grouped, me).columns).toEqual(['start']);
      const moved = session({ tickets: [ticket('a'), ticket('b', { colId: 'stop' }), ticket('c', { colId: 'stop' })] });
      expect(diffSessionMotion(prev, moved, me).columns).toEqual(['start', 'stop']);
    });

    it('names the cards and groups whose vote total changed, not the ones that just arrived', () => {
      const group = (votes: string[]) => ({ id: 'g1', title: '', colId: 'start', votes }) as Group;
      const prev = session({ tickets: [ticket('a'), ticket('b', { votes: ['ana'] })], groups: [group([])] });
      const next = session({ tickets: [ticket('a', { votes: ['bo'] }), ticket('b'), ticket('new', { votes: ['bo'] })], groups: [group(['me'])] });
      expect(diffSessionMotion(prev, next, me).voteTotals).toEqual(['a', 'b', 'g1']);
    });

    // Who finished is the participants panel's to show (usePanelMotion reads
    // the rows' checks). Named here as an event, it was read by nothing, and
    // made a state that only said "someone is done" news for the board.
    it('reads a state that only says someone finished as no news for the board', () => {
      expect(diffSessionMotion(session({ finishedUsers: ['ana'] }), session({ finishedUsers: ['ana', 'bo'] }), me)).toBe(NO_MOTION);
      expect(diffSessionMotion(session({ finishedUsers: ['ana'] }), session({ finishedUsers: [] }), me)).toBe(NO_MOTION);
      expect(Object.keys(NO_MOTION)).not.toContain('finished');
    });
  });

  // Session blobs are written by every client: a list another release left out,
  // or a value that is not a list, must not blank the board.
  it('reads a session whose lists are missing or not lists', () => {
    const broken = { id: 'retro-1', phase: 'BRAINSTORM', tickets: null, groups: undefined, columns: 'x', finishedUsers: {} } as unknown as RetroSession;
    expect(diffSessionMotion(broken, session({ tickets: [ticket('a')] }), me).arrivedCards).toEqual(['a']);
    const emptied = diffSessionMotion(session({ tickets: [ticket('a', { reactions: null as unknown as Ticket['reactions'], votes: null as unknown as string[] })] }), broken, me);
    // The one card is gone: its column's count changed, and nothing else happened.
    expect(emptied).toEqual({ ...NO_MOTION, columns: ['start'] });
    const odd = session({ tickets: [ticket('a', { reactions: 'x' as unknown as Ticket['reactions'], votes: 'y' as unknown as string[] })] });
    expect(diffSessionMotion(odd, structuredClone(odd), me)).toEqual(NO_MOTION);
  });
});

describe('arrivedPeople', () => {
  it('names the people who were not listed before', () => {
    expect(arrivedPeople(['ana', 'bo'], ['ana', 'bo', 'cy'])).toEqual(['cy']);
    expect(arrivedPeople(['ana', 'bo'], ['bo'])).toEqual([]);
  });

  it('names nobody the first time the list is known', () => {
    expect(arrivedPeople(null, ['ana', 'bo'])).toEqual([]);
  });

  // After a rolling update every browser reconnects within a second and the
  // whole roster comes back at once.
  it('names nobody when more people than a burst arrive together', () => {
    const crowd = Array.from({ length: MAX_PEOPLE_BURST + 1 }, (_, i) => `p${i}`);
    expect(arrivedPeople([], crowd)).toEqual([]);
    expect(arrivedPeople([], crowd.slice(0, MAX_PEOPLE_BURST))).toHaveLength(MAX_PEOPLE_BURST);
  });
});

describe('staggerDelays', () => {
  it('spaces the items evenly and never lets the last one wait longer than the cap', () => {
    expect(staggerDelays(3, 80, 600)).toEqual([0, 80, 160]);
    const hundred = staggerDelays(100, 80, 600);
    expect(hundred[0]).toBe(0);
    expect(Math.max(...hundred)).toBeLessThanOrEqual(600);
    expect(hundred[99]).toBeGreaterThan(hundred[1]);
    expect(staggerDelays(0, 80, 600)).toEqual([]);
    expect(staggerDelays(1, 80, 600)).toEqual([0]);
  });
});

describe('flightPath', () => {
  const rect = (left: number, top: number, width = 12, height = 12) => ({ left, top, width, height });
  const viewport = { width: 1280, height: 800 };

  it('goes from the centre of one box to the centre of the other, over an arc', () => {
    const path = flightPath(rect(100, 50), rect(400, 350), viewport, 40);
    expect(path).not.toBeNull();
    expect(path!.from).toEqual({ x: 106, y: 56 });
    expect(path!.to).toEqual({ x: 406, y: 356 });
    // The middle of the trip is lifted above the straight line.
    expect(path!.via.x).toBe(256);
    expect(path!.via.y).toBe(206 - 40);
  });

  it('is not drawn when an end is missing, has no size or is out of the window', () => {
    expect(flightPath(null, rect(400, 350), viewport)).toBeNull();
    expect(flightPath(rect(100, 50), undefined, viewport)).toBeNull();
    expect(flightPath(rect(100, 50, 0, 0), rect(400, 350), viewport)).toBeNull();
    expect(flightPath(rect(100, 50), rect(400, 900), viewport)).toBeNull();
    expect(flightPath(rect(-40, 50), rect(400, 350), viewport)).toBeNull();
    expect(flightPath(rect(100, 50), rect(1300, 350), viewport)).toBeNull();
  });
});
