import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ARRIVAL_MS, POP_MS, PanelMotionInput, QUIET_MS, usePanelMotion } from '../components/session/usePanelMotion';

/**
 * Who the participants panel animates (components/session/usePanelMotion.ts):
 * only what just happened, never what is merely drawn again. The rule of the
 * whole port — an effect is triggered by two states compared — is what these
 * cases hold: one new person plays, a first population, a crowd, the viewer's
 * own reconnection, a row moving within the list or an expanded panel do not.
 */

const base: PanelMotionInput = {
  presentIds: ['me', 'a'],
  activeIds: ['me', 'a', 'b'],
  checkedIds: [],
  count: 3,
  isCollapsed: false,
  isLive: true,
  scope: 'BRAINSTORM',
  currentUserId: 'me',
};

const mount = (input: PanelMotionInput = base) =>
  renderHook((props: PanelMotionInput) => usePanelMotion(props), { initialProps: input });

/** Past the quiet that follows the mount. */
const settle = () => act(() => { vi.advanceTimersByTime(QUIET_MS + 10); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-19T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the arrival', () => {
  it('plays for one person who comes online, and comes off when the effect is over', () => {
    const { result, rerender } = mount();
    settle();
    rerender({ ...base, presentIds: ['me', 'a', 'b'] });
    expect([...result.current.arriving]).toEqual(['b']);

    act(() => { vi.advanceTimersByTime(ARRIVAL_MS + 10); });
    expect(result.current.arriving.size).toBe(0);
  });

  it('plays for two at once, never for three (a reconnect wave)', () => {
    const { result, rerender } = mount({ ...base, presentIds: ['me'] });
    settle();
    rerender({ ...base, presentIds: ['me', 'a', 'b'] });
    expect([...result.current.arriving].sort()).toEqual(['a', 'b']);

    const crowd = mount({ ...base, presentIds: ['me'] });
    settle();
    crowd.rerender({ ...base, presentIds: ['me', 'a', 'b', 'c'] });
    expect(crowd.result.current.arriving.size).toBe(0);
  });

  it('plays nothing on the first population, nor while the roster arrives just after the mount', () => {
    const { result, rerender } = mount({ ...base, presentIds: [] });
    expect(result.current.arriving.size).toBe(0);
    rerender({ ...base, presentIds: ['me', 'a'] });
    expect(result.current.arriving.size).toBe(0);
  });

  it('never plays for the viewer', () => {
    const { result, rerender } = mount({ ...base, presentIds: ['a'] });
    settle();
    rerender({ ...base, presentIds: ['a', 'me'] });
    expect(result.current.arriving.size).toBe(0);
  });

  it('stays quiet for three seconds after the viewer\'s own reconnection', () => {
    const { result, rerender } = mount();
    settle();
    rerender({ ...base, isLive: false });
    rerender({ ...base, isLive: true });
    rerender({ ...base, presentIds: ['me', 'a', 'b'] });
    expect(result.current.arriving.size).toBe(0);

    act(() => { vi.advanceTimersByTime(QUIET_MS + 10); });
    rerender({ ...base, presentIds: ['me', 'a', 'b', 'c'] });
    expect([...result.current.arriving]).toEqual(['c']);
  });

  it('plays nothing while offline', () => {
    const { result, rerender } = mount();
    settle();
    rerender({ ...base, isLive: false, presentIds: ['me', 'a', 'b'] });
    expect(result.current.arriving.size).toBe(0);
  });

  it('plays nothing for a row that only moves within the list (marked as left, then back)', () => {
    const { result, rerender } = mount();
    settle();
    rerender({ ...base, activeIds: ['me', 'b'], count: 2 });
    rerender({ ...base });
    expect(result.current.arriving.size).toBe(0);
  });

  it('plays nothing while collapsed, nor on the render that expands the panel', () => {
    const { result, rerender } = mount({ ...base, isCollapsed: true });
    settle();
    rerender({ ...base, isCollapsed: true, presentIds: ['me', 'a', 'b'] });
    expect(result.current.arriving.size).toBe(0);
    rerender({ ...base, isCollapsed: false, presentIds: ['me', 'a', 'b'] });
    expect(result.current.arriving.size).toBe(0);
  });

  it('plays nothing for a reader who asked for less motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }));
    const { result, rerender } = mount();
    settle();
    rerender({ ...base, presentIds: ['me', 'a', 'b'], checkedIds: ['a'], count: 4 });
    expect(result.current.arriving.size).toBe(0);
    expect(result.current.finishing.size).toBe(0);
    expect(result.current.bump).toBe(0);
  });

  it('plays for a reader who did not ask for less motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: !query.includes('reduce'), media: query }));
    const { result, rerender } = mount();
    settle();
    rerender({ ...base, presentIds: ['me', 'a', 'b'] });
    expect([...result.current.arriving]).toEqual(['b']);
  });
});

describe('the check', () => {
  it('springs in for someone who just finished, and comes off', () => {
    const { result, rerender } = mount();
    settle();
    rerender({ ...base, checkedIds: ['a'] });
    expect([...result.current.finishing]).toEqual(['a']);
    act(() => { vi.advanceTimersByTime(POP_MS + 10); });
    expect(result.current.finishing.size).toBe(0);
  });

  it('stays still when the phase changes, even if checks appear', () => {
    const { result, rerender } = mount();
    settle();
    rerender({ ...base, scope: 'WELCOME', checkedIds: ['a'] });
    expect(result.current.finishing.size).toBe(0);
  });

  it('stays still for a row marked as returned whose check comes back with it', () => {
    const { result, rerender } = mount({ ...base, activeIds: ['me', 'b'] });
    settle();
    rerender({ ...base, activeIds: ['me', 'a', 'b'], checkedIds: ['a'] });
    expect(result.current.finishing.size).toBe(0);
  });
});

describe('the count', () => {
  it('bumps when it changes, and rests again', () => {
    const { result, rerender } = mount();
    settle();
    expect(result.current.bump).toBe(0);
    rerender({ ...base, count: 4 });
    const first = result.current.bump;
    expect(first).toBeGreaterThan(0);
    // A second change restarts it with a new key.
    rerender({ ...base, count: 5 });
    expect(result.current.bump).not.toBe(first);
    act(() => { vi.advanceTimersByTime(POP_MS + 10); });
    expect(result.current.bump).toBe(0);
  });

  it('does not bump on the first render', () => {
    const { result } = mount();
    settle();
    expect(result.current.bump).toBe(0);
  });
});
