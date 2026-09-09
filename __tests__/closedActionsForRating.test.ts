import { describe, expect, it } from 'vitest';
import { ActionImpactVote, ActionItem, RetroSession, Team } from '../types';
import {
  impactRatingProgress,
  isActionImpactRatingEnabled,
  selectClosedActionsForRating
} from '../components/session/closedActionsForRating';

const action = (overrides: Partial<ActionItem>): ActionItem => ({
  id: 'action',
  text: 'Do the thing',
  assigneeId: null,
  done: true,
  type: 'new',
  proposalVotes: {},
  closedAt: '2026-05-01T00:00:00.000Z',
  ...overrides
});

// Only the fields the selection reads. Retrospectives are newest-first in the
// team record (dataService unshifts new ones), which is the order the "most
// recent retro that listed this action" lookup relies on.
const retro = (id: string, date: string, listed: ActionItem[] = []): RetroSession =>
  ({ id, date, closedActionsSnapshot: listed } as unknown as RetroSession);

const team = (overrides: Partial<Team> = {}): Team => ({
  id: 'team-1',
  name: 'Team',
  passwordHash: 'x',
  members: [],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  ...overrides
});

const session = (id: string, openActionsSnapshot: ActionItem[] = []): RetroSession =>
  ({ id, openActionsSnapshot } as unknown as RetroSession);

