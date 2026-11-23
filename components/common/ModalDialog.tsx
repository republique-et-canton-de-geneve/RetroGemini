import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isTopDialog, pushDialog } from './modalDialogStack';
import { useReturnFocus } from './useReturnFocus';
import { EFFECT_LENGTH_MS, motionAllowed } from './motion/effects';
import { FOCUSABLE_SELECTOR, isVisible } from './focusable';

/**
 * The shared modal shell.
 *
 * The accessibility pass (H42) found thirteen `fixed inset-0` overlays and
 * exactly one declaring `role="dialog"`. None trapped focus and only three
 * files in the whole repository handled Escape, so tabbing inside a modal
 * walked out into the page behind it — the page a screen-reader user has just
 * been told is unavailable.
 *
 * Everything a dialog owes its user lives here once: the role, the modal flag,
 * the accessible name, Escape, a focus trap, and returning focus to whatever
 * opened it. Call sites keep their own `overlayClassName`/`panelClassName`, so
 * adopting this changes behaviour without touching a single pixel of layout.
 *
 * A hidden control stays out of the trap's cycle: `focusable.ts` holds what
 * can take the focus and the ancestor walk that says whether it is drawn,
 * shared with the one-time notes.
 */

export interface ModalDialogProps {
  /** Accessible name. Use `labelledBy` instead when the content already has a title. */
  label?: string;
  /** Id of the element naming this dialog — preferred when a visible title exists. */
  labelledBy?: string;
  /**
   * Close the dialog. Omit for a dialog the user cannot dismiss (a blocking
   * step): Escape and the backdrop then do nothing, rather than pretending.
   */
  onClose?: () => void;
  /** Backdrop clicks close by default; some dialogs guard unsaved input. */
  closeOnBackdropClick?: boolean;
  /** Classes for the full-screen backdrop. */
  overlayClassName?: string;
  /** Classes for the dialog panel itself. */
  panelClassName?: string;
  /** `data-testid` for the backdrop, for call sites whose tests select on it. */
  overlayTestId?: string;
  /**
   * How the panel enters. `rise` (the default) lifts it a few pixels while it
   * fades in; `fade` only fades it, for a panel holding a `position: fixed`
   * child: a transformed panel is the containing block of its fixed
   * descendants, so the child would ride with the panel instead of staying in
   * the screen's corner while the animation runs.
   */
  entrance?: DialogEntrance;
  children: React.ReactNode;
}

export type DialogEntrance = 'rise' | 'fade';

/** The veil and the panel of the product's dialogs, for a call site with nothing of its own to add. */
export const DIALOG_OVERLAY_CLASS = 'fixed inset-0 bg-slate-900/45 flex items-center justify-center z-50 p-4';
export const DIALOG_PANEL_CLASS = 'bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full';

/**
 * The entrance effects (`index.css`, under `prefers-reduced-motion:
 * no-preference`). They fill backwards only, so nothing of the transform
 * remains once they have run. A reader who asked for less motion, or a browser
 * that cannot say (no `matchMedia`), is never given them: the same rule as
 * every other effect (`motionAllowed`), not a class the stylesheet keeps still.
 */
export const VEIL_ENTRANCE_CLASS = 'fx-veil-in';
const PANEL_ENTRANCE_CLASS: Record<DialogEntrance, string> = {
  rise: 'fx-dialog-in',
  // The veil's own fade: opacity only, no transform.
  fade: 'fx-veil-in'
};

/**
 * Past this, an entrance class is taken off even if its animation never ended
 * (ms): a second, or the longest entrance and a margin should one ever last
 * longer (280 ms today; `EFFECT_LENGTH_MS`, which motionEffects.test.ts holds
 * to the stylesheet). An animation that is interrupted sends no
 * `animationend` — its element hidden meanwhile, motion turned off between
 * this script's check and the stylesheet's — and the class it left would play
 * again the next time the element is shown.
 */
const ENTRANCE_NET_MS = Math.max(
  1000,
  Math.max(...[VEIL_ENTRANCE_CLASS, ...Object.values(PANEL_ENTRANCE_CLASS)].map((name) => EFFECT_LENGTH_MS[name] ?? 0)) + 250
);

