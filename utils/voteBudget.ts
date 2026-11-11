import type { Group, RetroSession, RetroSettings, Ticket } from '../types';

/**
 * How many votes one person may cast, in the Vote phase and on an open board:
 * the facilitator's number, or no limit at all. A board kept for weeks has its
 * votes cast once and never handed back, so a fixed number runs out after the
 * first meeting; a board is created with unlimited votes for that reason.
 */
export const voteBudget = (settings: Pick<RetroSettings, 'maxVotes' | 'unlimitedVotes'>): number =>
  settings.unlimitedVotes ? Number.POSITIVE_INFINITY : settings.maxVotes;

/**
 * How many votes each voter has cast, cards and groups together, a grouped card's
 * own votes included and stacked votes one by one: what mayAddVote, capVotes and
 * the Vote phase's per-person counts all count. Every voter found in the votes is
 * counted, on a roster or not.
 */
export const votesCastByVoter = (session: Pick<RetroSession, 'tickets' | 'groups'>): Map<string, number> => {
  const cast = new Map<string, number>();
  [...session.tickets, ...session.groups].forEach((item) =>
    item.votes.forEach((voter) => cast.set(voter, (cast.get(voter) ?? 0) + 1)));
  return cast;
};

/**
 * What is left of the stored number for someone who has cast `cast`: the number
 * less what they cast, never below 0 (the number can be lowered under it), and
 * `null` when there is nothing to count down from (unlimited votes, or no
 * number); a number still being typed is not stored. With several votes per item
 * these are the votes they may still cast. With one vote per item some of them
 * may find no item left to take them: what a person can still place is
 * `votesLeftToPlace`.
 */
export const votesLeftFor = (
  settings: Pick<RetroSettings, 'maxVotes' | 'unlimitedVotes'>,
  cast: number,
): number | null => {
  const budget = voteBudget(settings);
  return Number.isFinite(budget) ? Math.max(0, budget - cast) : null;
};

/**
 * The items the guided Vote phase offers a vote on, in no particular order: each
 * group of a column, and each card of a column that is in no group (a grouped
 * card is voted on through its group). It must stay what
 * `utils/retroColumnOrder.ts` → `getColumnEntries` lists over `session.columns`,
 * which is what Session.tsx draws with a vote control:
 * `__tests__/voteBudget.test.ts` → *votableItems* compares the two.
 */
export const votableItems = (
  session: Pick<RetroSession, 'columns' | 'tickets' | 'groups'>,
): Array<Ticket | Group> => {
  const columnIds = new Set(session.columns.map((column) => column.id));
  return [
    ...session.groups.filter((group) => columnIds.has(group.colId)),
    ...session.tickets.filter((ticket) => !ticket.groupId && columnIds.has(ticket.colId)),
  ];
};

/**
 * The votes `voterId`, who has cast `cast`, can still place in the guided Vote
 * phase: what is left of the number (`votesLeftFor`) and, with one vote per item,
 * never more than the items that do not hold their vote yet. `null` when there is
 * nothing to count down from. It is the one number the Vote phase shows and acts
 * on: each row of the participants panel, the person's own "N votes remaining",
 * and the automatic finish at 0 (review of 43.0: a person who had voted on every
 * item read "N votes left", every vote control was off, and nobody was finished).
 * `items` defaults to `votableItems(session)`; a caller counting every voter
 * reads them once.
 */
export const votesLeftToPlace = (
  session: Pick<RetroSession, 'columns' | 'tickets' | 'groups'> & {
    settings: Pick<RetroSettings, 'maxVotes' | 'unlimitedVotes' | 'oneVotePerTicket'>;
  },
  voterId: string,
  cast: number,
  items: ReadonlyArray<{ votes: string[] }> = votableItems(session),
): number | null => {
  const left = votesLeftFor(session.settings, cast);
  if (left === null || !session.settings.oneVotePerTicket) return left;
  return Math.min(left, items.filter((item) => !item.votes.includes(voterId)).length);
};

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
  const cast = votesCastByVoter(session).get(userId) ?? 0;
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
  const cast = votesCastByVoter(session);
  const items = [...session.tickets, ...session.groups];

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