describe('closedActionsForRating', () => {
  describe('isActionImpactRatingEnabled', () => {
    // The feature ships on. A team that does not want it turns it off once,
    // and absent must read as on so no existing record needs migrating.
    it('is on when the team has never touched the setting', () => {
      expect(isActionImpactRatingEnabled(team())).toBe(true);
    });

    it('is off only when the team explicitly turned it off', () => {
      expect(isActionImpactRatingEnabled(team({ actionImpactRatingEnabled: false }))).toBe(false);
      expect(isActionImpactRatingEnabled(team({ actionImpactRatingEnabled: true }))).toBe(true);
    });
  });

  describe('selectClosedActionsForRating', () => {
    it('lists a closed action no retro has asked about yet', () => {
      const a = action({ id: 'a' });
      const selected = selectClosedActionsForRating(
        team({ globalActions: [a], retrospectives: [retro('r2', '6/1/2026')] }),
        session('r2')
      );

      expect(selected.map((item) => item.id)).toEqual(['a']);
    });

    it('returns nothing when the team turned the rating off', () => {
      const a = action({ id: 'a' });
      const selected = selectClosedActionsForRating(
        team({ globalActions: [a], actionImpactRatingEnabled: false }),
        session('r2')
      );

      expect(selected).toEqual([]);
    });

    it('skips actions that are still open', () => {
      const open = action({ id: 'open', done: false, closedAt: undefined });
      expect(selectClosedActionsForRating(team({ globalActions: [open] }), session('r2'))).toEqual([]);
    });

    // The whole historical backlog is `done` with no stamp. Without this rule
    // the first retro after deployment would ask about years of actions.
    it('skips actions closed before closedAt existed', () => {
      const legacy = action({ id: 'legacy', closedAt: undefined });
      expect(selectClosedActionsForRating(team({ globalActions: [legacy] }), session('r2'))).toEqual([]);
    });

    it('skips proposals, which are not actions yet', () => {
      const proposal = action({ id: 'p', type: 'proposal' });
      expect(selectClosedActionsForRating(team({ globalActions: [proposal] }), session('r2'))).toEqual([]);
    });

    // The one-retro lag, enforced structurally. An action the facilitator ticks
    // off in block (a) right now has produced nothing observable yet, so it
    // belongs to the next retro's round, not this one.
    it('skips an action closed during this very session', () => {
      const justClosed = action({ id: 'just-closed' });
      const selected = selectClosedActionsForRating(
        team({ globalActions: [justClosed] }),
        session('r2', [action({ id: 'just-closed', done: false, closedAt: undefined })])
      );

      expect(selected).toEqual([]);
    });

    it('does not ask again about an action a previous retro already listed', () => {
      const a = action({ id: 'a' });
      const selected = selectClosedActionsForRating(
        team({
          globalActions: [a],
          retrospectives: [retro('r2', '6/1/2026'), retro('r1', '5/1/2026', [a])]
        }),
        session('r2')
      );

      expect(selected).toEqual([]);
    });

    it('asks again when the previous retro deferred it with Rate later', () => {
      const a = action({ id: 'a', impactDeferredBy: 'r1' });
      const selected = selectClosedActionsForRating(
        team({
          globalActions: [a],
          retrospectives: [retro('r2', '6/1/2026'), retro('r1', '5/1/2026', [a])]
        }),
        session('r2')
      );

      expect(selected.map((item) => item.id)).toEqual(['a']);
    });

    // The deferral is self-limiting: it carries an action into exactly the next
    // retro, not into every retro from then on.
    it('stops asking at the retro after a deferral that was not renewed', () => {
      const a = action({ id: 'a', impactDeferredBy: 'r1' });
      const selected = selectClosedActionsForRating(
        team({
          globalActions: [a],
          retrospectives: [
            retro('r3', '7/1/2026'),
            retro('r2', '6/1/2026', [a]),
            retro('r1', '5/1/2026', [a])
          ]
        }),
        session('r3')
      );

      expect(selected).toEqual([]);
    });

    it('keeps asking while the facilitator keeps deferring', () => {
      const a = action({ id: 'a', impactDeferredBy: 'r2' });
      const selected = selectClosedActionsForRating(
        team({
          globalActions: [a],
          retrospectives: [
            retro('r3', '7/1/2026'),
            retro('r2', '6/1/2026', [a]),
            retro('r1', '5/1/2026', [a])
          ]
        }),
        session('r3')
      );

      expect(selected.map((item) => item.id)).toEqual(['a']);
    });

    it('drops an action the facilitator deferred during this same round', () => {
      const a = action({ id: 'a', impactDeferredBy: 'r2' });
      const selected = selectClosedActionsForRating(
        team({ globalActions: [a], retrospectives: [retro('r2', '6/1/2026')] }),
        session('r2')
      );

      expect(selected).toEqual([]);
    });

    it('collects actions from retrospectives and health checks, not just the dashboard', () => {
      const fromRetro = action({ id: 'from-retro', closedAt: '2026-05-02T00:00:00.000Z' });
      const fromHealthCheck = action({ id: 'from-hc', closedAt: '2026-05-03T00:00:00.000Z' });
      const fromDashboard = action({ id: 'from-dashboard', closedAt: '2026-05-01T00:00:00.000Z' });

      const selected = selectClosedActionsForRating(
        team({
          globalActions: [fromDashboard],
          retrospectives: [
            retro('r2', '6/1/2026'),
            { ...retro('r1', '5/1/2026'), actions: [fromRetro] } as unknown as RetroSession
          ],
          healthChecks: [{ id: 'hc1', actions: [fromHealthCheck] } as never]
        }),
        session('r2')
      );

      // Most recently closed first.
      expect(selected.map((item) => item.id)).toEqual(['from-hc', 'from-retro', 'from-dashboard']);
    });

    it('never lists the same action twice', () => {
      const a = action({ id: 'a' });
      const selected = selectClosedActionsForRating(
        team({
          globalActions: [a],
          retrospectives: [
            retro('r2', '6/1/2026'),
            { ...retro('r1', '5/1/2026'), actions: [a] } as unknown as RetroSession
          ]
        }),
        session('r2')
      );

      expect(selected).toHaveLength(1);
    });
  });
});

// Findings from the Codex review on PR #460.
describe('closedActionsForRating - review findings', () => {
  const closed = (overrides: Partial<ActionItem>): ActionItem => ({
    id: 'action',
    text: 'Do the thing',
    assigneeId: null,
    done: true,
    type: 'new',
    proposalVotes: {},
    closedAt: '2026-05-01T00:00:00.000Z',
    ...overrides
  });

  // A facilitator can create an action in Discuss, close it in Review, then
  // jump back to Open Actions from the phase header. It was never in the entry
  // snapshot, so the structural lag check would not have caught it.
  it('never auto-presents an action this very retrospective created', () => {
    const own = closed({ id: 'own' });
    const t = team({
      retrospectives: [
        { ...retro('r2', '6/1/2026'), actions: [own] } as unknown as RetroSession,
        retro('r1', '5/1/2026')
      ]
    });

    expect(selectClosedActionsForRating(t, session('r2'))).toEqual([]);
  });

  // "Most recent retro that asked" used to be decided by parsing `retro.date`,
  // which is a locale-formatted day: in a day-first locale "1 June" parses as
  // 6 January, so the ordering silently inverted and a deferral repeated or
  // vanished. Array order is newest-first and exact.
  it('identifies the most recent asker by record order, not by parsing an ambiguous date', () => {
    const a = closed({ id: 'a', impactDeferredBy: 'r2' });
    const t = team({
      globalActions: [a],
      // Day-first strings whose day and month are both <= 12: Date.parse reads
      // them month-first and would call r1 the newer retro.
      retrospectives: [
        retro('r3', '07/01/2026'),
        retro('r2', '06/01/2026', [a]),
        retro('r1', '05/01/2026', [a])
      ]
    });

    // r2 is the most recent asker by record order, and it deferred: present it.
    expect(selectClosedActionsForRating(t, session('r3')).map((i) => i.id)).toEqual(['a']);
  });
});

