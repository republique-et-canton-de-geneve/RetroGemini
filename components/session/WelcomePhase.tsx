import React from 'react';
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
  const myVote = session.happiness[currentUser.id];
  const votes = Object.values(session.happiness);
  const voterCount = Object.keys(session.happiness).length;

  const histogram = [1, 2, 3, 4, 5].map((rating) => votes.filter((vote) => vote === rating).length);
  const maxVal = Math.max(...histogram, 1);

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 overflow-y-auto">
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Happiness Check</h2>
      <p className="text-slate-500 mb-8">How are you feeling about the last sprint?</p>

      <div className="flex gap-4 mb-12">
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            onClick={() =>
              updateSession((draft) => {
                draft.happiness[currentUser.id] = score;
              })
            }
            className={`text-6xl transition transform hover:scale-110 ${myVote === score ? 'opacity-100 scale-110 grayscale-0' : 'opacity-40 grayscale hover:grayscale-0'}`}
          >
            {['⛈️', '🌧️', '☁️', '🌤️', '☀️'][score - 1]}
          </button>
        ))}
      </div>

      {!session.settings.revealHappiness ? (
        <div className="mb-8 text-center">
          <div className="text-lg font-bold text-slate-600 mb-2">
            {voterCount} / {participantsCount} voted
          </div>
          {isFacilitator && (
            <button
              onClick={() =>
                updateSession((draft) => {
                  draft.settings.revealHappiness = true;
                })
              }
              className="bg-indigo-600 text-white px-6 py-2 rounded-full font-bold shadow hover:bg-indigo-700"
            >
              Reveal Results
            </button>
          )}
        </div>
      ) : (
        <div className="w-full max-w-lg bg-white p-6 rounded-xl shadow-lg border border-slate-200">
          <div className="flex items-end justify-between h-48 space-x-4">
            {histogram.map((count, index) => (
              <div key={index} className="flex flex-col items-center flex-1 h-full justify-end">
                {count > 0 && (
                  <div
                    className="w-full bg-indigo-500 rounded-t-lg relative group bar-anim"
                    style={{ height: `${(count / maxVal) * 100}%` }}
                  >
                    <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 font-bold text-indigo-700">
                      {count}
                    </div>
                  </div>
                )}
                <div className="mt-2 text-xl">{['⛈️', '🌧️', '☁️', '🌤️', '☀️'][index]}</div>
              </div>
            ))}
          </div>
          <div className="text-center mt-4 text-slate-500 font-bold">
            {voterCount} / {participantsCount} participants voted
          </div>
        </div>
      )}
      {isFacilitator && (
        <button
          onClick={onNext}
          className="mt-12 bg-white text-slate-800 border border-slate-300 px-6 py-2 rounded-lg font-bold hover:bg-slate-50 shadow-sm"
        >
          Next Phase
        </button>
      )}
    </div>
  );
};

export default WelcomePhase;
