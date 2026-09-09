import React from 'react';
import { ActionImpactVote, RetroSession, User } from '../../types';
import { actionImpactScore, actionImpactVoteCount } from '../../utils/actionImpact.js';
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
const CHOICES: { value: ActionImpactVote; label: string }[] = [
  { value: 1, label: 'No real impact' },
  { value: 2, label: 'Some impact' },
  { value: 3, label: 'Clear impact' },
  { value: 'abstain', label: 'Not concerned' }
];

const SCORE_LABEL: Record<number, string> = {
  1: 'No real impact',
  2: 'Some impact',
  3: 'Clear impact'
};

interface Props {
  session: RetroSession;
  currentUser: User;
  isFacilitator: boolean;
  participants: User[];
  /** Facilitator only, once per team: where to find the off switch. */
  showNotice: boolean;
  onRate: (actionId: string, vote: ActionImpactVote | null) => void;
  onDefer: (actionId: string) => void;
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
  onDefer,
  onToggleReveal,
  onDismissNotice
}) => {
  const actions = session.closedActionsSnapshot ?? [];
  // Nothing closed since the last retro: the phase renders exactly as it did
  // before this feature existed.
  if (actions.length === 0) return null;

  const revealed = Boolean(session.settings?.revealActionImpact);
  const votes = session.actionImpactVotes ?? {};
  const raterCount = impactRaters(participants, session.leftUsers).length;

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
        {actions.map((action) => {
          const actionVotes = votes[action.id] ?? {};
          const myVote = actionVotes[currentUser.id];
          const cast = actionImpactVoteCount({ impactRatings: actionVotes });
          const score = actionImpactScore({ impactRatings: actionVotes });

          return (
            <div
              key={action.id}
              data-testid="closed-action-row"
              className="p-4 border-b border-slate-100 last:border-0"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium text-slate-700">{action.text}</div>
                  {action.contextText && (
                    <div className="text-xs text-indigo-600 italic mt-0.5">{action.contextText}</div>
                  )}
                </div>
                {isFacilitator && (
                  <button
                    onClick={() => onDefer(action.id)}
                    data-testid="defer-impact-rating"
                    className="text-xs font-semibold text-slate-500 hover:text-retro-primary border border-slate-200 hover:border-retro-primary rounded-lg px-2 py-1 shrink-0 transition"
                    title="Ask the team again at the next retrospective"
                  >
                    Rate later
                  </button>
                )}
              </div>

              {!isFacilitator && (
                <div
                  role="group"
                  aria-label={`Impact of the action: ${action.text}`}
                  className="flex flex-wrap gap-2 mt-3"
                >
                  {CHOICES.map((choice) => {
                    const selected = myVote === choice.value;
                    return (
                      <button
                        key={String(choice.value)}
                        // Clicking your own answer again clears it, the way
                        // every other vote in this product behaves.
                        onClick={() => onRate(action.id, selected ? null : choice.value)}
                        aria-pressed={selected}
                        className={`text-xs font-semibold rounded-full border px-3 py-1.5 transition ${
                          selected
                            ? 'bg-retro-primary text-white border-retro-primary'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-retro-primary hover:text-retro-primary'
                        }`}
                      >
                        {choice.label}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="text-xs text-slate-600 mt-3">
                {revealed ? (
                  score == null ? (
                    <span data-testid="impact-result">No rating yet</span>
                  ) : (
                    <span data-testid="impact-result">
                      <span className="font-bold text-slate-700">{Math.round(score * 10) / 10}/3</span>
                      {' · '}
                      {[3, 2, 1]
                        .map((value) => {
                          const count = Object.values(actionVotes).filter((v) => v === value).length;
                          return count > 0 ? `${count} ${SCORE_LABEL[value].toLowerCase()}` : null;
                        })
                        .filter(Boolean)
                        .join(', ')}
                      {(() => {
                        const abstained = Object.values(actionVotes).filter((v) => v === 'abstain').length;
                        return abstained > 0 ? ` · ${abstained} not concerned` : '';
                      })()}
                    </span>
                  )
                ) : (
                  // Before reveal: how many people have spoken, never what any
                  // of them said.
                  <span data-testid="impact-vote-count">
                    {cast} of {raterCount} rated
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ClosedActionsRating;
