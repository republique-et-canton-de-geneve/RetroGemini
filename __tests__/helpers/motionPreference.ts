/**
 * The reader's motion preference, for the tests of an effect. Every effect asks
 * `motionAllowed()` (components/common/motion/effects.ts), which reads
 * `(prefers-reduced-motion: no-preference)` and answers no where `matchMedia`
 * is missing, as in jsdom. A test that wants to see an effect states the
 * preference; one that leaves jsdom alone states that nothing moves.
 *
 * Both queries answer consistently, so a test cannot pass by matching the word
 * "reduce" inside "reduced-motion".
 */
type Preference = 'no-preference' | 'reduce';

const original = typeof window === 'undefined' ? undefined : window.matchMedia;

export const prefersMotion = (preference: Preference): void => {
  window.matchMedia = ((query: string) => ({
    matches: query.replace(/\s+/g, '') === `(prefers-reduced-motion:${preference})`,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

/** Back to what the environment had (jsdom: no `matchMedia` at all). */
export const restoreMotionPreference = (): void => {
  if (original) window.matchMedia = original;
  else delete (window as { matchMedia?: unknown }).matchMedia;
};