// Regression, PR #460 second round. `impactRatingProgress` was written when
// "Rate later" *removed* the row, so `closedActionsSnapshot` and "the actions
// the round asks about" were the same list. Commit 8e09f25 made the deferral a
// toggle and kept the row in the snapshot, marked — and this function was never
// updated, so a round of 9 with 2 postponed reported 7/9 forever and the green
// tick was unreachable.
//
// The function had no unit tests at all before this block, which is why the
// change landed green.
describe('impactRatingProgress', () => {
  const round = (
    listed: ActionItem[],
    votes: Record<string, Record<string, ActionImpactVote>> = {}
  ) =>
    ({
      id: 'retro-now',
      closedActionsSnapshot: listed,
      actionImpactVotes: votes
    }) as unknown as RetroSession;

  const rateable = (id: string) => action({ id });
  const postponed = (id: string) => action({ id, impactDeferredBy: 'retro-now' });

  it('counts every listed action when none is postponed', () => {
    const session = round([rateable('a1'), rateable('a2')], { a1: { u1: 3 } });

    expect(impactRatingProgress(session, 'u1')).toEqual({
      rated: 1,
      total: 2,
      complete: false
    });
  });

  it('is complete once every action has an answer, abstentions included', () => {
    const session = round([rateable('a1'), rateable('a2')], {
      a1: { u1: 3 },
      a2: { u1: 'abstain' }
    });

    expect(impactRatingProgress(session, 'u1').complete).toBe(true);
  });

  // The reported symptom: 9 actions, 2 postponed, a participant who answered
  // the other 7 is done — 7/7 with the tick, not 7/9 without it.
  it('drops postponed actions out of the denominator', () => {
    const listed = [
      ...['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'].map(rateable),
      postponed('a8'),
      postponed('a9')
    ];
    const votes = Object.fromEntries(
      ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'].map((id) => [id, { u1: 3 as ActionImpactVote }])
    );

    expect(impactRatingProgress(round(listed, votes), 'u1')).toEqual({
      rated: 7,
      total: 7,
      complete: true
    });
  });

  // The second half, and the one that made two people disagree: a participant
  // who answered before the facilitator postponed the action kept that answer
  // in the numerator, so they read 7/7 while someone who had not answered read
  // 5/7. Both must see the same round.
  it('drops a vote cast before the action was postponed', () => {
    const listed = [rateable('a1'), rateable('a2'), postponed('a3'), postponed('a4')];
    const early = round(listed, {
      a1: { u1: 3, u2: 3 },
      a2: { u1: 3, u2: 3 },
      // u1 answered these two before the facilitator pressed "Rate later".
      a3: { u1: 2 },
      a4: { u1: 2 }
    });

    const first = impactRatingProgress(early, 'u1');
    const second = impactRatingProgress(early, 'u2');

    expect(first).toEqual({ rated: 2, total: 2, complete: true });
    expect(second).toEqual(first);
  });

  // A deferral stamped by an earlier retrospective is history: that is exactly
  // the action this round exists to ask about again.
  it('only honours a deferral stamped by this retrospective', () => {
    const listed = [rateable('a1'), action({ id: 'a2', impactDeferredBy: 'retro-previous' })];

    expect(impactRatingProgress(round(listed, {}), 'u1').total).toBe(2);
  });

  it('is never complete when the whole round is postponed', () => {
    const listed = [postponed('a1'), postponed('a2')];

    expect(impactRatingProgress(round(listed, {}), 'u1')).toEqual({
      rated: 0,
      total: 0,
      complete: false
    });
  });
});
