import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Group, RetroSession, Ticket } from '../types';
import {
  MAX_REVEALED_AT_ONCE,
  MOTION_HOOKS,
  RECONNECT_QUIET_MS,
  REVEAL_CAP_MS,
  playLandedVote,
  useSessionMotion,
} from '../components/session/useSessionMotion';

/**
 * The hook compares the session it showed with the one it shows and puts the
 * board's effects on the elements concerned, found by the data attributes of
 * `MOTION_HOOKS`. A small board stands in for the session screen: it carries
 * exactly those attributes.
 */

const ticket = (id: string, over: Partial<Ticket> = {}): Ticket => ({
  id, colId: 'start', text: `card ${id}`, authorId: 'ana', groupId: null, votes: [], ...over,
});

const session = (over: Partial<RetroSession> = {}): RetroSession =>
  ({
    id: 'retro-1',
    teamId: 'team',
    phase: 'BRAINSTORM',
    columns: [{ id: 'start' }, { id: 'stop' }],
    settings: { revealBrainstorm: true },
    tickets: [ticket('t1')],
    groups: [],
    finishedUsers: [],
    ...over,
  }) as unknown as RetroSession;

const Board: React.FC<{ session: RetroSession; isLive: boolean; pending: ReadonlySet<string> | Map<string, unknown>; held?: ReadonlySet<string>; ready?: boolean }> = ({ session: shown, isLive, pending, held, ready = true }) => {
  useSessionMotion({ session: shown, viewerId: 'me', ownPendingIds: () => pending, isLive, ready, heldVotes: held ? () => held : undefined });
  return (
    <div>
      {shown.columns.map((col) => (
        <span key={col.id} {...{ [MOTION_HOOKS.columnCount]: col.id }}>{shown.tickets.filter((t) => t.colId === col.id && !t.groupId).length}</span>
      ))}
      {shown.tickets.filter((t) => !t.groupId).map((t) => (
        <div key={t.id} {...{ [MOTION_HOOKS.card]: t.id }} className="group relative" style={{ borderColor: '#ff0000' }}>
          <div className="whitespace-pre-wrap">{t.text}</div>
          {Object.entries(t.reactions ?? {}).map(([emoji, users]) => (
            <button key={emoji} type="button" {...{ [MOTION_HOOKS.reaction]: emoji }}>{emoji} {users.length}</button>
          ))}
          <span {...{ [MOTION_HOOKS.voteCount]: '' }}>{t.votes.length}</span>
        </div>
      ))}
      {shown.groups.map((g) => (
        <div key={g.id} {...{ [MOTION_HOOKS.group]: g.id }} className="group-container relative">
          {shown.tickets.filter((t) => t.groupId === g.id).map((t) => (
            <div key={t.id} {...{ [MOTION_HOOKS.card]: t.id }} className="group relative">
              <span {...{ [MOTION_HOOKS.voteCount]: '' }}>{t.votes.length}</span>
            </div>
          ))}
          <span data-testid={`group-count-${g.id}`} {...{ [MOTION_HOOKS.voteCount]: '' }}>{g.votes.length}</span>
        </div>
      ))}
    </div>
  );
};

const originalMatchMedia = window.matchMedia;
const stubMotion = (reduced = false) => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('no-preference') ? !reduced : reduced,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

/** The board on its first state, live, past the quiet seconds of the connection. */
const mount = (first: RetroSession, pending: ReadonlySet<string> = new Set()) => {
  const view = render(<Board session={first} isLive pending={pending} />);
  act(() => { vi.advanceTimersByTime(RECONNECT_QUIET_MS + 1); });
  const show = (next: RetroSession, isLive = true, nextPending = pending) =>
    view.rerender(<Board session={next} isLive={isLive} pending={nextPending} />);
  return { ...view, show };
};

const card = (id: string) => document.querySelector(`[${MOTION_HOOKS.card}="${id}"]`) as HTMLElement;
const decorated = () => [...document.querySelectorAll('[class*="fx-"]')].map((el) => `${el.getAttribute(MOTION_HOOKS.card) ?? el.getAttribute(MOTION_HOOKS.group) ?? el.getAttribute(MOTION_HOOKS.columnCount) ?? el.getAttribute(MOTION_HOOKS.reaction) ?? el.tagName.toLowerCase()}:${[...el.classList].filter((c) => c.startsWith('fx-')).join(',')}`);

