import { ActionItem, RetroSession, Team, User } from '../../types';
import { getActionClosureTimestamp } from '../dashboard/actionSorting';

/**
 * Which closed actions this retrospective puts to the team for an impact
 * rating — block (b) of the Open Actions phase.
 *
 * ## Why the "already asked" marker is not a field on the action
 *
 * Every design that stamps the action ("presented", "rated at") needs that
 * stamp written at some moment, and every such moment can be missed: the
 * facilitator can click through the phase in two seconds, and `SessionHeader`
 * lets them jump back into it afterwards. A stamp written on entry would mark
 * actions nobody saw; a stamp written on exit would be lost by a facilitator
 * who never formally leaves.
 *
 * So nothing is stamped. "Has this action already been put to the team?" is
 * answered by data the product already persists: membership in some previous
 * retro's `closedActionsSnapshot`, which is saved as part of that retro. There
 * is no moment to miss, and re-entering the phase mid-session rebuilds exactly
 * the same list with every vote already cast still in place.
 *
 * The one field this does need is `impactDeferredBy`, because "ask me again
 * next time" is a decision, not something that can be derived.
 */

/**
 * True unless the team explicitly turned the rating off.
 *
 * Absent reads as enabled so the feature ships on for everyone without touching
 * a single stored record, and a team that does not want it flips the switch
 * once in Team Settings.
 */
export const isActionImpactRatingEnabled = (team: Team | null | undefined): boolean =>
  team?.actionImpactRatingEnabled !== false;

/**
 * Every action the team holds, wherever it lives — except the ones this very
 * retrospective created.
 *
 * A facilitator can create an action in Discuss, close it in Review and then
 * jump back to Open Actions through the phase header. Such an action was never
 * in the entry snapshot, so the structural lag check below would not catch it,
 * and it would be put to the team minutes after being written. "Rate now" stays
 * the deliberate override for the rare case where that is what you want.
 */
const rateableTeamActions = (team: Team, currentRetroId: string): ActionItem[] => [
  ...(team.globalActions ?? []),
  ...(team.retrospectives ?? [])
    .filter((retro) => retro.id !== currentRetroId)
    .flatMap((retro) => retro.actions ?? []),
  ...(team.healthChecks ?? []).flatMap((hc) => hc.actions ?? [])
];

/**
 * Retrospectives newest first — taken from array order, deliberately not from
 * their dates.
 *
 * `RetroSession.date` is whatever `toLocaleDateString()` produced on the
 * facilitator's machine, so in a day-first locale "01/06/2026" is the 1st of
 * June while `Date.parse` reads it as the 6th of January. Both readings are
 * plausible for every day of the month up to the 12th, so ordering on that
 * string would silently mis-identify which retro last asked about an action and
 * make a deferral repeat or vanish.
 *
 * The team record already holds retrospectives newest-first (`dataService`
 * unshifts new ones, and the server's persist handler does the same), which is
 * an exact signal where the date string is a guess.
 */
const retrosNewestFirst = (team: Team): RetroSession[] => team.retrospectives ?? [];

/**
 * The id of the most recent retrospective — other than `currentRetroId` — that
 * put `actionId` to the team, or `null` when none ever did.
 */
const lastRetroThatAsked = (
  team: Team,
  actionId: string,
  currentRetroId: string
): string | null => {
  for (const retro of retrosNewestFirst(team)) {
    if (retro.id === currentRetroId) continue;
    if ((retro.closedActionsSnapshot ?? []).some((entry) => entry.id === actionId)) {
      return retro.id;
    }
  }
  return null;
};

/**
 * Build block (b) for `session`, most recently closed first.
 *
 * An action is included when every one of these holds:
 *
 * 1. the team has the rating enabled;
 * 2. it is a real action (`type !== 'proposal'`) and it is closed;
 * 3. it carries a `closedAt` — actions closed before this feature shipped have
 *    none and never will, which is exactly what keeps the historical backlog
 *    out of the first round after deployment;
 * 4. it was already closed when *this* session reached the Open Actions phase.
 *    An action the facilitator is ticking off right now was in
 *    `openActionsSnapshot`, has produced nothing observable yet, and belongs to
 *    the next retro's round — this is the one-retro lag, enforced structurally
 *    rather than by asking the facilitator to defer it every time. "Rate now"
 *    is the deliberate override, and it works by adding the action straight to
 *    `closedActionsSnapshot`;
 * 5. no earlier retro has asked about it, **or** the facilitator of the retro
 *    that last asked pressed "Rate later". That second clause is self-limiting:
 *    a deferral carries an action into exactly the next retro, because at the
 *    one after, `impactDeferredBy` no longer names the most recent asker.
 *
 * An action deferred during this very round drops out immediately.
 */
export const selectClosedActionsForRating = (
  team: Team,
  session: Pick<RetroSession, 'id' | 'openActionsSnapshot'>
): ActionItem[] => {
  if (!isActionImpactRatingEnabled(team)) return [];

  const openAtPhaseEntry = new Set(
    (session.openActionsSnapshot ?? []).map((entry) => entry.id)
  );

  const selected = new Map<string, ActionItem>();
  for (const action of rateableTeamActions(team, session.id)) {
    if (selected.has(action.id)) continue;
    if (action.type === 'proposal') continue;
    if (!action.done || !action.closedAt) continue;
    if (openAtPhaseEntry.has(action.id)) continue;
    if (action.impactDeferredBy === session.id) continue;

    const askedBy = lastRetroThatAsked(team, action.id, session.id);
    if (askedBy && action.impactDeferredBy !== askedBy) continue;

    selected.set(action.id, action);
  }

  return [...selected.values()].sort(
    (a, b) => getActionClosureTimestamp(b) - getActionClosureTimestamp(a)
  );
};

/**
 * The participants whose answers the round is waiting for.
 *
 * Facilitators are excluded, and not as a rule about permissions: teams connect
 * the facilitator as a separate driving identity *on top of* every real person,
 * so a six-person team shows seven connected users. The human behind the
 * facilitator seat is already in the list under their participant identity and
 * votes there — counting the seat too would collect a second vote from the same
 * person and make the denominator lie.
 *
 * Participants the facilitator marked as having left drop out, as they do from
 * every other counter in the session.
 */
export const impactRaters = (participants: User[], leftUsers: string[] | undefined): User[] => {
  const left = new Set(leftUsers ?? []);
  return participants.filter((p) => p.role !== 'facilitator' && !left.has(p.id));
};

export interface ImpactRatingProgress {
  /** How many of the round's actions this participant has answered. */
  rated: number;
  /** How many actions the round is asking about. */
  total: number;
  /** True once they have answered every one — an abstention counts. */
  complete: boolean;
}

/**
 * How far one participant is through the round.
 *
 * An abstention counts as answered: "not concerned" is a reply, and treating it
 * as silence would leave someone permanently marked as owing an answer they
 * have already given.
 */
export const impactRatingProgress = (
  session: Pick<RetroSession, 'closedActionsSnapshot' | 'actionImpactVotes'>,
  userId: string
): ImpactRatingProgress => {
  const actions = session.closedActionsSnapshot ?? [];
  const votes = session.actionImpactVotes ?? {};
  const rated = actions.filter((action) => votes[action.id]?.[userId] !== undefined).length;
  return { rated, total: actions.length, complete: actions.length > 0 && rated === actions.length };
};
