import { describe, expect, it } from 'vitest';
import {
  ACTION_IMPACT_ABSTAIN,
  actionImpactScore,
  actionImpactVoteCount,
  isValidImpactVote,
  mergeActionImpactState
} from '../utils/actionImpact.js';

// The rules in `utils/actionImpact.js` are the reason a whole-action write
// cannot erase a rating. They run identically on the Express routes and in
// dataService, so they are pinned here once rather than twice.
describe('utils/actionImpact', () => {
  describe('isValidImpactVote', () => {
    it('accepts the three scores, the abstention and an explicit clear', () => {
      expect(isValidImpactVote(1)).toBe(true);
      expect(isValidImpactVote(2)).toBe(true);
      expect(isValidImpactVote(3)).toBe(true);
      expect(isValidImpactVote(ACTION_IMPACT_ABSTAIN)).toBe(true);
      expect(isValidImpactVote(null)).toBe(true);
    });

    // Coercion is what turns a wrong vote into a wrong average months later,
    // so anything off the scale is refused rather than converted.
    it('refuses anything off the scale, including a numeric string', () => {
      expect(isValidImpactVote('2')).toBe(false);
      expect(isValidImpactVote(0)).toBe(false);
      expect(isValidImpactVote(4)).toBe(false);
      expect(isValidImpactVote(2.5)).toBe(false);
      expect(isValidImpactVote(undefined)).toBe(false);
      expect(isValidImpactVote(true)).toBe(false);
      expect(isValidImpactVote({})).toBe(false);
    });
  });

  describe('actionImpactScore', () => {
    it('averages the numeric votes', () => {
      expect(actionImpactScore({ impactRatings: { a: 1, b: 2, c: 3 } })).toBe(2);
    });

    // An abstention must not drag the average: it is "not about me", not a zero
    // and not a middle score.
    it('excludes abstentions from both the sum and the divisor', () => {
      const score = actionImpactScore({
        impactRatings: { a: 3, b: ACTION_IMPACT_ABSTAIN, c: ACTION_IMPACT_ABSTAIN }
      });
      expect(score).toBe(3);
    });

    it('returns null when there is no numeric vote at all', () => {
      expect(actionImpactScore({ impactRatings: {} })).toBeNull();
      expect(actionImpactScore({})).toBeNull();
      expect(actionImpactScore({ impactRatings: { a: ACTION_IMPACT_ABSTAIN } })).toBeNull();
    });

    it('counts every answer, abstentions included', () => {
      expect(actionImpactVoteCount({ impactRatings: { a: 1, b: ACTION_IMPACT_ABSTAIN } })).toBe(2);
      expect(actionImpactVoteCount({})).toBe(0);
    });
  });

  describe('mergeActionImpactState', () => {
    const clock = () => '2026-09-09T10:00:00.000Z';

    // The core guarantee: a client that fetched the action before its neighbour
    // voted must not drop that neighbour's vote.
    it('unions ratings instead of replacing them', () => {
      const stored = { id: 'a', done: true, closedAt: '2026-09-01T00:00:00.000Z', impactRatings: { alice: 3 } };
      const incoming = { id: 'a', done: true, impactRatings: { bob: 1 } };

      const merged = mergeActionImpactState(stored, incoming, clock);

      expect(merged.impactRatings).toEqual({ alice: 3, bob: 1 });
    });

    it('keeps every stored vote when the incoming copy knows of none', () => {
      const stored = { id: 'a', done: true, closedAt: '2026-09-01T00:00:00.000Z', impactRatings: { alice: 3 } };
      const incoming = { id: 'a', done: true, text: 'renamed' };

      const merged = mergeActionImpactState(stored, incoming, clock);

      expect(merged.impactRatings).toEqual({ alice: 3 });
      expect(merged.text).toBe('renamed');
    });

    it('lets the incoming vote win for a user present on both sides', () => {
      const stored = { id: 'a', done: true, closedAt: 'x', impactRatings: { alice: 1 } };
      const incoming = { id: 'a', done: true, impactRatings: { alice: 3 } };

      expect(mergeActionImpactState(stored, incoming, clock).impactRatings).toEqual({ alice: 3 });
    });

    it('preserves the deferral marker the incoming copy omits', () => {
      const stored = { id: 'a', done: true, closedAt: 'x', impactDeferredBy: 'retro-7' };
      const incoming = { id: 'a', done: true };

      expect(mergeActionImpactState(stored, incoming, clock).impactDeferredBy).toBe('retro-7');
    });

    it('stamps closedAt when the action becomes closed here', () => {
      const stored = { id: 'a', done: false };
      const incoming = { id: 'a', done: true };

      expect(mergeActionImpactState(stored, incoming, clock).closedAt).toBe('2026-09-09T10:00:00.000Z');
    });

    it('keeps the stored closedAt when the action stays closed', () => {
      const stored = { id: 'a', done: true, closedAt: '2026-09-01T00:00:00.000Z' };
      const incoming = { id: 'a', done: true, text: 'renamed' };

      expect(mergeActionImpactState(stored, incoming, clock).closedAt).toBe('2026-09-01T00:00:00.000Z');
    });

    it('drops closedAt when the action is re-opened', () => {
      const stored = { id: 'a', done: true, closedAt: '2026-09-01T00:00:00.000Z' };
      const incoming = { id: 'a', done: false };

      expect(mergeActionImpactState(stored, incoming, clock).closedAt).toBeUndefined();
    });

    // The subtle one. An action closed before this feature shipped is stored
    // `done: true` with no stamp. Inventing one on the next edit would drag the
    // whole historical backlog into the next rating round.
    it('never invents a closedAt for an action already stored as closed without one', () => {
      const stored = { id: 'a', done: true };
      const incoming = { id: 'a', done: true, text: 'renamed' };

      expect(mergeActionImpactState(stored, incoming, clock).closedAt).toBeUndefined();
    });

    it('stamps a brand-new action that arrives already closed', () => {
      expect(mergeActionImpactState(undefined, { id: 'a', done: true }, clock).closedAt)
        .toBe('2026-09-09T10:00:00.000Z');
    });

    it('mutates neither argument', () => {
      const stored = { id: 'a', done: true, closedAt: 'x', impactRatings: { alice: 3 } };
      const incoming = { id: 'a', done: true, impactRatings: { bob: 1 } };

      mergeActionImpactState(stored, incoming, clock);

      expect(stored.impactRatings).toEqual({ alice: 3 });
      expect(incoming.impactRatings).toEqual({ bob: 1 });
    });

    it('leaves no empty ratings object behind', () => {
      const merged = mergeActionImpactState({ id: 'a', done: false }, { id: 'a', done: false }, clock);
      expect('impactRatings' in merged).toBe(false);
    });
  });
});
