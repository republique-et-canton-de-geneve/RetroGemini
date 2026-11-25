/**
 * What can take the keyboard, and whether it is drawn. One rule for the
 * dialogs' focus trap (`ModalDialog`) and for the one-time notes, which hand
 * the keyboard on when they go (`seenOnce.ts`).
 */

/** The elements Tab can reach, as one selector. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

/**
 * Whether `element` is drawn: neither it nor an ancestor up to `root` (the
 * whole page without one) has the `hidden` attribute, `display: none` or
 * `visibility: hidden`. A control that is not drawn takes no focus:
 * `focus()` does nothing on it, so a dialog's trap must not cycle through it
 * (a collapsed section, a step of a wizard) and a note must not hand the
 * keyboard to it (a panel shown only from `lg`).
 *
 * Deliberately walks the ancestors rather than reading `offsetParent` or
 * `getClientRects()`. Those need a layout engine, so in the test environment
 * they report every control as hidden and the trap silently does nothing:
 * that is how a focus trap ships broken with a green suite.
 */
export const isVisible = (element: HTMLElement, root?: HTMLElement | null): boolean => {
  let node: HTMLElement | null = element;
  while (node) {
    if (node.hasAttribute('hidden')) return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (node === root) return true;
    node = node.parentElement;
  }
  return true;
};
