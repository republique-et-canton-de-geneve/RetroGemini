/**
 * Plays one effect class of `index.css` (`fx-*`) on an element, for the length
 * of one animation, then takes it off.
 *
 * The class is put on imperatively, on purpose. A session screen of several
 * thousand lines would otherwise render again to add a class and once more to
 * remove it; an element React draws again (a phase change, a card that changes
 * group) simply carries no class, so nothing replays; and the class strings the
 * unit tests read stay the ones React wrote.
 *
 * Every effect is decoration: the state it accompanies is already on screen.
 * So this never throws, and does nothing at all — no class, no custom property
 * left behind — when the element is not on the page, when the browser cannot
 * say whether the reader wants motion (jsdom has no `matchMedia`), or when the
 * reader asked for less of it.
 */

/**
 * How long each effect of `index.css` lasts, delays and repeats included (ms).
 * Exported for `__tests__/motionEffects.test.ts`, which reads the stylesheet
 * and requires each entry to be the length declared there: an animation
 * lengthened in the stylesheet alone would be cut off by the net below.
 */
export const EFFECT_LENGTH_MS: Readonly<Record<string, number>> = {
  'fx-card-in': 500,
  'fx-ring': 900,
  'fx-pop': 450,
  'fx-bump': 450,
  'fx-press': 400,
  'fx-nope': 400,
  'fx-title-in': 450,
  // The row's slide is 0.5s; its wash, on `::before`, is the last to end.
  'fx-person-in': 1600,
  // 0.3s of delay, then two pulses of 0.9s.
  'fx-halo': 2100,
  'fx-reveal': 500,
  'fx-dialog-in': 280,
  'fx-veil-in': 200,
  'fx-swap': 500,
};

/**
 * The animation whose end ends the effect, when it is not the one named like
 * the class: a row that arrives slides in 0.5s, and the wash behind it lasts
 * 1.6s.
 */
const LAST_ANIMATION: Readonly<Record<string, string>> = {
  'fx-person-in': 'fx-wash',
};

/** Past the expected end, the effect is taken off even if no `animationend` came. */
const SAFETY_MARGIN_MS = 250;
const DEFAULT_LENGTH_MS = 1000;

export interface EffectOptions {
  /** CSS custom properties set while the effect plays (`--fx-ring`, `--fx-delay`), removed after. */
  properties?: Readonly<Record<string, string>>;
  /** Overrides the length the timeout waits for (ms); the delay in `--fx-delay` is added to it. */
  lengthMs?: number;
}

/**
 * Whether the reader may be shown motion, read live at each call: the setting
 * can change while the page is open. Unknown (no `matchMedia`) reads as no, as
 * the stylesheet's `no-preference` query does.
 */
export function motionAllowed(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: no-preference)').matches === true;
  } catch {
    return false;
  }
}

interface Playing {
  stop: () => void;
}

/** The effects playing on each element, by class, so a second play restarts the first. */
const playing = new WeakMap<Element, Map<string, Playing>>();

const delayOf = (properties: EffectOptions['properties']): number => {
  const raw = properties?.['--fx-delay'];
  const value = raw ? Number.parseFloat(raw) : 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
};

/**
 * Puts `className` on `element` until its animation ends (or a timeout, as a
 * net), with `options.properties` set meanwhile. Playing the same effect again
 * on the same element restarts it. Answers whether it played.
 */
export function playEffect(element: Element | null | undefined, className: string, options: EffectOptions = {}): boolean {
  try {
    if (!element || !element.isConnected || !className || !motionAllowed()) return false;
    const html = element as HTMLElement;

    const effects = playing.get(element) ?? new Map<string, Playing>();
    playing.set(element, effects);
    const previous = effects.get(className);
    if (previous) {
      previous.stop();
      // Read a layout value so the browser sees the class go before it comes
      // back: without it, the animation would carry on rather than restart.
      void html.offsetWidth;
    }

    const properties = options.properties ?? {};
    const style = html.style as CSSStyleDeclaration | undefined;
    for (const [name, value] of Object.entries(properties)) style?.setProperty(name, value);

    const expected = LAST_ANIMATION[className] ?? (className.startsWith('fx-') ? className : null);
    const stop = () => {
      clearTimeout(timer);
      element.removeEventListener('animationend', onEnd);
      element.classList.remove(className);
      for (const name of Object.keys(properties)) style?.removeProperty(name);
      if (effects.get(className) === entry) effects.delete(className);
    };
    function onEnd(event: Event) {
      if (event.target !== element) return;
      const name = (event as AnimationEvent).animationName;
      if (expected && typeof name === 'string' && name !== expected) return;
      stop();
    }
    const entry: Playing = { stop };
    effects.set(className, entry);

    element.addEventListener('animationend', onEnd);
    element.classList.add(className);
    const length = options.lengthMs ?? EFFECT_LENGTH_MS[className] ?? DEFAULT_LENGTH_MS;
    const timer = setTimeout(stop, length + delayOf(properties) + SAFETY_MARGIN_MS);
    return true;
  } catch {
    return false;
  }
}
