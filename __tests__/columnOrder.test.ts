import { describe, it, expect } from 'vitest';
import { canMoveColumn, moveColumn } from '../utils/columnOrder';

const cols = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('moveColumn', () => {
  it('swaps a column with its neighbour in the asked direction', () => {
    expect(moveColumn(cols, 'b', -1).map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(moveColumn(cols, 'b', 1).map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });

  it('keeps every column, and only the order changes', () => {
    const moved = moveColumn(cols, 'a', 1);
    expect(moved).toHaveLength(3);
    expect(moved[1]).toBe(cols[0]);
    expect(moved[0]).toBe(cols[1]);
  });

  it('never edits the array it is given', () => {
    const before = cols.map((c) => c.id);
    moveColumn(cols, 'a', 1);
    expect(cols.map((c) => c.id)).toEqual(before);
  });

  // The same array back is how a caller knows a click had nothing to do, so a
  // session sends no write for it.
  it('returns the same array when the column is already at that edge or unknown', () => {
    expect(moveColumn(cols, 'a', -1)).toBe(cols);
    expect(moveColumn(cols, 'c', 1)).toBe(cols);
    expect(moveColumn(cols, 'zz', 1)).toBe(cols);
  });
});

describe('canMoveColumn', () => {
  it('is false at each edge only', () => {
    expect(canMoveColumn(0, 3, -1)).toBe(false);
    expect(canMoveColumn(0, 3, 1)).toBe(true);
    expect(canMoveColumn(2, 3, 1)).toBe(false);
    expect(canMoveColumn(2, 3, -1)).toBe(true);
  });

  it('is false for a single column or an index outside the list', () => {
    expect(canMoveColumn(0, 1, 1)).toBe(false);
    expect(canMoveColumn(-1, 3, 1)).toBe(false);
    expect(canMoveColumn(3, 3, -1)).toBe(false);
  });
});
