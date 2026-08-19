/**
 * Personal vote recap for the Discuss phase.
 *
 * During Vote every participant spreads a fixed budget of votes over the
 * topics; by the time the team reaches Discuss that budget is invisible —
 * the board only shows aggregate totals. This helper rebuilds, client-side
 * and for the current user alone, *where their own votes went*: how many
 * they put on each topic, how much support the topic got from everyone
 * else, and where it ranks in the list the facilitator works down.
 *
 * It derives everything from the state the Discuss list already carries, so
 * it adds no session field, no server round-trip and nothing to sync after a
 * reconnect (see the zero-downtime rules in AGENTS.md).
 *
 * Votes cast by participants the facilitator later marked as having left are
 * deliberately *not* filtered out, unlike the "move on" counters next to them:
 * those count people still expected to act, while these totals must match the
 * vote count printed on the same card. A recap saying "4 votes in total" beside
 * a card saying "3 votes" would read as a bug in whichever number the user
 * trusts less.
 */

/**
 * One row of the Discuss list: an ungrouped ticket, or a group of tickets.
 * Structurally compatible with the `DiscussItem` the Session builds.
 */
export interface DiscussVoteItemLike {
  id: string;
  text: string;
  /** Total votes displayed on the card (`ref.votes.length` at build time) */
  votes: number;
  /** Distinct participants who backed the topic, when the caller computed it */
  uniqueVotes?: number;
  type: 'group' | 'ticket';
  /** The ticket or group the row stands for; `votes` is a list of user ids, repeated for multi-votes */
  ref: { votes?: string[] };
}

export interface TopicVoteInsight {
  id: string;
  text: string;
  type: 'group' | 'ticket';
  /** Votes the current user placed on this topic */
  myVotes: number;
  /** Total votes the topic received, as displayed on its card */
  totalVotes: number;
  /** Votes placed by everyone except the current user */
  otherVotes: number;
  /** Distinct participants other than the current user who backed the topic */
  otherBackers: number;
  /** 1-based competition rank by total votes: ties share the better rank */
  rank: number;
  /** How many topics the Discuss list holds, so a rank can be read as "3 of 9" */
  topicCount: number;
  /** The current user voted for it and nobody else did */
  onlyMine: boolean;
}

export interface DiscussVoteSummary {
  /** Topics the current user voted for, strongest first */
  votedTopics: TopicVoteInsight[];
  /** Insight for every topic in the list, keyed by topic id */
  byTopicId: Record<string, TopicVoteInsight>;
  /** Votes the current user placed across all topics */
  myTotalVotes: number;
  /** Number of topics the current user voted for */
  votedTopicCount: number;
  /** Voted topics nobody else backed */
  onlyMineCount: number;
  /** Topics in the Discuss list */
  topicCount: number;
  /** Best score in the list, so support bars can be drawn to scale */
  topVotes: number;
}

const countVotesBy = (votes: string[] | undefined, userId: string): number =>
  (votes ?? []).filter((voterId) => voterId === userId).length;

export const buildDiscussVoteSummary = (
  items: DiscussVoteItemLike[],
  currentUserId: string
): DiscussVoteSummary => {
  const topicCount = items.length;
  const topVotes = items.reduce((best, item) => Math.max(best, item.votes), 0);

  // Competition ranking (ties share the better rank), precomputed from the
  // distinct scores. Counting better-scoring topics per item would be
  // quadratic, and this runs on every Discuss render — including the one the
  // timer drives every second.
  const rankByVotes = new Map<number, number>();
  [...items]
    .sort((a, b) => b.votes - a.votes)
    .forEach((item, index) => {
      if (!rankByVotes.has(item.votes)) rankByVotes.set(item.votes, index + 1);
    });

  const insights: TopicVoteInsight[] = items.map((item) => {
    const rawVotes = item.ref?.votes;
    const myVotes = countVotesBy(rawVotes, currentUserId);
    const totalVotes = item.votes;
    // Clamped: `totalVotes` is the count the card shows and `rawVotes` the raw
    // list, so a caller passing the two out of step must never yield negative
    // support (which would render as an inverted bar).
    const otherVotes = Math.max(0, totalVotes - myVotes);
    const distinctVoters = item.uniqueVotes ?? new Set(rawVotes ?? []).size;
    const otherBackers = Math.max(0, distinctVoters - (myVotes > 0 ? 1 : 0));

    return {
      id: item.id,
      text: item.text,
      type: item.type,
      myVotes,
      totalVotes,
      otherVotes,
      otherBackers,
      // Derived from the scores rather than from the incoming order: the
      // caller sorts the list, but the rank must stay right even if it stops.
      rank: rankByVotes.get(totalVotes) ?? 1,
      topicCount,
      onlyMine: myVotes > 0 && otherVotes === 0
    };
  });

  const votedTopics = insights
    .filter((topic) => topic.myVotes > 0)
    .sort((a, b) => a.rank - b.rank);

  return {
    votedTopics,
    byTopicId: Object.fromEntries(insights.map((topic) => [topic.id, topic])),
    myTotalVotes: insights.reduce((total, topic) => total + topic.myVotes, 0),
    votedTopicCount: votedTopics.length,
    onlyMineCount: votedTopics.filter((topic) => topic.onlyMine).length,
    topicCount,
    topVotes
  };
};
