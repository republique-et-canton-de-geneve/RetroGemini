import type { RetroSession, RetroSettings } from '../types';

/**
 * How many votes one person may cast, in the Vote phase and on an open board:
 * the facilitator's number, or no limit at all. A board kept for weeks has its
 * votes cast once and never handed back, so a fixed number runs out after the
 * first meeting; a board is created with unlimited votes for that reason.
 */
export const voteBudget = (settings: Pick<RetroSettings, 'maxVotes' | 'unlimitedVotes'>): number =>
  settings.unlimitedVotes ? Number.POSITIVE_INFINITY : settings.maxVotes;

/**
 * Whether one more vote of `userId` may go on `item`: the voter has votes left
 * (cards and groups counted together) and, with one vote per item, has not
 * voted on it yet. Read on the state a write is built on, not only on the
 * screen that offered the button: a number typed in the votes field and left
 * for a vote button joins that button's own write (Session.tsx →
 * updateSession), and the button had been enabled under the old number, so
 * the vote went in past the new one.
 */
export const mayAddVote = (
  session: Pick<RetroSession, 'tickets' | 'groups'> & {
    settings: Pick<RetroSettings, 'maxVotes' | 'unlimitedVotes' | 'oneVotePerTicket'>;
  },
  item: { votes: string[] },
  userId: string,
): boolean => {
  const cast = [...session.tickets, ...session.groups]
    .reduce((sum, entry) => sum + entry.votes.filter((voter) => voter === userId).length, 0);
  if (cast >= voteBudget(session.settings)) return false;
  return !session.settings.oneVotePerTicket || !item.votes.includes(userId);
};

/**
 * Takes every voter back down to `max` votes: what lowering the number does,
 * and turning unlimited votes off. A voter's votes go from the cards first,
 * then from the groups, in the session's order — the rule the Vote phase has
 * always applied. Every voter found in the votes is capped, not only the
 * people on the roster: a vote whose author has left still counts in a total.
 *
 * Mutates the session, like the other session helpers, and answers whether it
 * took any vote back.
 */
export const capVotes = (session: Pick<RetroSession, 'tickets' | 'groups'>, max: number): boolean => {
  const cast = new Map<string, number>();
  const items = [...session.tickets, ...session.groups];
  items.forEach((item) => item.votes.forEach((voter) => cast.set(voter, (cast.get(voter) ?? 0) + 1)));

  let removed = false;
  cast.forEach((total, voter) => {
    let excess = total - max;
    for (const item of items) {
      if (excess <= 0) break;
      let index = item.votes.indexOf(voter);
      while (excess > 0 && index !== -1) {
        item.votes.splice(index, 1);
        excess--;
        removed = true;
        index = item.votes.indexOf(voter);
      }
    }
  });
  return removed;
};

/**
 * Takes every voter down to one vote per card and per group: what turning
 * "one vote per item" on does. Mutates the session, like `capVotes`, and
 * answers whether it took any vote back.
 */
export const keepOneVotePerItem = (session: Pick<RetroSession, 'tickets' | 'groups'>): boolean => {
  let removed = false;
  [...session.tickets, ...session.groups].forEach((item) => {
    const kept = [...new Set(item.votes)];
    if (kept.length === item.votes.length) return;
    item.votes = kept;
    removed = true;
  });
  return removed;
};