beforeEach(() => {
  vi.useFakeTimers();
  stubMotion();
});

afterEach(() => {
  vi.useRealTimers();
  // A spy a test put on a prototype (the cards' boxes) never outlives it,
  // whether its assertions passed or not.
  vi.restoreAllMocks();
  window.matchMedia = originalMatchMedia;
});

describe('useSessionMotion', () => {
  it('lets a teammate’s card rise in with a ring in its border colour, and bumps its column’s count', () => {
    const { show } = mount(session());
    show(session({ tickets: [ticket('t1'), ticket('t2')] }));
    expect(card('t2').classList.contains('fx-card-in')).toBe(true);
    expect(card('t2').classList.contains('fx-ring')).toBe(true);
    expect(card('t2').style.getPropertyValue('--fx-ring')).toMatch(/rgb\(255, 0, 0\)|#ff0000/);
    expect(card('t1').className).toBe('group relative');
    expect(document.querySelector(`[${MOTION_HOOKS.columnCount}="start"]`)!.classList.contains('fx-bump')).toBe(true);
    expect(document.querySelector(`[${MOTION_HOOKS.columnCount}="stop"]`)!.classList.contains('fx-bump')).toBe(false);
  });

  it('lets one’s own new card arrive the same way', () => {
    const { show } = mount(session(), new Set(['t2']));
    show(session({ tickets: [ticket('t1'), ticket('t2', { authorId: 'me' })] }));
    expect(card('t2').classList.contains('fx-card-in')).toBe(true);
  });

  it('accepts the session’s map of pending creations', () => {
    const view = render(<Board session={session()} isLive pending={new Map([['t2', {}]])} />);
    act(() => { vi.advanceTimersByTime(RECONNECT_QUIET_MS + 1); });
    view.rerender(<Board session={session({ tickets: [ticket('t1'), ticket('t2', { authorId: 'me' })] })} isLive pending={new Map([['t2', {}]])} />);
    expect(card('t2').classList.contains('fx-card-in')).toBe(true);
  });

  it('unblurs revealed cards one after another, 80ms apart', () => {
    const tickets = [ticket('a'), ticket('b', { colId: 'stop' }), ticket('c'), ticket('mine', { authorId: 'me' })];
    const { show } = mount(session({ settings: { revealBrainstorm: false } as RetroSession['settings'], tickets }));
    show(session({ settings: { revealBrainstorm: true } as RetroSession['settings'], tickets }));
    const delays = ['a', 'b', 'c'].map((id) => {
      const text = card(id).querySelector('.whitespace-pre-wrap') as HTMLElement;
      expect(text.classList.contains('fx-reveal')).toBe(true);
      return text.style.getPropertyValue('--fx-delay');
    });
    expect(delays).toEqual(['0ms', '80ms', '160ms']);
    // One's own card was never hidden from oneself.
    expect(card('mine').querySelector('.whitespace-pre-wrap')!.classList.contains('fx-reveal')).toBe(false);
  });

  // The reveal is the one effect that grows with the board: a blur and a fade
  // on every hidden card at once. On a board kept for weeks that is hundreds
  // of them, most far below the screen, each a filter the phone must paint.
  // Only the cards in the window are unblurred; the others are simply shown.
  it('unblurs only the hidden cards that are in the window', () => {
    const tickets = [ticket('a'), ticket('below'), ticket('c'), ticket('above'), ticket('aside')];
    const { show } = mount(session({ settings: { revealBrainstorm: false } as RetroSession['settings'], tickets }));
    const box = (top: number, left = 20): DOMRect =>
      ({ top, left, bottom: top + 80, right: left + 300, width: 300, height: 80, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    const outside: Record<string, DOMRect> = {
      below: box(window.innerHeight + 400),
      above: box(-900),
      aside: box(100, window.innerWidth + 50),
    };
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return outside[this.getAttribute(MOTION_HOOKS.card) ?? ''] ?? box(100);
    });
    show(session({ settings: { revealBrainstorm: true } as RetroSession['settings'], tickets }));
    const words = (id: string) => card(id).querySelector('.whitespace-pre-wrap') as HTMLElement;
    expect(['a', 'c'].map((id) => words(id).classList.contains('fx-reveal'))).toEqual([true, true]);
    // The stagger counts the cards that play, not the ones left still.
    expect(['a', 'c'].map((id) => words(id).style.getPropertyValue('--fx-delay'))).toEqual(['0ms', '80ms']);
    expect(['below', 'above', 'aside'].map((id) => words(id).classList.contains('fx-reveal'))).toEqual([false, false, false]);
  });

  it('unblurs a bounded number of cards however many a window holds, the last within the cap', () => {
    expect(MAX_REVEALED_AT_ONCE).toBeGreaterThan(10);
    const many = Array.from({ length: MAX_REVEALED_AT_ONCE + 15 }, (_, index) => ticket(`n${index}`));
    const { show } = mount(session({ settings: { revealBrainstorm: false } as RetroSession['settings'], tickets: many }));
    show(session({ settings: { revealBrainstorm: true } as RetroSession['settings'], tickets: many }));
    const playing = many.filter((t) => card(t.id).querySelector('.whitespace-pre-wrap')!.classList.contains('fx-reveal')).map((t) => t.id);
    expect(playing).toEqual(many.slice(0, MAX_REVEALED_AT_ONCE).map((t) => t.id));
    const delays = playing.map((id) => Number.parseFloat((card(id).querySelector('.whitespace-pre-wrap') as HTMLElement).style.getPropertyValue('--fx-delay')));
    expect(Math.max(...delays)).toBeLessThanOrEqual(REVEAL_CAP_MS);
  });

  it('pops a new reaction and bumps one that gained a person', () => {
    const { show } = mount(session({ tickets: [ticket('t1', { reactions: { '👍': ['ana'] } })] }));
    show(session({ tickets: [ticket('t1', { reactions: { '👍': ['ana', 'bob'], '🎉': ['bob'] } })] }));
    const chip = (emoji: string) => [...card('t1').querySelectorAll(`[${MOTION_HOOKS.reaction}]`)].find((el) => el.getAttribute(MOTION_HOOKS.reaction) === emoji)!;
    expect(chip('👍').classList.contains('fx-bump')).toBe(true);
    expect(chip('🎉').classList.contains('fx-pop')).toBe(true);
  });

  it('bumps a changed vote total on a board and rings its card or group', () => {
    const groups: Group[] = [{ id: 'g1', title: 'G', colId: 'start', votes: [], anchorTicketId: 'gt' } as unknown as Group];
    const tickets = [ticket('t1'), ticket('gt', { groupId: 'g1' })];
    const { show } = mount(session({ phase: 'OPEN_BOARD', tickets, groups }));
    show(session({ phase: 'OPEN_BOARD', tickets: [ticket('t1', { votes: ['bob'] }), tickets[1]], groups: [{ ...groups[0], votes: ['ana'] }] }));
    expect(card('t1').classList.contains('fx-ring')).toBe(true);
    expect(card('t1').querySelector(`[${MOTION_HOOKS.voteCount}]`)!.classList.contains('fx-bump')).toBe(true);
    const group = document.querySelector(`[${MOTION_HOOKS.group}="g1"]`)!;
    expect(group.classList.contains('fx-ring')).toBe(true);
    // The group's own count, not the one of the card nested in it.
    expect(document.querySelector('[data-testid="group-count-g1"]')!.classList.contains('fx-bump')).toBe(true);
    expect(card('gt').querySelector(`[${MOTION_HOOKS.voteCount}]`)!.classList.contains('fx-bump')).toBe(false);
  });

  it.each([
    ['the guided Vote phase', { phase: 'VOTE' }],
    ['a board whose counts are hidden', { phase: 'OPEN_BOARD', settings: { revealBrainstorm: true, voteCountHidden: true } }],
  ])('marks only the viewer’s own votes in %s', (_case, over) => {
    const base = over as Partial<RetroSession>;
    const { show } = mount(session({ ...base, tickets: [ticket('t1'), ticket('t2')] }));
    show(session({ ...base, tickets: [ticket('t1', { votes: ['bob'] }), ticket('t2', { votes: ['me'] })] }));
    expect(card('t1').className).toBe('group relative');
    expect(card('t2').classList.contains('fx-ring')).toBe(true);
  });

  it('leaves a vote a flight carries to the screen, which plays it where the token lands', () => {
    const held = new Set(['t2']);
    const view = render(<Board session={session({ phase: 'VOTE', tickets: [ticket('t1'), ticket('t2')] })} isLive pending={new Set()} held={held} />);
    act(() => { vi.advanceTimersByTime(RECONNECT_QUIET_MS + 1); });
    view.rerender(<Board session={session({ phase: 'VOTE', tickets: [ticket('t1', { votes: ['me'] }), ticket('t2', { votes: ['me'] })] })} isLive pending={new Set()} held={held} />);
    // The vote no flight carries is marked at once; the carried one waits.
    expect(card('t1').classList.contains('fx-ring')).toBe(true);
    expect(card('t2').classList.contains('fx-ring')).toBe(false);
    expect(card('t2').querySelector(`[${MOTION_HOOKS.voteCount}]`)!.classList.contains('fx-bump')).toBe(false);

    expect(playLandedVote(document, 't2')).toBe(true);
    expect(card('t2').classList.contains('fx-ring')).toBe(true);
    // A count with no dot in it answers with a bump.
    expect(card('t2').querySelector(`[${MOTION_HOOKS.voteCount}]`)!.classList.contains('fx-bump')).toBe(true);
  });

  it('pops the dot a landed vote added, on a card or a group, and finds nothing for an unknown id', () => {
    document.body.innerHTML = `
      <div ${MOTION_HOOKS.group}="g1" class="group-container relative">
        <div ${MOTION_HOOKS.card}="in" class="group relative"><span ${MOTION_HOOKS.voteCount}=""><span id="card-dot"></span></span></div>
        <span ${MOTION_HOOKS.voteCount}=""><span></span><span id="last-dot"></span></span>
      </div>`;
    expect(playLandedVote(document, 'g1')).toBe(true);
    expect(document.getElementById('last-dot')!.classList.contains('fx-pop')).toBe(true);
    expect(document.querySelector(`[${MOTION_HOOKS.group}="g1"]`)!.classList.contains('fx-ring')).toBe(true);
    // The group's own control, never the one of a card nested in it.
    expect(document.getElementById('card-dot')!.classList.contains('fx-pop')).toBe(false);
    expect(playLandedVote(document, 'missing')).toBe(false);
    document.body.innerHTML = '';
  });

  it('plays nothing on the first state, a phase change or a change of session', () => {
    const view = render(<Board session={session({ tickets: [ticket('t1'), ticket('t2')] })} isLive pending={new Set()} />);
    act(() => { vi.advanceTimersByTime(RECONNECT_QUIET_MS + 1); });
    expect(decorated()).toEqual([]);
    view.rerender(<Board session={session({ phase: 'GROUP', tickets: [ticket('t1'), ticket('t2'), ticket('t3')] })} isLive pending={new Set()} />);
    expect(decorated()).toEqual([]);
    view.rerender(<Board session={session({ id: 'retro-2', phase: 'GROUP', tickets: [ticket('t9')] })} isLive pending={new Set()} />);
    expect(decorated()).toEqual([]);
  });

  it('stays quiet while offline and for three seconds after the connection comes back', () => {
    const { show } = mount(session());
    show(session({ tickets: [ticket('t1'), ticket('t2')] }), false);
    expect(decorated()).toEqual([]);
    show(session({ tickets: [ticket('t1'), ticket('t2'), ticket('t3')] }), true);
    expect(decorated()).toEqual([]);
    act(() => { vi.advanceTimersByTime(RECONNECT_QUIET_MS - 500); });
    show(session({ tickets: [ticket('t1'), ticket('t2'), ticket('t3'), ticket('t4')] }), true);
    expect(decorated()).toEqual([]);
    act(() => { vi.advanceTimersByTime(600); });
    show(session({ tickets: [ticket('t1'), ticket('t2'), ticket('t3'), ticket('t4'), ticket('t5')] }), true);
    expect(card('t5').classList.contains('fx-card-in')).toBe(true);
    // Compared with the state shown last, not with the one before the outage.
    expect(card('t4').classList.contains('fx-card-in')).toBe(false);
  });

  it('is quiet in the first seconds of the first connection too', () => {
    const view = render(<Board session={session()} isLive pending={new Set()} />);
    view.rerender(<Board session={session({ tickets: [ticket('t1'), ticket('t2')] })} isLive pending={new Set()} />);
    expect(decorated()).toEqual([]);
  });

  it('never compares the cached seed with the first state from the server, however late it comes', () => {
    // Drawn from the team cache first, which lags the session row.
    const view = render(<Board session={session({ phase: 'OPEN_BOARD' })} isLive ready={false} pending={new Set()} />);
    act(() => { vi.advanceTimersByTime(4_000); });
    view.rerender(<Board session={session({ phase: 'OPEN_BOARD' })} isLive ready={false} pending={new Set()} />);
    // The join snapshot, four seconds later on a slow phone: new cards, a new
    // reaction and a vote total that moved are no news.
    const snapshot = session({ phase: 'OPEN_BOARD', tickets: [ticket('t1', { votes: ['bob'], reactions: { '👍': ['ana'] } }), ticket('t2'), ticket('t3')] });
    view.rerender(<Board session={snapshot} isLive pending={new Set()} />);
    expect(decorated()).toEqual([]);
    // The quiet seconds open there, not at the mount.
    act(() => { vi.advanceTimersByTime(RECONNECT_QUIET_MS - 500); });
    view.rerender(<Board session={session({ phase: 'OPEN_BOARD', tickets: [...snapshot.tickets, ticket('t4')] })} isLive pending={new Set()} />);
    expect(decorated()).toEqual([]);
    act(() => { vi.advanceTimersByTime(600); });
    view.rerender(<Board session={session({ phase: 'OPEN_BOARD', tickets: [...snapshot.tickets, ticket('t4'), ticket('t5')] })} isLive pending={new Set()} />);
    expect(card('t5').classList.contains('fx-card-in')).toBe(true);
    expect(card('t4').classList.contains('fx-card-in')).toBe(false);
  });

  it('decorates nothing at all when more than six cards arrive at once', () => {
    const { show } = mount(session());
    const many = Array.from({ length: 7 }, (_, i) => ticket(`n${i}`));
    show(session({ tickets: [ticket('t1', { votes: ['bob'] }), ...many], phase: 'BRAINSTORM' }));
    expect(decorated()).toEqual([]);
  });

  it('leaves no class and no custom property behind once the effects are over', () => {
    const { show } = mount(session({ phase: 'OPEN_BOARD', tickets: [ticket('t1', { reactions: { '👍': ['ana'] } })] }));
    show(session({ phase: 'OPEN_BOARD', tickets: [ticket('t1', { votes: ['bob'], reactions: { '👍': ['ana', 'bob'] } }), ticket('t2')] }));
    expect(decorated().length).toBeGreaterThan(0);
    act(() => { vi.runAllTimers(); });
    expect(decorated()).toEqual([]);
    expect(document.querySelectorAll('[style*="--fx"]')).toHaveLength(0);
  });

  it('plays nothing to a reader who asked for less motion, nor without matchMedia', () => {
    stubMotion(true);
    const reduced = mount(session());
    reduced.show(session({ tickets: [ticket('t1'), ticket('t2')] }));
    expect(decorated()).toEqual([]);
    reduced.unmount();

    // jsdom's own state: no matchMedia
    delete window.matchMedia;
    const bare = mount(session());
    bare.show(session({ tickets: [ticket('t1'), ticket('t2')] }));
    expect(decorated()).toEqual([]);
  });

  it('never throws on a malformed state', () => {
    const HookOnly: React.FC<{ shown: RetroSession }> = ({ shown }) => {
      useSessionMotion({ session: shown, viewerId: 'me', ownPendingIds: () => new Set(), isLive: true, ready: true });
      return null;
    };
    const view = render(<HookOnly shown={session()} />);
    act(() => { vi.advanceTimersByTime(RECONNECT_QUIET_MS + 1); });
    expect(() => view.rerender(<HookOnly shown={{ ...session(), tickets: 'nope', groups: null } as unknown as RetroSession} />)).not.toThrow();
    expect(() => view.rerender(<HookOnly shown={{ ...session(), tickets: [null, 7] } as unknown as RetroSession} />)).not.toThrow();
  });
});
