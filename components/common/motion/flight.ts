import { flightPath, type BoxLike, type FlightPath } from '../../../utils/sessionMotion';
import { motionAllowed } from './effects';

/**
 * One decorative token that travels between two places on the screen: a vote
 * leaving the budget for a card, or coming back to it.
 *
 * It is drawn in a layer of its own appended to `body` (`.fx-layer` in
 * `index.css`: fixed, above the board, no pointer events), because the board
 * scrolls and clips, and the bar above it is sticky. Nothing in it is
 * focusable or announced, and the vote it shows has already landed: this only
 * accompanies it.
 */

/** A vote on its way to a card (ms). */
export const FLIGHT_OUT_MS = 500;
/** A vote taken back, on its way home (ms). */
export const FLIGHT_BACK_MS = 340;
/** How high the middle of the trip is lifted (px). */
export const FLIGHT_ARC_PX = 40;

const LAYER_CLASS = 'fx-layer';
const TOKEN_CLASS = 'fx-token';
const SAFETY_MARGIN_MS = 250;

export interface FlightOptions {
  duration?: number;
  arc?: number;
  /** Called once the token has arrived, or at once when nothing flies. */
  onArrive?: () => void;
}

type End = Element | BoxLike | null | undefined;

const boxOf = (end: End): BoxLike | null => {
  if (!end) return null;
  if (typeof (end as Element).getBoundingClientRect === 'function') {
    if (!(end as Element).isConnected) return null;
    const rect = (end as Element).getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  return end as BoxLike;
};

const layerOf = (): HTMLElement => {
  const existing = document.body.querySelector<HTMLElement>(`:scope > .${LAYER_CLASS}`);
  if (existing) return existing;
  const layer = document.createElement('div');
  layer.className = LAYER_CLASS;
  layer.setAttribute('aria-hidden', 'true');
  layer.style.pointerEvents = 'none';
  document.body.appendChild(layer);
  return layer;
};

const ARC_STEPS = 8;

/**
 * The trip as keyframes along the quadratic curve that passes through the
 * path's lifted middle: three keyframes alone would draw two straight lines.
 */
export function arcKeyframes(path: FlightPath): Array<{ transform: string; offset: number }> {
  const control = {
    x: 2 * path.via.x - (path.from.x + path.to.x) / 2,
    y: 2 * path.via.y - (path.from.y + path.to.y) / 2,
  };
  return Array.from({ length: ARC_STEPS + 1 }, (_, step) => {
    const t = step / ARC_STEPS;
    const x = (1 - t) ** 2 * path.from.x + 2 * (1 - t) * t * control.x + t ** 2 * path.to.x;
    const y = (1 - t) ** 2 * path.from.y + 2 * (1 - t) * t * control.y + t ** 2 * path.to.y;
    const scale = 1 + 0.15 * Math.sin(Math.PI * t) - 0.2 * t;
    return { transform: `translate(${x}px, ${y}px) scale(${scale.toFixed(3)})`, offset: t };
  });
}

/**
 * Sends a token from the centre of `from` to the centre of `to` along an arc.
 * Nothing is drawn, and `onArrive` is called at once, when the reader asked
 * for less motion, when the browser cannot animate an element, or when an end
 * is missing, not drawn or outside the window.
 */
export function fly(from: End, to: End, options: FlightOptions = {}): void {
  let arrived = false;
  const arrive = () => {
    if (arrived) return;
    arrived = true;
    try {
      options.onArrive?.();
    } catch {
      // The caller's own business; a decoration never breaks a click.
    }
  };

  let token: HTMLElement | null = null;
  try {
    if (
      typeof document === 'undefined' ||
      !motionAllowed() ||
      typeof Element === 'undefined' ||
      typeof Element.prototype.animate !== 'function'
    ) {
      arrive();
      return;
    }
    const path = flightPath(boxOf(from), boxOf(to), { width: window.innerWidth, height: window.innerHeight }, options.arc ?? FLIGHT_ARC_PX);
    if (!path) {
      arrive();
      return;
    }

    const layer = layerOf();
    token = document.createElement('div');
    token.className = TOKEN_CLASS;
    token.setAttribute('aria-hidden', 'true');
    layer.appendChild(token);

    const duration = options.duration ?? FLIGHT_OUT_MS;
    const drawn = token;
    const done = () => {
      clearTimeout(timer);
      drawn.remove();
      if (!layer.childElementCount) layer.remove();
      arrive();
    };
    const animation = drawn.animate(arcKeyframes(path), { duration, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'none' });
    animation.onfinish = done;
    animation.oncancel = done;
    // A tab in the background may never finish it: the token goes anyway.
    const timer = setTimeout(done, duration + SAFETY_MARGIN_MS);
  } catch {
    if (token) {
      const layer = token.parentElement;
      token.remove();
      if (layer && !layer.childElementCount) layer.remove();
    }
    arrive();
  }
}
