import { describe, expect, it } from 'vitest';
import { ActionItem, RetroSession, Team } from '../types';
import {
  actionsAttributedToRetro,
  retroImpactSummary
} from '../components/dashboard/actionImpact';

const action = (overrides: Partial<ActionItem>): ActionItem => ({
  id: 'action',
  text: 'Do the thing',
  assigneeId: null,
  done: true,
  type: 'new',
  proposalVotes: {},
  ...overrides
});

const retro = (id: string, date: string, actions: ActionItem[] = []): RetroSession =>
  ({ id, name: id, date, actions } as unknown as RetroSession);

// Newest first, as the team record holds them.
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

describe('actionImpact rollup', () => {
  describe('actionsAttributedToRetro', () => {
    it('attributes the actions created in the retro itself', () => {
      const a = action({ id: 'a' });
      const t = team({ retrospectives: [retro('r1', '6/1/2026', [a])] });

      expect(actionsAttributedToRetro(t, 'r1').map((entry) => entry.action.id)).toEqual(['a']);
    });

    it('leaves proposals out — they are not actions yet', () => {
      const proposal = action({ id: 'p', type: 'proposal' });
      const t = team({ retrospectives: [retro('r1', '6/1/2026', [proposal])] });

      expect(actionsAttributedToRetro(t, 'r1')).toEqual([]);
    });

    // "The retro of the sprint during which it was created" — an action added
    // from the dashboard mid-sprint belongs to the retro that closes that
    // sprint, which is the next one after its creation date.
    it('attributes a dashboard action to the first retro that follows its creation', () => {
      const midSprint = action({ id: 'mid', createdAt: '2026-05-15T00:00:00.000Z' });
      const t = team({
        globalActions: [midSprint],
        retrospectives: [retro('r2', '6/1/2026'), retro('r1', '5/1/2026')]
      });

      expect(actionsAttributedToRetro(t, 'r2').map((entry) => entry.action.id)).toEqual(['mid']);
      expect(actionsAttributedToRetro(t, 'r1')).toEqual([]);
    });

    it('flags an action created outside a retro so it is not mistaken for a discussed topic', () => {
      const midSprint = action({ id: 'mid', createdAt: '2026-05-15T00:00:00.000Z' });
      const inRetro = action({ id: 'in', createdAt: '2026-06-01T00:00:00.000Z' });
      const t = team({
        globalActions: [midSprint],
        retrospectives: [retro('r2', '6/1/2026', [inRetro]), retro('r1', '5/1/2026')]
      });

      const attributed = actionsAttributedToRetro(t, 'r2');

      expect(attributed.find((e) => e.action.id === 'mid')?.createdOutsideRetro).toBe(true);
      expect(attributed.find((e) => e.action.id === 'in')?.createdOutsideRetro).toBe(false);
    });

    it('attributes health-check actions the same way', () => {
      const fromHc = action({ id: 'hc-action', createdAt: '2026-05-15T00:00:00.000Z' });
      const t = team({
        healthChecks: [{ id: 'hc1', name: 'HC', date: '5/10/2026', actions: [fromHc] } as never],
        retrospectives: [retro('r2', '6/1/2026'), retro('r1', '5/1/2026')]
      });

      const attributed = actionsAttributedToRetro(t, 'r2');
      expect(attributed.map((e) => e.action.id)).toEqual(['hc-action']);
      expect(attributed[0].createdOutsideRetro).toBe(true);
    });

    // Nothing to attribute it to yet. It lands once the next retro exists.
    it('attributes nothing for an action created after the most recent retro', () => {
      const later = action({ id: 'later', createdAt: '2026-07-01T00:00:00.000Z' });
      const t = team({ globalActions: [later], retrospectives: [retro('r1', '6/1/2026')] });

      expect(actionsAttributedToRetro(t, 'r1')).toEqual([]);
    });

    it('ignores an out-of-retro action with no creation date to place it by', () => {
      const undated = action({ id: 'undated' });
      const t = team({ globalActions: [undated], retrospectives: [retro('r1', '6/1/2026')] });

      expect(actionsAttributedToRetro(t, 'r1')).toEqual([]);
    });
  });

  describe('retroImpactSummary', () => {
    const rated = (id: string, ratings: Record<string, 1 | 2 | 3 | 'abstain'>) =>
      action({ id, impactRatings: ratings });

    it('averages across the actions of the retro, not across individual votes', () => {
      // One action rated by four people, one by a single person. Each action
      // counts once, so the busy one cannot drown out the other.
      const t = team({
        retrospectives: [
          retro('r1', '6/1/2026', [
            rated('a', { u1: 3, u2: 3, u3: 3, u4: 3 }),
            rated('b', { u1: 1 })
          ])
        ]
      });

      expect(retroImpactSummary(t, 'r1')).toEqual({
        actionCount: 2,
        ratedCount: 2,
        outsideRetroCount: 0,
        average: 2
      });
    });

    it('rounds the average to one decimal', () => {
      const t = team({
        retrospectives: [
          retro('r1', '6/1/2026', [rated('a', { u1: 3 }), rated('b', { u1: 3 }), rated('c', { u1: 1 })])
        ]
      });

      expect(retroImpactSummary(t, 'r1')?.average).toBe(2.3);
    });

    // Never render "0/3" for an unrated retro: it reads as a terrible score
    // when the truth is that nobody has answered yet.
    it('returns null when no attributed action carries a numeric rating', () => {
      const t = team({
        retrospectives: [retro('r1', '6/1/2026', [action({ id: 'a' }), rated('b', { u1: 'abstain' })])]
      });

      expect(retroImpactSummary(t, 'r1')).toBeNull();
    });

    it('counts every attributed action but averages only the rated ones', () => {
      const t = team({
        retrospectives: [
          retro('r1', '6/1/2026', [rated('a', { u1: 2 }), action({ id: 'b' }), action({ id: 'c' })])
        ]
      });

      expect(retroImpactSummary(t, 'r1')).toEqual({
        actionCount: 3,
        ratedCount: 1,
        outsideRetroCount: 0,
        average: 2
      });
    });

    it('reports how many of the attributed actions were created outside the retro', () => {
      const outside = rated('outside', { u1: 3 });
      outside.createdAt = '2026-05-15T00:00:00.000Z';
      const t = team({
        globalActions: [outside],
        retrospectives: [retro('r2', '6/1/2026', [rated('inside', { u1: 1 })]), retro('r1', '5/1/2026')]
      });

      expect(retroImpactSummary(t, 'r2')).toEqual({
        actionCount: 2,
        ratedCount: 2,
        outsideRetroCount: 1,
        average: 2
      });
    });

    it('returns null for a retro that does not exist', () => {
      expect(retroImpactSummary(team(), 'nope')).toBeNull();
    });
  });
});

// Codex review finding: `createdAt` is a full instant while `retro.date` is a
// formatted day that parses to midnight, so an action created in the morning of
// the retro looked *later* than the retro and was pushed to the next sprint —
// or to none at all, when there was no next one.
describe('actionsAttributedToRetro - same-day precision', () => {
  it('attributes an action created earlier on the retro’s own day to that retro', () => {
    const sameMorning = action({
      id: 'same-day',
      createdAt: '2026-06-01T09:00:00.000Z',
      impactRatings: { u1: 3 }
    });
    const t = team({
      globalActions: [sameMorning],
      retrospectives: [retro('r2', '6/1/2026'), retro('r1', '5/1/2026')]
    });

    expect(actionsAttributedToRetro(t, 'r2').map((e) => e.action.id)).toEqual(['same-day']);
    expect(retroImpactSummary(t, 'r2')?.actionCount).toBe(1);
  });

  it('still attributes nothing when the action is created after the last retro’s day', () => {
    const later = action({ id: 'later', createdAt: '2026-06-02T09:00:00.000Z' });
    const t = team({ globalActions: [later], retrospectives: [retro('r2', '6/1/2026')] });

    expect(actionsAttributedToRetro(t, 'r2')).toEqual([]);
  });
});
