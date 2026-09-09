import { describe, expect, it } from 'vitest';
import {
  ACTION_IMPACT_ABSTAIN,
  actionImpactScore,
  actionImpactVoteCount,
  isValidImpactVote,
  isValidRaterId,
  mergeActionImpactState,
  withRaterVote
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

  // CodeQL js/remote-property-injection: the vote is stored under a key the
  // caller supplies, so the id is validated before it is ever used as one.
  describe('isValidRaterId', () => {
    it('accepts the ids the product actually mints', () => {
      expect(isValidRaterId('a1b2c3d4e')).toBe(true);
      expect(isValidRaterId('user.name-1_2')).toBe(true);
    });

    // The charset test alone would let these through — both halves of the
    // guard are load-bearing.
    it('refuses the keys that change an object instead of filling it', () => {
      expect(isValidRaterId('__proto__')).toBe(false);
      expect(isValidRaterId('constructor')).toBe(false);
      expect(isValidRaterId('prototype')).toBe(false);
    });

    it('refuses anything unbounded, empty or not a string', () => {
      expect(isValidRaterId('')).toBe(false);
      expect(isValidRaterId('a'.repeat(65))).toBe(false);
      expect(isValidRaterId('has space')).toBe(false);
      expect(isValidRaterId('sql;drop')).toBe(false);
      expect(isValidRaterId(null)).toBe(false);
      expect(isValidRaterId(42)).toBe(false);
      expect(isValidRaterId(undefined)).toBe(false);
    });
  });

  describe('withRaterVote', () => {
    it('sets and clears one entry without touching the others', () => {
      const before = { alice: 3 };
      expect(withRaterVote(before, 'bob', 1)).toEqual({ alice: 3, bob: 1 });
      expect(withRaterVote({ alice: 3, bob: 1 }, 'bob', null)).toEqual({ alice: 3 });
      expect(before).toEqual({ alice: 3 });
    });

    // The guard lives in the same function as the write, so "the caller already
    // checked" cannot become false at the next call site.
    it('refuses a dangerous key rather than trusting its caller', () => {
      for (const key of ['__proto__', 'constructor', 'prototype', '', 'a'.repeat(65)]) {
        expect(() => withRaterVote({ alice: 3 }, key, 1), key).toThrow(TypeError);
      }

      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    });

    // Built through a Map and Object.fromEntries, so there is no computed
    // property write for a tainted key to land in at all.
    it('never writes through a computed property, and round-trips as plain JSON', () => {
      const result = withRaterVote({ alice: 3 }, 'bob', 1);

      expect(JSON.parse(JSON.stringify(result))).toEqual({ alice: 3, bob: 1 });
      expect(Object.prototype.hasOwnProperty.call(result, 'bob')).toBe(true);
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
    //
    // Unioning the two sides was the first shape of this and it was wrong. A
    // vote is only ever written by /action/impact, so a whole-action write
    // carrying one is by definition a stale copy — and after a participant
    // clears their rating, that copy would put the withdrawn vote back. The
    // stored map wins outright.
    it('keeps the stored ratings and ignores whatever the caller carries', () => {
      const stored = { id: 'a', done: true, closedAt: '2026-09-01T00:00:00.000Z', impactRatings: { alice: 3 } };
      const incoming = { id: 'a', done: true, impactRatings: { bob: 1 } };

      const merged = mergeActionImpactState(stored, incoming, clock);

      expect(merged.impactRatings).toEqual({ alice: 3 });
    });

    it('does not resurrect a vote the participant cleared through the narrow route', () => {
      // The store no longer has alice's vote; a client that never saw the clear
      // re-persists the whole action with it.
      const stored = { id: 'a', done: true, closedAt: 'x', impactRatings: { bob: 1 } };
      const incoming = { id: 'a', done: true, impactRatings: { alice: 3, bob: 1 } };

      expect(mergeActionImpactState(stored, incoming, clock).impactRatings).toEqual({ bob: 1 });
    });

    it('leaves an unrated action unrated even when a stale blob claims votes', () => {
      const stored = { id: 'a', done: true, closedAt: 'x' };
      const incoming = { id: 'a', done: true, impactRatings: { alice: 3 } };

      expect(mergeActionImpactState(stored, incoming, clock).impactRatings).toBeUndefined();
    });

    it('keeps every stored vote when the incoming copy knows of none', () => {
      const stored = { id: 'a', done: true, closedAt: '2026-09-01T00:00:00.000Z', impactRatings: { alice: 3 } };
      const incoming = { id: 'a', done: true, text: 'renamed' };

      const merged = mergeActionImpactState(stored, incoming, clock);

      expect(merged.impactRatings).toEqual({ alice: 3 });
      expect(merged.text).toBe('renamed');
    });

    it('keeps the stored value for a user present on both sides', () => {
      const stored = { id: 'a', done: true, closedAt: 'x', impactRatings: { alice: 1 } };
      const incoming = { id: 'a', done: true, impactRatings: { alice: 3 } };

      expect(mergeActionImpactState(stored, incoming, clock).impactRatings).toEqual({ alice: 1 });
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
