/**
 * Which board columns are on screen, and where to scroll to show the others.
 *
 * A retro with a fifth column used to show four of them and a horizontal
 * scrollbar at the bottom of a tall board: neither the facilitator nor the
 * participants noticed the fifth, and its cards went unread. The board now
 * shares its width between the columns first (`Session.tsx`); when they still
 * do not fit, `BoardColumnNavigator` names every column and says which ones are
 * off screen. This module is the geometry behind it, pure so that it can be
 * tested without a layout engine — jsdom measures every element at zero.
 *
 * Every position here is in the scroller's *content* coordinates: a column's
 * left edge is where it sits when `scrollLeft` is 0.
 */

export interface ColumnSpan {
  id: string;
  left: number;
  right: number;
}

export interface BoardScroll {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

export interface BoardOverflow {
  overflowing: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

// Sub-pixel layouts leave a fraction of a pixel of "overflow" that no one can
// scroll to; a pixel of slack keeps the navigator from appearing for nothing.
const SLACK_PX = 1;

/** Space kept between a revealed column and the board's edge. */
export const REVEAL_MARGIN_PX = 24;

/**
 * A column counts as in view once most of it is: a sliver at the edge is
 * exactly the column people overlook, so it still reads as off screen.
 */
export const IN_VIEW_FRACTION = 0.6;

export const boardOverflow = ({ scrollLeft, clientWidth, scrollWidth }: BoardScroll): BoardOverflow => {
  const overflowing = scrollWidth - clientWidth > SLACK_PX;
  return {
    overflowing,
    canScrollLeft: overflowing && scrollLeft > SLACK_PX,
    canScrollRight: overflowing && scrollLeft + clientWidth < scrollWidth - SLACK_PX
  };
};

export const columnsInView = (
  columns: readonly ColumnSpan[],
  { scrollLeft, clientWidth }: Pick<BoardScroll, 'scrollLeft' | 'clientWidth'>
): string[] => {
  const viewLeft = scrollLeft;
  const viewRight = scrollLeft + clientWidth;
  return columns
    .filter((column) => {
      const width = column.right - column.left;
      if (width <= 0) return false;
      const shown = Math.min(column.right, viewRight) - Math.max(column.left, viewLeft);
      return shown >= width * IN_VIEW_FRACTION;
    })
    .map((column) => column.id);
};

const clampScroll = (value: number, { clientWidth, scrollWidth }: Pick<BoardScroll, 'clientWidth' | 'scrollWidth'>) =>
  Math.max(0, Math.min(value, Math.max(0, scrollWidth - clientWidth)));

/** The `scrollLeft` that brings one column fully into view, moving as little as possible. */
export const scrollToReveal = (column: ColumnSpan, scroll: BoardScroll, margin = REVEAL_MARGIN_PX): number => {
  const { scrollLeft, clientWidth } = scroll;
  if (column.left - margin < scrollLeft) return clampScroll(column.left - margin, scroll);
  if (column.right + margin > scrollLeft + clientWidth) {
    // A column wider than the board shows its start, where its title and its
    // input are, rather than its end.
    const target = column.right - column.left + 2 * margin > clientWidth
      ? column.left - margin
      : column.right + margin - clientWidth;
    return clampScroll(target, scroll);
  }
  return scrollLeft;
};

/**
 * Where "next" and "previous" go: to the first column past the right edge, or
 * the last one before the left edge, never by a fixed distance — a jump that
 * lands mid-column hides as much as it shows.
 */
export const scrollToNeighbour = (
  direction: 'previous' | 'next',
  columns: readonly ColumnSpan[],
  scroll: BoardScroll,
  margin = REVEAL_MARGIN_PX
): number => {
  const visible = new Set(columnsInView(columns, scroll));
  const viewLeft = scroll.scrollLeft;
  const viewRight = scroll.scrollLeft + scroll.clientWidth;
  if (direction === 'next') {
    const target = columns.find((column) => !visible.has(column.id) && column.right > viewRight + SLACK_PX);
    return target ? scrollToReveal(target, scroll, margin) : clampScroll(scroll.scrollWidth, scroll);
  }
  const target = [...columns].reverse().find((column) => !visible.has(column.id) && column.left < viewLeft - SLACK_PX);
  return target ? scrollToReveal(target, scroll, margin) : 0;
};
