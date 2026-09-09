import { RetroSession } from '../../types';

/**
 * The team's ROTI for one retrospective, for the dashboard card.
 *
 * ## Why this sits beside the action-impact rollup and not inside it
 *
 * The two numbers answer different questions on different scales, and that is
 * deliberate: ROTI is 1-5 and asks *how was this session*, the action impact is
 * 1-3 and asks *did the actions this session produced actually help*. A retro
 * can score 5 for a great conversation and 1 for actions that changed nothing;
 * that gap is the interesting signal, and it only survives if the two are never
 * averaged together or shown as one anonymous star row.
 *
 * The card therefore labels both, and each carries its own scale.
 */

export interface RetroRotiSummary {
  /** Mean of the scores given, to one decimal. */
  average: number;
  /** How many people answered. */
  count: number;
}

/**
 * `null` when nobody answered — the same rule the action rollup follows, and
 * for the same reason: a ROTI of "0/5" on a card reads as a damning verdict
 * when the truth is that the session ended before anyone was asked.
 */
export const retroRotiSummary = (
  retro: Pick<RetroSession, 'roti'> | null | undefined
): RetroRotiSummary | null => {
  const scores = Object.values(retro?.roti ?? {}).filter(
    (score): score is number => typeof score === 'number' && Number.isFinite(score)
  );
  if (scores.length === 0) return null;

  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return { average: Math.round(mean * 10) / 10, count: scores.length };
};

/** ROTI is scored out of five, unlike the action impact's three. */
export const ROTI_MAX = 5;
