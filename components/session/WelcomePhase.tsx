import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { RetroSession, User } from '../../types';

interface Props {
  session: RetroSession;
  currentUser: User;
  participantsCount: number;
  isFacilitator: boolean;
  updateSession: (updater: (session: RetroSession) => void) => void;
  onNext: () => void;
}

const WelcomePhase: React.FC<Props> = ({
  session,
  currentUser,
  participantsCount,
  isFacilitator,
  updateSession,
  onNext
}) => {
  const { t } = useTranslation();
  const myVote = session.happiness[currentUser.id];
  // Votes from participants marked as having left the retro are not counted:
  // the session should never wait on (or report) someone who is gone.
  const leftSet = new Set(session.leftUsers ?? []);
  const activeVotes = Object.entries(session.happiness).filter(([userId]) => !leftSet.has(userId));
  const votes = activeVotes.map(([, vote]) => vote);
  const voterCount = activeVotes.length;

  const histogram = [1, 2, 3, 4, 5].map((rating) => votes.filter((vote) => vote === rating).length);
  const maxVal = Math.max(...histogram, 1);

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 overflow-y-auto bg-slate-50">
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900 mb-2">{t('phases.welcome.title')}</h2>
      <p className="text-slate-600 mb-8">{t('phases.welcome.question')}</p>

      {/* Five moods fit beside each other from 360px; on a narrower screen the
          row wraps rather than scroll the screen sideways and cut its first
          mood off (e2e/no-stray-scrollbars.spec.ts). */}
      <div className="flex flex-wrap justify-center gap-2 sm:gap-4 mb-12">
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            onClick={() =>
              updateSession((draft) => {
                draft.happiness[currentUser.id] = score;
              })
            }
            // The choice shows as a tile in the brand's tint with a brand edge,
            // the others as white tiles: never a faded or grey emoji, which no
            // contrast can be measured on. `text-6xl` stays: the e2e flow finds
            // the five choices by it. Smaller on a phone, where five did not fit.
            aria-pressed={myVote === score}
            className={`text-6xl max-sm:text-3xl leading-none max-sm:p-1.5 sm:p-3 rounded-2xl border transition ${
              myVote === score
                ? 'bg-indigo-100 border-indigo-600 ring-4 ring-indigo-600/15'
                : 'bg-white border-slate-200 hover:border-slate-400 hover:shadow-md'
            }`}
          >
            {['⛈️', '🌧️', '☁️', '🌤️', '☀️'][score - 1]}
          </button>
        ))}
      </div>

      {!session.settings.revealHappiness ? (
        <div className="mb-8 text-center">
          <div className="text-lg font-semibold tabular-nums text-slate-700 mb-3">
            {t('phases.welcome.votedCount', { voted: voterCount, total: participantsCount })}
          </div>
          {isFacilitator && (
            <button
              onClick={() =>
                updateSession((draft) => {
                  draft.settings.revealHappiness = true;
                })
              }
              className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-indigo-700 btn-brand-glow transition"
            >
              {t('phases.shared.revealResults')}
            </button>
          )}
        </div>
      ) : (
        <div className="w-full max-w-lg bg-white p-6 rounded-2xl shadow-xs border border-slate-200">
          <div className="flex items-end justify-between h-48 space-x-4">
            {histogram.map((count, index) => (
              <div key={index} className="flex flex-col items-center flex-1 h-full justify-end">
                {count > 0 && (
                  <div
                    className="w-full bg-indigo-600 rounded-t-lg relative group bar-anim"
                    style={{ height: `${(count / maxVal) * 100}%` }}
                  >
                    {/* Above the bar, on the card's white: the bar is no surface for text. */}
                    <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 font-mono font-semibold text-indigo-700 bg-white">
                      {count}
                    </div>
                  </div>
                )}
                <div className="mt-2 text-xl">{['⛈️', '🌧️', '☁️', '🌤️', '☀️'][index]}</div>
              </div>
            ))}
          </div>
          <div className="text-center mt-4 text-slate-600 font-semibold tabular-nums">
            {t('phases.welcome.participantsVoted', { voted: voterCount, total: participantsCount })}
          </div>
        </div>
      )}
      {isFacilitator && (
        <button
          onClick={onNext}
          className="mt-12 bg-white text-slate-700 border border-slate-200 px-6 py-2 rounded-lg font-semibold hover:border-slate-300 hover:bg-slate-50 transition"
        >
          {t('phases.shared.nextPhase')}
        </button>
      )}
    </div>
  );
};

export default WelcomePhase;
