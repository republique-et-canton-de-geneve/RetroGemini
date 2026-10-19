import { RefObject, useCallback, useLayoutEffect, useState } from 'react';
import {
  BoardOverflow,
  BoardScroll,
  ColumnSpan,
  boardOverflow,
  columnsInView,
  scrollToNeighbour,
  scrollToReveal
} from './boardColumns';

/**
 * Measures the board's columns (`[data-column-id]` children of the scroller)
 * and keeps `BoardColumnNavigator` told which are on screen. Re-measured on
 * scroll, on any resize of the board or a column (cards added, the
 * participants panel collapsed, the window resized) and when the columns
 * themselves change.
 */

export interface BoardColumnsInView extends BoardOverflow {
  visibleIds: string[];
  previous: () => void;
  next: () => void;
  reveal: (columnId: string) => void;
}

const NOTHING: BoardOverflow & { visibleIds: string[] } = {
  overflowing: false,
  canScrollLeft: false,
  canScrollRight: false,
  visibleIds: []
};

const measure = (scroller: HTMLElement): { scroll: BoardScroll; columns: ColumnSpan[] } => {
  const origin = scroller.getBoundingClientRect().left - scroller.scrollLeft;
  const columns = Array.from(scroller.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement && !!child.dataset.columnId)
    .map((child) => {
      const rect = child.getBoundingClientRect();
      return { id: child.dataset.columnId as string, left: rect.left - origin, right: rect.right - origin };
    });
  return {
    scroll: { scrollLeft: scroller.scrollLeft, clientWidth: scroller.clientWidth, scrollWidth: scroller.scrollWidth },
    columns
  };
};

const sameState = (a: typeof NOTHING, b: typeof NOTHING) =>
  a.overflowing === b.overflowing
  && a.canScrollLeft === b.canScrollLeft
  && a.canScrollRight === b.canScrollRight
  && a.visibleIds.length === b.visibleIds.length
  && a.visibleIds.every((id, i) => id === b.visibleIds[i]);

const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const useBoardColumnsInView = (
  scrollerRef: RefObject<HTMLElement | null>,
  /** Changes when the columns do: their ids, joined. */
  columnsKey: string
): BoardColumnsInView => {
  const [state, setState] = useState(NOTHING);

  const update = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const { scroll, columns } = measure(scroller);
    const next = { ...boardOverflow(scroll), visibleIds: columnsInView(columns, scroll) };
    setState((previous) => (sameState(previous, next) ? previous : next));
  }, [scrollerRef]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(scroller);
      for (const child of Array.from(scroller.children)) observer.observe(child);
    }
    return () => {
      scroller.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [scrollerRef, update, columnsKey]);

  const scrollTo = useCallback((pick: (scroll: BoardScroll, columns: ColumnSpan[]) => number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const { scroll, columns } = measure(scroller);
    const left = pick(scroll, columns);
    if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } else {
      scroller.scrollLeft = left;
    }
  }, [scrollerRef]);

  const previous = useCallback(() => scrollTo((scroll, columns) => scrollToNeighbour('previous', columns, scroll)), [scrollTo]);
  const next = useCallback(() => scrollTo((scroll, columns) => scrollToNeighbour('next', columns, scroll)), [scrollTo]);
  const reveal = useCallback((columnId: string) => scrollTo((scroll, columns) => {
    const column = columns.find((candidate) => candidate.id === columnId);
    return column ? scrollToReveal(column, scroll) : scroll.scrollLeft;
  }), [scrollTo]);

  return { ...state, previous, next, reveal };
};
