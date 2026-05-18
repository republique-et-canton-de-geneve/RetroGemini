import { useEffect, useRef } from 'react';

/**
 * Drag-to-scroll helper for the Group phase.
 *
 * When a ticket is being dragged, listen to mouse position and
 * auto-scroll the vertical and horizontal containers when the
 * pointer enters a wide hot zone near the edges. Without this,
 * users complain that the actionable area to scroll up while
 * dragging is a thin sliver above the column header.
 *
 * The scroller accessors are kept in refs so the effect only
 * re-attaches when `active` toggles. Without that guard, the
 * parent re-renders on every `dragover` (because it updates
 * `dragTarget`) would tear down and reinstall the listeners
 * many times per second, resetting the scroll velocity to 0
 * before the next animation frame could run.
 */

export interface DragAutoScrollOptions {
  /** Element whose vertical scroll position should be adjusted. */
  verticalScroller: () => HTMLElement | null;
  /** Element whose horizontal scroll position should be adjusted. */
  horizontalScroller: () => HTMLElement | null;
  /** When false, the listeners are not attached. */
  active: boolean;
  /** Hot zone size in pixels near each edge. Default 140px. */
  edgeSize?: number;
  /** Maximum scroll speed in pixels per frame. Default 22px. */
  maxSpeed?: number;
}

export const useDragAutoScroll = ({
  verticalScroller,
  horizontalScroller,
  active,
  edgeSize = 140,
  maxSpeed = 22,
}: DragAutoScrollOptions): void => {
  const verticalScrollerRef = useRef(verticalScroller);
  const horizontalScrollerRef = useRef(horizontalScroller);
  verticalScrollerRef.current = verticalScroller;
  horizontalScrollerRef.current = horizontalScroller;

  const stateRef = useRef({ vDir: 0, hDir: 0, rafId: 0 as number | 0 });

  useEffect(() => {
    if (!active) {
      stateRef.current.vDir = 0;
      stateRef.current.hDir = 0;
      return;
    }

    const computeSpeed = (distance: number): number => {
      if (distance >= edgeSize) return 0;
      const clamped = Math.max(0, distance);
      const ratio = 1 - clamped / edgeSize;
      return Math.ceil(maxSpeed * ratio * ratio);
    };

    const updateFromPoint = (clientX: number, clientY: number) => {
      let vDir = 0;
      let hDir = 0;

      const vEl = verticalScrollerRef.current();
      if (vEl) {
        const rect = vEl.getBoundingClientRect();
        const distTop = clientY - rect.top;
        const distBottom = rect.bottom - clientY;
        if (clientY >= rect.top - edgeSize && clientY <= rect.bottom + edgeSize) {
          if (distTop < edgeSize) vDir = -computeSpeed(distTop);
          else if (distBottom < edgeSize) vDir = computeSpeed(distBottom);
        }
      }

      const hEl = horizontalScrollerRef.current();
      if (hEl) {
        const rect = hEl.getBoundingClientRect();
        const distLeft = clientX - rect.left;
        const distRight = rect.right - clientX;
        if (clientX >= rect.left - edgeSize && clientX <= rect.right + edgeSize) {
          if (distLeft < edgeSize) hDir = -computeSpeed(distLeft);
          else if (distRight < edgeSize) hDir = computeSpeed(distRight);
        }
      }

      stateRef.current.vDir = vDir;
      stateRef.current.hDir = hDir;
    };

    const onDragOver = (e: DragEvent) => {
      updateFromPoint(e.clientX, e.clientY);
    };

    const onDrag = (e: DragEvent) => {
      if (e.clientX === 0 && e.clientY === 0) return;
      updateFromPoint(e.clientX, e.clientY);
    };

    // Touch-selection fallback: when the user has tap-selected a card and
    // is moving the pointer to find a drop target, `dragover` does not
    // fire because no HTML5 drag is happening. Use `pointermove` so the
    // hot-zone scroll still kicks in.
    const onPointerMove = (e: PointerEvent) => {
      updateFromPoint(e.clientX, e.clientY);
    };

    const tick = () => {
      const { vDir, hDir } = stateRef.current;
      if (vDir !== 0) {
        const el = verticalScrollerRef.current();
        if (el) el.scrollTop += vDir;
      }
      if (hDir !== 0) {
        const el = horizontalScrollerRef.current();
        if (el) el.scrollLeft += hDir;
      }
      stateRef.current.rafId = requestAnimationFrame(tick);
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drag', onDrag);
    window.addEventListener('pointermove', onPointerMove);
    stateRef.current.rafId = requestAnimationFrame(tick);

    const state = stateRef.current;
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drag', onDrag);
      window.removeEventListener('pointermove', onPointerMove);
      if (state.rafId) {
        cancelAnimationFrame(state.rafId);
      }
      state.vDir = 0;
      state.hDir = 0;
    };
  }, [active, edgeSize, maxSpeed]);
};
