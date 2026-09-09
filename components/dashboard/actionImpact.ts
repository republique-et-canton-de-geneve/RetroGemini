import { ActionItem, Team } from '../../types';
import { actionImpactScore } from '../../utils/actionImpact.js';
import { parseDate } from './actionSorting';

/**
 * Rolling the team's impact votes up to the retrospective that produced the
 * action — the one line that answers "do our retro actions actually help?".
 *
 * ## The score belongs to the retro that *created* the action
 *
 * Not to the one that collected the votes. The rating round is deliberately one
 * retro behind (an action closed thirty seconds ago has produced nothing
 * observable), so a retro's line only fills in later. That lag is the price of
 * the number meaning anything.
 *
 * ## Actions created outside a retro still belong to a sprint
 *
 * An action added from the dashboard mid-sprint, or falling out of a health
 * check, is attributed to the first retrospective that follows its creation —
 * the retro that closes the sprint it was created in. It is flagged, because a
 * reader who goes looking for it among that retro's discussed topics will not
 * find it.
 *
 * Attribution is computed here on every read rather than stamped on the action:
 * no field, no migration, and it stays correct when a retrospective is renamed,
 * re-dated or deleted.
 */

export interface AttributedAction {
  action: ActionItem;
  /** True when the action was not created during the retro it is attributed to. */
  createdOutsideRetro: boolean;
}

export interface RetroImpactSummary {
  /** Every action attributed to the retro, rated or not. */
  actionCount: number;
  /** How many of them carry at least one numeric vote. */
  ratedCount: number;
  /** How many were created outside the retro (dashboard, health check). */
  outsideRetroCount: number;
  /** Mean of the per-action scores, to one decimal. */
  average: number;
}

/** Actions that live outside any retrospective: dashboard-created and health-check. */
const outOfRetroActions = (team: Team): ActionItem[] => [
  ...(team.globalActions ?? []),
  ...(team.healthChecks ?? []).flatMap((hc) => hc.actions ?? [])
];

/**
 * The id of the first retrospective held at or after `createdAt`, or null when
 * none is — an action created after the most recent retro has no home yet and
 * gets one as soon as the next retro exists.
 */
const retroFollowing = (team: Team, createdAt: string | undefined): string | null => {
  const created = createdAt ? parseDate(createdAt) : null;
  if (created == null) return null;

  let best: { id: string; at: number } | null = null;
  for (const retro of team.retrospectives ?? []) {
    const at = parseDate(retro.date ?? '');
    if (at == null || at < created) continue;
    if (!best || at < best.at) best = { id: retro.id, at };
  }
  return best?.id ?? null;
};

/**
 * Every action this retrospective is answerable for: the ones created in it,
 * plus the out-of-retro ones created during the sprint it closes.
 */
export const actionsAttributedToRetro = (team: Team, retroId: string): AttributedAction[] => {
  const retro = (team.retrospectives ?? []).find((entry) => entry.id === retroId);
  if (!retro) return [];

  const own: AttributedAction[] = (retro.actions ?? [])
    .filter((action) => action.type !== 'proposal')
    .map((action) => ({ action, createdOutsideRetro: false }));

  const adopted: AttributedAction[] = outOfRetroActions(team)
    .filter((action) => action.type !== 'proposal')
    .filter((action) => retroFollowing(team, action.createdAt) === retroId)
    .map((action) => ({ action, createdOutsideRetro: true }));

  return [...own, ...adopted];
};

/**
 * The retro's impact line, or `null` when nothing attributed to it has been
 * rated yet.
 *
 * `null` rather than a zero on purpose: an unrated retro must render *nothing*.
 * "0/3" reads as a damning verdict when the truth is that no one has answered.
 *
 * The average is over *actions*, each counted once, not over individual votes.
 * A retro with one action everybody rated and one action a single person rated
 * should not have the first drown out the second — the question is "how did
 * this retro's actions do", not "what did the most-voted action score".
 */
export const retroImpactSummary = (team: Team, retroId: string): RetroImpactSummary | null => {
  const attributed = actionsAttributedToRetro(team, retroId);
  if (attributed.length === 0) return null;

  const scores = attributed
    .map((entry) => actionImpactScore(entry.action))
    .filter((score): score is number => score != null);
  if (scores.length === 0) return null;

  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;

  return {
    actionCount: attributed.length,
    ratedCount: scores.length,
    outsideRetroCount: attributed.filter((entry) => entry.createdOutsideRetro).length,
    average: Math.round(mean * 10) / 10
  };
};
