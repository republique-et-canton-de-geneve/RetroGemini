import { useEffect, useRef } from 'react';

/**
 * Drag-to-scroll helper for the Group phase.
 *
 * When a ticket is being dragged, listen to mouse position and
 * auto-scroll the vertical and horizontal containers when the
 * pointer enters a wide hot zone near the edges. Without this,
 * users complain that the actionable area to scroll up while
 * dragging is a thin sliver above the column header.
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

      const vEl = verticalScroller();
      if (vEl) {
        const rect = vEl.getBoundingClientRect();
        const distTop = clientY - rect.top;
        const distBottom = rect.bottom - clientY;
        if (clientY >= rect.top - edgeSize && clientY <= rect.bottom + edgeSize) {
          if (distTop < edgeSize) vDir = -computeSpeed(distTop);
          else if (distBottom < edgeSize) vDir = computeSpeed(distBottom);
        }
      }

      const hEl = horizontalScroller();
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

    const tick = () => {
      const { vDir, hDir } = stateRef.current;
      if (vDir !== 0) {
        const el = verticalScroller();
        if (el) el.scrollTop += vDir;
      }
      if (hDir !== 0) {
        const el = horizontalScroller();
        if (el) el.scrollLeft += hDir;
      }
      stateRef.current.rafId = requestAnimationFrame(tick);
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drag', onDrag);
    stateRef.current.rafId = requestAnimationFrame(tick);

    const state = stateRef.current;
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drag', onDrag);
      if (state.rafId) {
        cancelAnimationFrame(state.rafId);
      }
      state.vDir = 0;
      state.hDir = 0;
    };
  }, [active, edgeSize, maxSpeed, verticalScroller, horizontalScroller]);
};
