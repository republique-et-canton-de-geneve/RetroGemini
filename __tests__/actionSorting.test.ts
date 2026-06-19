import { describe, expect, it } from 'vitest';
import { getActionTimestamp, sortActionsByRecency, SortableAction } from '../components/dashboard/actionSorting';

const makeAction = (overrides: Partial<SortableAction>): SortableAction => ({
  id: Math.random().toString(36).slice(2),
  text: 'Action',
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  ...overrides
});

describe('actionSorting', () => {
  describe('getActionTimestamp', () => {
    it('uses the ISO createdAt field when present', () => {
      const action = makeAction({ createdAt: '2026-02-15T10:00:00.000Z' });
      expect(getActionTimestamp(action)).toBe(Date.parse('2026-02-15T10:00:00.000Z'));
    });

    it('falls back to the origin session date for legacy actions', () => {
      const action = makeAction({ originDate: '6/19/2026' });
      expect(getActionTimestamp(action)).toBe(Date.parse('6/19/2026'));
    });

    it('parses day-first locale dates that the native parser rejects', () => {
      const action = makeAction({ originDate: '19/06/2026' });
      const expected = new Date(2026, 5, 19).getTime();
      expect(getActionTimestamp(action)).toBe(expected);
    });

    it('returns 0 when no usable date is available', () => {
      const action = makeAction({});
      expect(getActionTimestamp(action)).toBe(0);
    });

    it('prefers createdAt over the origin date', () => {
      const action = makeAction({ createdAt: '2026-03-01T00:00:00.000Z', originDate: '1/1/2020' });
      expect(getActionTimestamp(action)).toBe(Date.parse('2026-03-01T00:00:00.000Z'));
    });
  });

  describe('sortActionsByRecency', () => {
    it('orders actions from most recent to oldest by creation date', () => {
      const older = makeAction({ id: 'older', createdAt: '2026-01-01T00:00:00.000Z' });
      const newest = makeAction({ id: 'newest', createdAt: '2026-06-01T00:00:00.000Z' });
      const middle = makeAction({ id: 'middle', createdAt: '2026-03-01T00:00:00.000Z' });

      const sorted = sortActionsByRecency([older, newest, middle]);

      expect(sorted.map((a) => a.id)).toEqual(['newest', 'middle', 'older']);
    });

    it('keeps the same ordering for closed (done) actions', () => {
      const older = makeAction({ id: 'older', done: true, createdAt: '2025-12-01T00:00:00.000Z' });
      const newest = makeAction({ id: 'newest', done: true, createdAt: '2026-05-10T00:00:00.000Z' });

      const sorted = sortActionsByRecency([older, newest]);

      expect(sorted.map((a) => a.id)).toEqual(['newest', 'older']);
    });

    it('is stable for actions sharing the same timestamp', () => {
      const first = makeAction({ id: 'first', createdAt: '2026-01-01T00:00:00.000Z' });
      const second = makeAction({ id: 'second', createdAt: '2026-01-01T00:00:00.000Z' });

      const sorted = sortActionsByRecency([first, second]);

      expect(sorted.map((a) => a.id)).toEqual(['first', 'second']);
    });

    it('sorts actions without a date after dated actions', () => {
      const dated = makeAction({ id: 'dated', createdAt: '2020-01-01T00:00:00.000Z' });
      const undated = makeAction({ id: 'undated' });

      const sorted = sortActionsByRecency([undated, dated]);

      expect(sorted.map((a) => a.id)).toEqual(['dated', 'undated']);
    });

    it('does not mutate the input array', () => {
      const actions = [
        makeAction({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }),
        makeAction({ id: 'b', createdAt: '2026-02-01T00:00:00.000Z' })
      ];
      const snapshot = actions.map((a) => a.id);

      sortActionsByRecency(actions);

      expect(actions.map((a) => a.id)).toEqual(snapshot);
    });
  });
});
