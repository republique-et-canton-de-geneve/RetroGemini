import React, { useState } from 'react';
import { DiscussVoteSummary, TopicVoteInsight } from './discussVoteSummary';

interface Props {
  summary: DiscussVoteSummary;
  /** Scroll the matching topic card into view */
  onFocusTopic?: (topicId: string) => void;
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

const backersLabel = (topic: TopicVoteInsight): string =>
  topic.otherBackers === 0 ? 'nobody else backed it' : `${plural(topic.otherBackers, 'other')} backed it`;

/**
 * Personal recap of the votes the current user cast, shown at the top of the
 * Discuss list.
 *
 * By Discuss the vote budget is spent and invisible: the board shows only
 * totals, so nobody remembers which topics they backed — let alone which of
 * them the rest of the team ignored. Each row pairs the user's own weight with
 * the topic's total support (drawn to scale against the best-scoring topic) and
 * its rank in the list the facilitator works down, so "I pushed this and it is
 * dead last" reads at a glance. Rows jump to their card.
 *
 * Everything is derived client-side from state already on the session, so the
 * panel adds nothing to sync and survives a reconnect for free.
 */
const MyVotesRecap: React.FC<Props> = ({ summary, onFocusTopic }) => {
  const [expanded, setExpanded] = useState(true);

  if (summary.topicCount === 0) return null;

  const eyebrow = (
    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-500">Your votes</div>
  );

  if (summary.votedTopicCount === 0) {
    return (
      <section
        data-testid="my-votes-recap"
        aria-label="Recap of your votes"
        className="rounded-2xl border border-slate-200 bg-white shadow-xs"
      >
        <div data-testid="my-votes-recap-empty" className="flex items-start gap-3 px-3 py-3 sm:px-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
            <span className="material-symbols-outlined text-lg" aria-hidden="true">how_to_vote</span>
          </span>
          <div className="min-w-0">
            {eyebrow}
            <p className="mt-1 text-sm text-slate-500">
              You did not put any vote on these topics, so none of the cards below is marked as yours.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      data-testid="my-votes-recap"
      aria-label="Recap of your votes"
      className="overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-xs"
    >
      <button
        type="button"
        data-testid="my-votes-recap-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-center gap-3 bg-linear-to-r from-indigo-50 via-white to-white px-3 py-3 text-left transition hover:from-indigo-100 sm:px-4"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs">
          <span className="material-symbols-outlined text-lg" aria-hidden="true">how_to_vote</span>
        </span>
        <span className="min-w-0 grow">
          {eyebrow}
          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm text-slate-600">
            <span className="font-bold text-slate-800">{plural(summary.myTotalVotes, 'vote')}</span>
            <span>spread over</span>
            <span className="font-bold text-slate-800">{plural(summary.votedTopicCount, 'topic')}</span>
          </span>
          {summary.onlyMineCount > 0 && (
            <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-700">
              <span className="material-symbols-outlined text-sm" aria-hidden="true">person_alert</span>
              <span>{plural(summary.onlyMineCount, 'topic')} nobody else backed</span>
            </span>
          )}
        </span>
        <span className="material-symbols-outlined shrink-0 text-slate-400" aria-hidden="true">
          {expanded ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {expanded && (
        <ol className="divide-y divide-slate-100 border-t border-slate-100">
          {summary.votedTopics.map((topic) => {
            // Bar drawn to scale against the best-scoring topic, so a short bar
            // *is* "few votes"; the darker head is the share the user owns.
            const supportWidth = summary.topVotes > 0 ? (topic.totalVotes / summary.topVotes) * 100 : 0;
            const myShareWidth =
              topic.totalVotes > 0 ? (Math.min(topic.myVotes, topic.totalVotes) / topic.totalVotes) * 100 : 0;

            return (
              <li key={topic.id}>
                <button
                  type="button"
                  data-testid="my-votes-recap-row"
                  onClick={() => onFocusTopic?.(topic.id)}
                  aria-label={`${topic.text} — ranked ${topic.rank} of ${topic.topicCount}, your ${plural(topic.myVotes, 'vote')} of ${plural(topic.totalVotes, 'vote')}, ${backersLabel(topic)}. Jump to this topic.`}
                  className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-indigo-50/70 sm:gap-3 sm:px-4"
                >
                  <span
                    className={`mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-lg px-1.5 text-[11px] font-bold ${
                      topic.onlyMine ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'
                    }`}
                    aria-hidden="true"
                  >
                    #{topic.rank}
                  </span>

                  <span className="min-w-0 grow">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="line-clamp-2 min-w-0 text-sm font-medium text-slate-700">{topic.text}</span>
                      {topic.onlyMine && (
                        <span
                          data-testid="my-votes-recap-only-mine"
                          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700"
                        >
                          <span className="material-symbols-outlined text-[13px] leading-none" aria-hidden="true">person_alert</span>
                          Only you
                        </span>
                      )}
                    </span>

                    <span
                      className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
                      aria-hidden="true"
                    >
                      <span
                        className={`block h-full rounded-full ${topic.onlyMine ? 'bg-amber-200' : 'bg-indigo-200'}`}
                        style={{ width: `${supportWidth}%` }}
                      >
                        <span
                          className={`block h-full rounded-full ${topic.onlyMine ? 'bg-amber-500' : 'bg-indigo-500'}`}
                          style={{ width: `${myShareWidth}%` }}
                        />
                      </span>
                    </span>

                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                      <span className="font-bold text-indigo-600">your {plural(topic.myVotes, 'vote')}</span>
                      {/* The separator leads its item so a line wrapped on a
                          narrow screen never ends on a dangling dot. */}
                      <span className="whitespace-nowrap"><span aria-hidden="true">· </span>{plural(topic.totalVotes, 'vote')} in total</span>
                      <span className="whitespace-nowrap"><span aria-hidden="true">· </span>{backersLabel(topic)}</span>
                    </span>
                  </span>

                  <span className="material-symbols-outlined mt-0.5 shrink-0 text-base text-slate-300" aria-hidden="true">
                    chevron_right
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};

export default MyVotesRecap;
