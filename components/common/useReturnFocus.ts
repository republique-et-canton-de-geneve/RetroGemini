import { useEffect, useRef } from 'react';

/**
 * Give focus back to whatever opened this overlay, when it closes.
 *
 * Extracted from `ModalDialog` because a second overlay needed it and a second
 * hand-rolled copy is exactly how the product reached thirteen overlays with
 * one `role="dialog"` between them (audit H42). Anything that appears over the
 * page and later unmounts owes its user this: without it a keyboard user is
 * dropped at the top of the document every time (WCAG 2.4.3).
 *
 * **The opener is captured during render, not in an effect, and that is the
 * whole subtlety.** React applies `autoFocus` while committing the DOM, which
 * is *before* any effect runs — so an effect reading `document.activeElement`
 * captures the autofocused field inside the overlay rather than the control
 * that opened it. That field then unmounts with the overlay, the restore sees a
 * disconnected element and gives up, and focus lands on `<body>`. Measured, not
 * assumed: `ModalDialog` had that bug for every dialog whose content
 * autofocuses, with its own return-focus tests green because none of them used
 * one (Codex, PR #437). Render happens before the overlay's DOM exists, so
 * `document.activeElement` there is still the opener.
 *
 * The ring suppression is audit H51: returning focus is not optional, but
 * *painting a ring* around it is a different question. A button activated with
 * the mouse is focused but not `:focus-visible`; closing with Escape makes the
 * browser call the restored focus keyboard-driven and draw an outline on a
 * button the user only ever clicked. The focus goes back; the ring does not.
 */

/**
 * Whether an element is currently showing a focus ring, as opposed to merely
 * being focused. `:focus-visible` is what the browser uses to decide, and a
 * browser that does not know the selector throws on `matches` — in which case
 * assume keyboard, because keeping a ring nobody needs is a smaller failure
 * than removing one somebody does.
 */
export const isKeyboardFocused = (element: Element | null): boolean => {
  if (!element) return false;
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
};

export const useReturnFocus = (): void => {
  const openerRef = useRef<Element | null | undefined>(undefined);
  const openerWasKeyboardFocusedRef = useRef(false);

  // Lazy, so it runs once on the first render and never again — including
  // under StrictMode's double render, where nothing has moved focus in between.
  if (openerRef.current === undefined) {
    openerRef.current = document.activeElement;
    openerWasKeyboardFocusedRef.current = isKeyboardFocused(document.activeElement);
  }

  useEffect(() => {
    return () => {
      const opener = openerRef.current;
      if (!(opener instanceof HTMLElement) || !opener.isConnected) return;

      if (!openerWasKeyboardFocusedRef.current) {
        opener.dataset.focusRestore = 'pointer';
        opener.addEventListener(
          'blur',
          () => { delete opener.dataset.focusRestore; },
          { once: true }
        );
      }
      opener.focus();
    };
  }, []);
};
