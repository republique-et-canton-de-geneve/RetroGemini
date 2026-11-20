import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLIGHT_BACK_MS, FLIGHT_OUT_MS, arcKeyframes, fly } from '../components/common/motion/flight';
import { flightPath } from '../utils/sessionMotion';

/**
 * A vote's token flies in a layer of its own and leaves nothing behind. jsdom
 * has neither `matchMedia` nor `Element.prototype.animate`: both are stubbed
 * where motion is wanted, and their absence is a case of its own.
 */

type Frame = Record<string, unknown>;
type AnimationOptions = { duration?: number; easing?: string; fill?: string };

interface FakeAnimation {
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
  keyframes: Frame[];
  options: AnimationOptions;
}

const originalMatchMedia = window.matchMedia;
const originalAnimate = Element.prototype.animate;
let animations: FakeAnimation[];

const stubMotion = (reduced = false) => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('no-preference') ? !reduced : reduced,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

const stubAnimate = () => {
  Element.prototype.animate = function animate(keyframes: Frame[], options: AnimationOptions) {
    const animation: FakeAnimation = { onfinish: null, oncancel: null, keyframes, options };
    animations.push(animation);
    return animation as unknown as Animation;
  } as unknown as typeof Element.prototype.animate;
};

const box = (left: number, top: number, size = 20) => ({ left, top, width: size, height: size });
const layers = () => document.body.querySelectorAll(':scope > .fx-layer');

beforeEach(() => {
  vi.useFakeTimers();
  animations = [];
});

afterEach(() => {
  vi.useRealTimers();
  window.matchMedia = originalMatchMedia;
  Element.prototype.animate = originalAnimate;
  for (const layer of layers()) layer.remove();
});

describe('fly', () => {
  it('draws one token per call in one hidden layer, and removes both at the end', () => {
    stubMotion();
    stubAnimate();
    const arrived = vi.fn();
    fly(box(10, 10), box(300, 200), { onArrive: arrived });
    fly(box(10, 10), box(100, 100), { duration: FLIGHT_BACK_MS });

    expect(layers()).toHaveLength(1);
    const layer = layers()[0] as HTMLElement;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.style.pointerEvents).toBe('none');
    expect(layer.querySelectorAll('.fx-token')).toHaveLength(2);
    expect(layer.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
    expect(animations[0].options.duration).toBe(FLIGHT_OUT_MS);
    expect(animations[1].options.duration).toBe(FLIGHT_BACK_MS);
    expect(arrived).not.toHaveBeenCalled();

    animations[0].onfinish?.();
    expect(arrived).toHaveBeenCalledTimes(1);
    expect(layer.querySelectorAll('.fx-token')).toHaveLength(1);
    expect(layer.isConnected).toBe(true);

    animations[1].onfinish?.();
    expect(layers()).toHaveLength(0);
    // The net timer finds nothing more to do, and never calls back twice.
    vi.runAllTimers();
    expect(arrived).toHaveBeenCalledTimes(1);
  });

  it('removes the token at the timeout when the animation never finishes', () => {
    stubMotion();
    stubAnimate();
    const arrived = vi.fn();
    fly(box(10, 10), box(300, 200), { onArrive: arrived });
    vi.advanceTimersByTime(FLIGHT_OUT_MS + 300);
    expect(layers()).toHaveLength(0);
    expect(arrived).toHaveBeenCalledTimes(1);
  });

  it('starts and ends on the centres of two elements', () => {
    stubMotion();
    stubAnimate();
    const from = document.createElement('span');
    const to = document.createElement('span');
    document.body.append(from, to);
    from.getBoundingClientRect = () => ({ ...box(0, 0, 10), right: 10, bottom: 10, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    to.getBoundingClientRect = () => ({ ...box(100, 50, 10), right: 110, bottom: 60, x: 100, y: 50, toJSON: () => ({}) }) as DOMRect;
    fly(from, to);
    const frames = animations[0].keyframes;
    expect(frames[0].transform).toContain('translate(5px, 5px)');
    expect(frames[frames.length - 1].transform).toContain('translate(105px, 55px)');
    from.remove();
    to.remove();
  });

  it.each([
    ['the reader asked for less motion', () => { stubMotion(true); stubAnimate(); }, box(10, 10), box(100, 100)],
    ['the browser cannot animate an element', () => { stubMotion(); (Element.prototype as { animate?: unknown }).animate = undefined; }, box(10, 10), box(100, 100)],
    ['there is no matchMedia (jsdom)', () => { stubAnimate(); /* jsdom: none */ (window as { matchMedia?: unknown }).matchMedia = undefined; }, box(10, 10), box(100, 100)],
    ['an end is missing', () => { stubMotion(); stubAnimate(); }, null, box(100, 100)],
    ['an end has no size', () => { stubMotion(); stubAnimate(); }, box(10, 10, 0), box(100, 100)],
    ['an end lies outside the window', () => { stubMotion(); stubAnimate(); }, box(10, 10), box(window.innerWidth + 500, 100)],
  ])('draws nothing and calls onArrive at once when %s', (_case, setUp, from, to) => {
    setUp();
    const arrived = vi.fn();
    fly(from, to, { onArrive: arrived });
    expect(arrived).toHaveBeenCalledTimes(1);
    expect(layers()).toHaveLength(0);
    expect(animations).toHaveLength(0);
  });

  it('draws nothing in the bare jsdom environment', () => {
    const arrived = vi.fn();
    expect(() => fly(box(10, 10), box(100, 100), { onArrive: arrived })).not.toThrow();
    expect(arrived).toHaveBeenCalledTimes(1);
    expect(layers()).toHaveLength(0);
  });

  it('cleans up when animate throws', () => {
    stubMotion();
    Element.prototype.animate = (() => { throw new Error('boom'); }) as unknown as typeof Element.prototype.animate;
    const arrived = vi.fn();
    fly(box(10, 10), box(100, 100), { onArrive: arrived });
    expect(arrived).toHaveBeenCalledTimes(1);
    expect(layers()).toHaveLength(0);
  });
});

describe('arcKeyframes', () => {
  it('runs from end to end through the lifted middle of the path', () => {
    const path = flightPath(box(0, 100, 20), box(200, 100, 20), { width: 1000, height: 1000 }, 40)!;
    const frames = arcKeyframes(path);
    expect(frames[0].offset).toBe(0);
    expect(frames[frames.length - 1].offset).toBe(1);
    const middle = frames[Math.floor(frames.length / 2)].transform as string;
    const [, , y] = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(middle) ?? [];
    expect(Number(y)).toBeCloseTo(path.via.y, 5);
  });
});
