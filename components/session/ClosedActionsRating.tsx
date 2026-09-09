import React, { useState } from 'react';
import { ActionImpactVote, ActionItem, RetroSession, User } from '../../types';
import { actionImpactScore } from '../../utils/actionImpact.js';
import StarRating, { Star } from '../common/StarRating';
import { impactRaters } from './closedActionsForRating';

/**
 * Block (b) of the Open Actions phase: the closed actions this retrospective
 * puts to the team, and the team's answer to one question about each.
 *
 * The question is deliberately about the *effect on the team*, never about how
 * well the action was carried out. Actions carry a named assignee, and a prompt
 * that could be read as judging that person would collect politeness instead of
 * information.
 *
 * Nothing here blocks: the facilitator can advance whenever they like, and a
 * round nobody answers simply produces no score.
 */

/** 1-3 rather than ROTI's 1-5, so the two numbers are never read against each other. */
const SCORES = [1, 2, 3] as const;

const SCORE_LABEL: Record<number, string> = {
  1: 'No real impact',
  2: 'Some impact',
  3: 'Clear impact'
};

/**
 * Shown while nothing is chosen and nothing is hovered.
 *
 * The scale has to be legible before the first click: a star bar with no
 * legend is a guess, and hover is not a thing that exists on the phones half
 * this product runs on.
 */
const SCALE_HINT = '1 = no real impact · 3 = clear impact';

interface RowProps {
  action: ActionItem;
  sessionId: string;
  currentUser: User;
  isFacilitator: boolean;
  revealed: boolean;
  actionVotes: Record<string, ActionImpactVote>;
  raterIds: Set<string>;
  raterCount: number;
  onRate: (actionId: string, vote: ActionImpactVote | null) => void;
  onToggleDefer: (actionId: string) => void;
}

