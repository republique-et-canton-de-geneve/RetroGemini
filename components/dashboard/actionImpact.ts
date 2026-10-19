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
/**
 * Midnight of the day a timestamp falls on, so two values recorded at different
 * precisions can be compared at all.
 *
 * `createdAt` is a full ISO instant; `RetroSession.date` is a formatted *day*,
 * which parses to midnight. Comparing them raw meant an action created at 09:00
 * on the morning of the retro looked *later* than the retro itself and was
 * pushed to the next sprint — or to none, when there was no next retro. A whole
 * day is the finest resolution both sides actually carry.
 */
const startOfDay = (timestamp: number): number => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

interface RetroDay {
  id: string;
  at: number;
}

/**
 * Each retrospective's day, parsed once. Retro dates are formatted strings, and
 * parsing them was the cost of the Retros tab: once per retro, per action, per
 * retro shown.
 */
const retroDays = (team: Team): RetroDay[] => {
  const days: RetroDay[] = [];
  for (const retro of team.retrospectives ?? []) {
    const parsedRetro = parseDate(retro.date ?? '');
    if (parsedRetro == null) continue;
    days.push({ id: retro.id, at: startOfDay(parsedRetro) });
  }
  return days;
};

const retroFollowing = (days: RetroDay[], createdAt: string | undefined): string | null => {
  const parsed = createdAt ? parseDate(createdAt) : null;
  if (parsed == null) return null;
  const created = startOfDay(parsed);

  let best: RetroDay | null = null;
  for (const day of days) {
    if (day.at < created) continue;
    if (!best || day.at < best.at) best = day;
  }
  return best?.id ?? null;
};

/** The out-of-retro actions each retrospective adopts, keyed by retro id. */
const adoptedActionsByRetro = (team: Team): Map<string, ActionItem[]> => {
  const days = retroDays(team);
  const adopted = new Map<string, ActionItem[]>();
  for (const action of outOfRetroActions(team)) {
    if (action.type === 'proposal') continue;
    const retroId = retroFollowing(days, action.createdAt);
    if (retroId == null) continue;
    const list = adopted.get(retroId);
    if (list) list.push(action);
    else adopted.set(retroId, [action]);
  }
  return adopted;
};

const attributedActions = (
  ownActions: ActionItem[] | undefined,
  adopted: ActionItem[] | undefined
): AttributedAction[] => [
  ...(ownActions ?? [])
    .filter((action) => action.type !== 'proposal')
    .map((action) => ({ action, createdOutsideRetro: false })),
  ...(adopted ?? []).map((action) => ({ action, createdOutsideRetro: true }))
];

/**
 * Every action this retrospective is answerable for: the ones created in it,
 * plus the out-of-retro ones created during the sprint it closes.
 */
export const actionsAttributedToRetro = (team: Team, retroId: string): AttributedAction[] => {
  const retro = (team.retrospectives ?? []).find((entry) => entry.id === retroId);
  if (!retro) return [];
  return attributedActions(retro.actions, adoptedActionsByRetro(team).get(retroId));
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
const summarize = (attributed: AttributedAction[]): RetroImpactSummary | null => {
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

export const retroImpactSummary = (team: Team, retroId: string): RetroImpactSummary | null =>
  summarize(actionsAttributedToRetro(team, retroId));

/**
 * Every retrospective's impact line, from one pass over the team: what the
 * Retros tab shows. The same answers as `retroImpactSummary` retro by retro,
 * at O(G x R) for the whole list instead of O(R x G x R).
 */
export const retroImpactSummaries = (team: Team): Map<string, RetroImpactSummary | null> => {
  const adopted = adoptedActionsByRetro(team);
  const summaries = new Map<string, RetroImpactSummary | null>();
  for (const retro of team.retrospectives ?? []) {
    if (summaries.has(retro.id)) continue;
    summaries.set(retro.id, summarize(attributedActions(retro.actions, adopted.get(retro.id))));
  }
  return summaries;
};
