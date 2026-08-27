import React, { useCallback, useEffect, useRef } from 'react';
import { isTopDialog, pushDialog } from './modalDialogStack';
import { useReturnFocus } from './useReturnFocus';

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
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

/**
 * A hidden control must stay out of the trap's cycle (a collapsed section, a
 * step of a wizard). Deliberately walks the ancestors rather than reading
 * `offsetParent` or `getClientRects()`: those need a layout engine, so in the
 * test environment they report *every* control as hidden and the trap silently
 * does nothing — which is how a focus trap ships broken with a green suite.
 */
const isVisible = (element: HTMLElement, root: HTMLElement): boolean => {
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
  children: React.ReactNode;
}

const ModalDialog: React.FC<ModalDialogProps> = ({
  label,
  labelledBy,
  onClose,
  closeOnBackdropClick = true,
  overlayClassName = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4',
  panelClassName = 'bg-white rounded-2xl shadow-2xl max-w-lg w-full',
  overlayTestId,
  children
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
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
      className={overlayClassName}
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
        className={panelClassName}
      >
        {children}
      </div>
    </div>
  );
};

export default ModalDialog;