const ClosedActionRow: React.FC<RowProps> = ({
  action,
  sessionId,
  currentUser,
  isFacilitator,
  revealed,
  actionVotes,
  raterIds,
  raterCount,
  onRate,
  onToggleDefer
}) => {
  // Which star the pointer or the keyboard is currently over. Null means "show
  // what was actually chosen".
  const [preview, setPreview] = useState<number | null>(null);

  const myVote = actionVotes[currentUser.id];
  const myScore = typeof myVote === 'number' ? myVote : 0;
  const shown = preview ?? myScore;
  const previewing = preview !== null && preview !== myScore;

  // The facilitator postponed this one to the next retrospective. The row stays
  // on screen rather than vanishing, because the click that removed it was
  // impossible to take back — see the toggle below.
  const deferred = action.impactDeferredBy === sessionId;

  // Counted over the same identities as the denominator. A participant who
  // voted and was then marked as having left still holds a key here, and
  // counting it produced "2 of 1 rated". Their vote stays in the score below —
  // they did answer — it just no longer inflates a progress count the room
  // reads as "who are we still waiting for".
  const cast = Object.keys(actionVotes).filter((id) => raterIds.has(id)).length;
  const score = actionImpactScore({ impactRatings: actionVotes });
  const countOf = (value: ActionImpactVote) =>
    Object.values(actionVotes).filter((vote) => vote === value).length;
  const abstained = countOf('abstain');

  const spread = SCORES.slice()
    .reverse()
    .map((value) => ({ value, count: countOf(value) }))
    .filter((entry) => entry.count > 0);

  // One sentence for a screen reader, so it hears the result rather than a run
  // of loose numbers pulled out of the chips.
  const resultLabel =
    score == null
      ? 'No rating yet'
      : [
          `Average impact ${Math.round(score * 10) / 10} out of 3.`,
          ...spread.map((entry) => `${entry.count} ${SCORE_LABEL[entry.value].toLowerCase()}`),
          ...(abstained > 0 ? [`${abstained} not concerned`] : [])
        ].join(' ');

  return (
    <div data-testid="closed-action-row" className="p-4 border-b border-slate-100 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className={`min-w-0 ${deferred ? 'opacity-60' : ''}`}>
          <div className="font-medium text-slate-700">{action.text}</div>
          {action.contextText && (
            <div className="text-xs text-indigo-600 italic mt-0.5">{action.contextText}</div>
          )}
        </div>
        {isFacilitator && (
          // A toggle, not a one-way door. This used to remove the row outright,
          // so a mis-click cost the round that action with no way back inside
          // the session.
          <button
            type="button"
            onClick={() => onToggleDefer(action.id)}
            data-testid="defer-impact-rating"
            aria-pressed={deferred}
            className={`inline-flex items-center gap-1 text-xs font-semibold rounded-lg px-2 py-1 shrink-0 transition border ${
              deferred
                ? 'bg-amber-50 border-amber-300 text-amber-800'
                : 'bg-white border-slate-200 text-slate-500 hover:text-retro-primary hover:border-retro-primary'
            }`}
            title={
              deferred
                ? 'Put this action back into this round'
                : 'Ask the team again at the next retrospective'
            }
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">schedule</span>
            Rate later
          </button>
        )}
      </div>

      {deferred ? (
        <div
          data-testid="impact-deferred-note"
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1"
        >
          <span className="material-symbols-outlined text-sm" aria-hidden="true">schedule</span>
          Postponed to the next retrospective
        </div>
      ) : (
        <>
          {!isFacilitator && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-3">
              <div
                role="group"
                aria-label={`Impact of the action: ${action.text}`}
                className={`inline-flex items-center gap-0.5 ${
                  previewing ? 'text-amber-400' : 'text-amber-600'
                }`}
                onMouseLeave={() => setPreview(null)}
              >
                {SCORES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    // Clicking your own answer again clears it, the way every
                    // other vote in this product behaves.
                    onClick={() => onRate(action.id, myVote === value ? null : value)}
                    onMouseEnter={() => setPreview(value)}
                    onFocus={() => setPreview(value)}
                    onBlur={() => setPreview(null)}
                    aria-pressed={myVote === value}
                    aria-label={`${value} of 3 — ${SCORE_LABEL[value]}`}
                    className="p-0.5 rounded-sm transition hover:scale-110 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-retro-primary"
                  >
                    <Star fill={shown >= value ? 1 : 0} className="w-7 h-7" />
                  </button>
                ))}
              </div>

              {/* The scale in words, for whoever has not clicked yet. */}
              <span
                data-testid="impact-choice-label"
                className={`text-xs ${(preview ?? myScore) ? 'font-semibold text-slate-700' : 'text-slate-500'}`}
              >
                {preview
                  ? SCORE_LABEL[preview]
                  : myScore
                    ? SCORE_LABEL[myScore]
                    : myVote === 'abstain'
                      ? 'Not concerned'
                      : SCALE_HINT}
              </span>

              {/* Outside the star bar on purpose: "not concerned" is a refusal
                  to score, not a fourth point on the scale, and a fourth star
                  would make it one. */}
              <button
                type="button"
                onClick={() => onRate(action.id, myVote === 'abstain' ? null : 'abstain')}
                aria-pressed={myVote === 'abstain'}
                className={`inline-flex items-center gap-1 text-xs font-semibold rounded-full border px-3 py-1.5 transition ${
                  myVote === 'abstain'
                    ? 'bg-slate-700 text-white border-slate-700'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}
              >
                <span className="material-symbols-outlined text-base" aria-hidden="true">block</span>
                Not concerned
              </button>
            </div>
          )}

          <div className="mt-3">
            {revealed ? (
              score == null ? (
                <span data-testid="impact-result" className="text-xs text-slate-600">
                  No rating yet
                </span>
              ) : (
                // `role="img"` so the whole thing is announced as the one
                // sentence above instead of as a trail of bare numbers.
                <div
                  data-testid="impact-result"
                  role="img"
                  aria-label={resultLabel}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <StarRating value={score} starClassName="w-5 h-5" />
                    <span className="text-sm font-bold text-slate-700">
                      {Math.round(score * 10) / 10}
                    </span>
                  </span>
                  {spread.map((entry) => (
                    <span
                      key={entry.value}
                      className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5"
                    >
                      <StarRating value={entry.value} max={entry.value} starClassName="w-3 h-3" />
                      <span className="text-xs font-semibold text-slate-700">{entry.count}</span>
                    </span>
                  ))}
                  {abstained > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5">
                      <span className="material-symbols-outlined text-sm text-slate-500" aria-hidden="true">block</span>
                      <span className="text-xs font-semibold text-slate-600">{abstained}</span>
                    </span>
                  )}
                </div>
              )
            ) : (
              // Before reveal: how many people have spoken, never what any of
              // them said.
              <span data-testid="impact-vote-count" className="text-xs text-slate-600">
                {cast} of {raterCount} rated
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
};

interface Props {
  session: RetroSession;
  currentUser: User;
  isFacilitator: boolean;
  participants: User[];
  /** Facilitator only, once per team: where to find the off switch. */
  showNotice: boolean;
  onRate: (actionId: string, vote: ActionImpactVote | null) => void;
  onToggleDefer: (actionId: string) => void;
  onToggleReveal: () => void;
  onDismissNotice: () => void;
}

const ClosedActionsRating: React.FC<Props> = ({
  session,
  currentUser,
  isFacilitator,
  participants,
  showNotice,
  onRate,
  onToggleDefer,
  onToggleReveal,
  onDismissNotice
}) => {
  const actions = session.closedActionsSnapshot ?? [];
  // Nothing closed since the last retro: the phase renders exactly as it did
  // before this feature existed.
  if (actions.length === 0) return null;

  const revealed = Boolean(session.settings?.revealActionImpact);
  const votes = session.actionImpactVotes ?? {};
  const raters = impactRaters(participants, session.leftUsers);
  const raterIds = new Set(raters.map((p) => p.id));

  return (
    <div className="mt-8" data-testid="closed-actions-rating">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-bold text-slate-700">Recently closed — rate the impact</h3>
          <p className="text-xs text-slate-600">Did this change anything for the team?</p>
        </div>
        {isFacilitator && (
          <button
            onClick={onToggleReveal}
            data-testid="toggle-impact-reveal"
            className="text-xs font-bold px-3 py-1.5 rounded-lg border border-retro-primary text-retro-primary hover:bg-indigo-50 transition"
          >
            {revealed ? 'Hide results' : 'Reveal results'}
          </button>
        )}
      </div>

      {showNotice && isFacilitator && (
        <div
          className="mb-3 flex items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3"
          data-testid="impact-rating-notice"
        >
          <span className="material-symbols-outlined text-indigo-700 text-xl shrink-0">info</span>
          <p className="text-sm text-indigo-900 grow">
            Your team can now rate the impact of closed actions. You can turn this off any time in
            Team Settings.
          </p>
          <button
            onClick={onDismissNotice}
            className="text-indigo-700 hover:text-indigo-900 shrink-0"
            aria-label="Dismiss the impact rating notice"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        {actions.map((action) => (
          <ClosedActionRow
            key={action.id}
            action={action}
            sessionId={session.id}
            currentUser={currentUser}
            isFacilitator={isFacilitator}
            revealed={revealed}
            actionVotes={votes[action.id] ?? {}}
            raterIds={raterIds}
            raterCount={raters.length}
            onRate={onRate}
            onToggleDefer={onToggleDefer}
          />
        ))}
      </div>
    </div>
  );
};

export default ClosedActionsRating;
