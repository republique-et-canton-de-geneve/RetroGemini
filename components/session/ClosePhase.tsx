import React from 'react';
import { RetroSession, User } from '../../types';

interface Props {
  session: RetroSession;
  currentUser: User;
  participantsCount: number;
  isFacilitator: boolean;
  updateSession: (updater: (session: RetroSession) => void) => void;
  handleExit: () => void;
}

const ClosePhase: React.FC<Props> = ({
  session,
  currentUser,
  participantsCount,
  isFacilitator,
  updateSession,
  handleExit
}) => {
  const myRoti = session.roti[currentUser.id];
  const votes: number[] = Object.values(session.roti);
  const voterCount = Object.keys(session.roti).length;
  const average = votes.length ? (votes.reduce((a, b) => a + b, 0) / votes.length).toFixed(1) : '-';
  const histogram = [1, 2, 3, 4, 5].map((value) => votes.filter((vote) => vote === value).length);
  const maxVal = Math.max(...histogram, 1);

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 bg-slate-900 text-white">
      <h1 className="text-3xl font-bold mb-2">Session Closed</h1>
      <p className="text-slate-400 mb-8">Thank you for your contribution!</p>

      <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 max-w-lg w-full text-center">
        <h3 className="text-xl font-bold mb-6">ROTI (Return on Time Invested)</h3>
        <div className="flex justify-center space-x-2 mb-8">
          {[1, 2, 3, 4, 5].map((score) => (
            <button
              key={score}
              onClick={() => updateSession((draft) => {
                draft.roti[currentUser.id] = score;
              })}
              className={`w-10 h-10 rounded-full font-bold transition ${myRoti === score ? 'bg-retro-primary text-white scale-110' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
            >
              {score}
            </button>
          ))}
        </div>

        {!session.settings.revealRoti ? (
          <div className="mb-4">
            <div className="text-slate-400 font-bold mb-4">
              {voterCount} / {participantsCount} members have voted
            </div>
            {isFacilitator && (
              <button
                onClick={() =>
                  updateSession((draft) => {
                    draft.settings.revealRoti = true;
                  })
                }
                className="text-indigo-400 hover:text-white font-bold underline"
              >
                Reveal Results
              </button>
            )}
          </div>
        ) : (
          <div className="mt-6">
            <div className="flex items-end justify-center h-24 space-x-3 mb-2">
              {histogram.map((count, index) => (
                <div key={index} className="flex flex-col items-center justify-end h-full">
                  {count > 0 && <span className="text-xs font-bold mb-1">{count}</span>}
                  <div
                    className="w-8 bg-indigo-500 rounded-t relative transition-all duration-500"
                    style={{
                      height: count > 0 ? `${(count / maxVal) * 100}%` : '4px',
                      opacity: count > 0 ? 1 : 0.2
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-center space-x-3 text-xs text-slate-500 border-t border-slate-700 pt-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <div key={value} className="w-8">
                  {value}
                </div>
              ))}
            </div>
            <div className="mt-4 text-2xl font-black text-indigo-400">{average} / 5</div>
          </div>
        )}
      </div>

      {isFacilitator ? (
        <button onClick={handleExit} className="mt-8 bg-white text-slate-900 px-8 py-3 rounded-lg font-bold hover:bg-slate-200">
          Return to Dashboard
        </button>
      ) : (
        <button onClick={handleExit} className="mt-8 bg-white text-slate-900 px-8 py-3 rounded-lg font-bold hover:bg-slate-200">
          Leave Retrospective
        </button>
      )}
    </div>
  );
};

export default ClosePhase;
