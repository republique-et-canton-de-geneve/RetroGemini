import { describe, expect, it } from 'vitest';
import {
  IN_VIEW_FRACTION,
  REVEAL_MARGIN_PX,
  boardOverflow,
  columnsInView,
  scrollToNeighbour,
  scrollToReveal
} from '../components/session/boardColumns';

/**
 * The geometry behind the board's column navigator
 * (`components/session/boardColumns.ts`). A Starfish board — five columns of
 * 300px with 24px gaps after 24px of padding — in a 1000px-wide board: three
 * columns and a bit fit, the fourth is cut, the fifth is off screen. That is
 * the shape of the field report: the column nobody saw was the last one.
 */

const COLUMN = 300;
const GAP = 24;
const PADDING = 24;
const columns = ['stop', 'less', 'keep', 'more', 'start'].map((id, i) => {
  const left = PADDING + i * (COLUMN + GAP);
  return { id, left, right: left + COLUMN };
});
const scrollWidth = columns[columns.length - 1].right + PADDING; // 1644
const at = (scrollLeft: number, clientWidth = 1000) => ({ scrollLeft, clientWidth, scrollWidth });

describe('boardOverflow', () => {
  it('says nothing overflows when the columns fit, even by a sub-pixel', () => {
    expect(boardOverflow({ scrollLeft: 0, clientWidth: 1644, scrollWidth: 1644.6 })).toEqual({
      overflowing: false,
      canScrollLeft: false,
      canScrollRight: false
    });
  });

  it('tells which way there is more to see', () => {
    expect(boardOverflow(at(0))).toEqual({ overflowing: true, canScrollLeft: false, canScrollRight: true });
    expect(boardOverflow(at(300))).toEqual({ overflowing: true, canScrollLeft: true, canScrollRight: true });
    expect(boardOverflow(at(644))).toEqual({ overflowing: true, canScrollLeft: true, canScrollRight: false });
  });
});

describe('columnsInView', () => {
  it('counts a column once most of it shows, so a sliver at the edge reads as off screen', () => {
    // The 4th column spans 996-1296: 4px of it show. The 5th is off screen.
    expect(columnsInView(columns, at(0))).toEqual(['stop', 'less', 'keep']);
    // Scrolled so 60% of the 4th shows (996 + 180 = 1176 = 1000 + 176).
    expect(IN_VIEW_FRACTION).toBe(0.6);
    expect(columnsInView(columns, at(176))).toEqual(['less', 'keep', 'more']);
    expect(columnsInView(columns, at(644))).toEqual(['keep', 'more', 'start']);
  });

  it('ignores a column with no width', () => {
    expect(columnsInView([{ id: 'x', left: 10, right: 10 }], at(0))).toEqual([]);
  });
});

describe('scrollToReveal', () => {
  it('moves just enough to show the whole column with a margin, either way', () => {
    // The 5th column ends at 1620: its right edge plus the margin lands on the board's right edge.
    expect(scrollToReveal(columns[4], at(0))).toBe(columns[4].right + REVEAL_MARGIN_PX - 1000);
    // Back to the first: its left edge minus the margin, clamped at 0.
    expect(scrollToReveal(columns[0], at(500))).toBe(0);
    // Already fully in view: no move.
    expect(scrollToReveal(columns[1], at(0))).toBe(0);
  });

  it('shows the start of a column wider than the board', () => {
    const wide = { id: 'wide', left: 100, right: 1300 };
    expect(scrollToReveal(wide, { scrollLeft: 0, clientWidth: 800, scrollWidth: 2000 })).toBe(100 - REVEAL_MARGIN_PX);
  });

  it('never scrolls past either end', () => {
    expect(scrollToReveal({ id: 'end', left: 1500, right: 1640 }, at(0), 100)).toBe(644);
  });
});

describe('scrollToNeighbour', () => {
  it('next brings in the first column past the right edge, the cut one included', () => {
    expect(scrollToNeighbour('next', columns, at(0))).toBe(scrollToReveal(columns[3], at(0)));
    const second = scrollToReveal(columns[3], at(0));
    expect(scrollToNeighbour('next', columns, at(second))).toBe(scrollToReveal(columns[4], at(second)));
  });

  it('previous brings back the last column before the left edge', () => {
    expect(scrollToNeighbour('previous', columns, at(644))).toBe(scrollToReveal(columns[1], at(644)));
  });

  it('goes to the end, or the start, when nothing is left that way', () => {
    expect(scrollToNeighbour('next', columns, at(644))).toBe(644);
    expect(scrollToNeighbour('previous', columns, at(0))).toBe(0);
  });
});
