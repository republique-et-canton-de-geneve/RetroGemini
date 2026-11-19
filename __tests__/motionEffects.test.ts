import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { motionAllowed, playEffect } from '../components/common/motion/effects';

/**
 * `playEffect` puts an effect class of index.css on an element for one
 * animation and takes it off. jsdom has no `matchMedia`: each test that wants
 * motion stubs it, and the bare environment is a case of its own.
 */

const stubMotion = (reduced: boolean) => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('no-preference') ? !reduced : reduced,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

const animationEnd = (element: Element, animationName: string) => {
  const event = new Event('animationend', { bubbles: true });
  Object.defineProperty(event, 'animationName', { value: animationName });
  element.dispatchEvent(event);
};

const original = window.matchMedia;
let element: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  element = document.createElement('div');
  element.className = 'group relative';
  document.body.appendChild(element);
});

afterEach(() => {
  vi.useRealTimers();
  element.remove();
  window.matchMedia = original;
});

describe('playEffect', () => {
  it('puts the class on and takes it off at the end of its own animation', () => {
    stubMotion(false);
    expect(playEffect(element, 'fx-card-in')).toBe(true);
    expect(element.classList.contains('fx-card-in')).toBe(true);
    // Another animation of the same element ending (the ring) is not this one.
    animationEnd(element, 'fx-ring');
    expect(element.classList.contains('fx-card-in')).toBe(true);
    animationEnd(element, 'fx-card-in');
    expect(element.className).toBe('group relative');
  });

  it('ignores the end of an animation of a child', () => {
    stubMotion(false);
    const child = document.createElement('span');
    element.appendChild(child);
    playEffect(element, 'fx-pop');
    animationEnd(child, 'fx-pop');
    expect(element.classList.contains('fx-pop')).toBe(true);
  });

  it('takes the class off at the timeout when no animationend comes', () => {
    stubMotion(false);
    playEffect(element, 'fx-bump');
    vi.advanceTimersByTime(600);
    expect(element.classList.contains('fx-bump')).toBe(true);
    vi.advanceTimersByTime(200);
    expect(element.classList.contains('fx-bump')).toBe(false);
  });

  it('waits for the wash behind an arriving row, the last of its two animations', () => {
    stubMotion(false);
    playEffect(element, 'fx-person-in');
    animationEnd(element, 'fx-person-in');
    expect(element.classList.contains('fx-person-in')).toBe(true);
    animationEnd(element, 'fx-wash');
    expect(element.classList.contains('fx-person-in')).toBe(false);
  });

  it('sets custom properties while it plays and removes them after, delay included in the net', () => {
    stubMotion(false);
    playEffect(element, 'fx-reveal', { properties: { '--fx-delay': '400ms' } });
    expect(element.style.getPropertyValue('--fx-delay')).toBe('400ms');
    // 500ms of animation after 400ms of delay: still on at 900ms.
    vi.advanceTimersByTime(900);
    expect(element.classList.contains('fx-reveal')).toBe(true);
    vi.advanceTimersByTime(300);
    expect(element.classList.contains('fx-reveal')).toBe(false);
    expect(element.style.getPropertyValue('--fx-delay')).toBe('');
    expect(element.getAttribute('style') ?? '').toBe('');
  });

  it('restarts cleanly when played again', () => {
    stubMotion(false);
    playEffect(element, 'fx-ring', { properties: { '--fx-ring': 'red' } });
    vi.advanceTimersByTime(800);
    playEffect(element, 'fx-ring', { properties: { '--fx-ring': 'blue' } });
    expect(element.style.getPropertyValue('--fx-ring')).toBe('blue');
    // The first play's timer was cleared: at 1150ms from the first, the second still plays.
    vi.advanceTimersByTime(400);
    expect(element.classList.contains('fx-ring')).toBe(true);
    animationEnd(element, 'fx-ring');
    expect(element.classList.contains('fx-ring')).toBe(false);
    expect(element.style.getPropertyValue('--fx-ring')).toBe('');
    vi.runAllTimers();
    expect(element.className).toBe('group relative');
  });

  it('does nothing under reduced motion, and reads the setting at each call', () => {
    stubMotion(true);
    expect(playEffect(element, 'fx-pop', { properties: { '--fx-ring': 'red' } })).toBe(false);
    expect(element.className).toBe('group relative');
    expect(element.getAttribute('style')).toBeNull();
    stubMotion(false);
    expect(playEffect(element, 'fx-pop')).toBe(true);
  });

  it('does nothing without matchMedia (jsdom), and never throws', () => {
    // jsdom's own state: no matchMedia
    delete window.matchMedia;
    expect(motionAllowed()).toBe(false);
    expect(playEffect(element, 'fx-pop')).toBe(false);
    expect(element.className).toBe('group relative');
    window.matchMedia = (() => { throw new Error('boom'); }) as unknown as typeof window.matchMedia;
    expect(() => playEffect(element, 'fx-pop')).not.toThrow();
    expect(element.className).toBe('group relative');
  });

  it('does nothing on a missing element or one no longer on the page', () => {
    stubMotion(false);
    expect(playEffect(null, 'fx-pop')).toBe(false);
    expect(playEffect(undefined, 'fx-pop')).toBe(false);
    const detached = document.createElement('div');
    expect(playEffect(detached, 'fx-pop')).toBe(false);
    expect(detached.className).toBe('');
  });
});