/**
 * Whether an element still carries its entrance class. It comes off when that
 * element's own animation ends, never on an animation of a
 * descendant, whose events bubble up to it, and after `ENTRANCE_NET_MS` at
 * the latest.
 */
const useEntrance = (ref: React.RefObject<HTMLElement | null>) => {
  const [entering, setEntering] = useState(motionAllowed);
  // A native listener rather than React's `onAnimationEnd`: React picks the
  // event's name once, from what the environment supports, and a mismatch
  // there would leave the class on for good with nothing reporting it. A
  // layout effect, so the listener is there in the commit that puts the class
  // on: a passive effect runs after it, and an end sent in between was lost.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const settle = (e: Event) => {
      if (e.target === element) setEntering(false);
    };
    element.addEventListener('animationend', settle);
    const net = setTimeout(() => setEntering(false), ENTRANCE_NET_MS);
    return () => {
      element.removeEventListener('animationend', settle);
      clearTimeout(net);
    };
  }, [ref]);
  return entering;
};

const withClass = (base: string, extra: string, on: boolean) => (on ? `${base} ${extra}` : base);

const ModalDialog: React.FC<ModalDialogProps> = ({
  label,
  labelledBy,
  onClose,
  closeOnBackdropClick = true,
  overlayClassName = DIALOG_OVERLAY_CLASS,
  panelClassName = DIALOG_PANEL_CLASS,
  overlayTestId,
  entrance = 'rise',
  children
}) => {
  // The entrance runs once, when the dialog mounts: a re-render, or another
  // dialog opening over this one, does not replay it. Nothing animates on the
  // way out — call sites unmount the dialog, and an exit would have to keep a
  // closed dialog's focus trap alive and give focus back late.
  const veilRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const veilEntering = useEntrance(veilRef);
  const panelEntering = useEntrance(panelRef);
  const idRef = useRef<symbol>(Symbol('modal-dialog'));
  // Read through a ref so the effect below can register **once**. Call sites
  // pass inline arrows, so `onClose` has a new identity every render; making
  // the stack registration depend on it let an outer dialog re-render its way
  // to the top of the stack and steal Escape from the inner one.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Called before the focus-in effect below, so the opener is captured while
  // it is still the active element — see the hook for why that has to happen
  // during render rather than in an effect.
  useReturnFocus();

  const focusableInPanel = useCallback((): HTMLElement[] => {
    const panel = panelRef.current;
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter(el => isVisible(el, panel));
  }, []);

  // Move focus into the dialog. Giving it back is `useReturnFocus`'s job.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      // Content that claimed focus itself (an `autoFocus` input) keeps it —
      // that choice is better informed than ours.
      if (panel.contains(document.activeElement)) return;
      const [first] = focusableInPanel();
      (first ?? panel).focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [focusableInPanel]);

  // Escape and the focus trap. Both are document-level: focus can legitimately
  // sit outside the panel (the page behind, or a mis-click), and that is exactly
  // the case a trap has to recover from.
  useEffect(() => {
    const id = idRef.current;
    const unregister = pushDialog(id);

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTopDialog(id)) return;

      if (e.key === 'Escape') {
        const close = onCloseRef.current;
        if (!close) return;
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }

      if (e.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = focusableInPanel();
      if (focusable.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      unregister();
    };
    // Registered once, for the life of the dialog: the stack's order is its
    // nesting order, and nothing about a re-render should change it.
  }, [focusableInPanel]);

  return (
    <div
      ref={veilRef}
      className={withClass(overlayClassName, VEIL_ENTRANCE_CLASS, veilEntering)}
      data-testid={overlayTestId}
      onClick={(e) => {
        if (!onClose || !closeOnBackdropClick) return;
        if (e.target !== e.currentTarget) return;
        onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={withClass(panelClassName, PANEL_ENTRANCE_CLASS[entrance], panelEntering)}
      >
        {children}
      </div>
    </div>
  );
};

export default ModalDialog;
