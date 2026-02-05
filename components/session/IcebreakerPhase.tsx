import React from 'react';
import { RetroSession } from '../../types';

interface Props {
  session: RetroSession;
  isFacilitator: boolean;
  localIcebreakerQuestion: string | null;
  onQuestionChange: (value: string) => void;
  onRandom: () => void;
  onStart: () => void;
}

const IcebreakerPhase: React.FC<Props> = ({
  session,
  isFacilitator,
  localIcebreakerQuestion,
  onQuestionChange,
  onRandom,
  onStart
}) => (
  <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-slate-900 text-white">
    <div className="bg-slate-800 p-10 rounded-2xl shadow-xl border border-slate-700 max-w-4xl w-full h-[600px] flex flex-col">
      <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center text-3xl mb-4 mx-auto shrink-0">🧊</div>
      <h2 className="text-3xl font-bold mb-6 shrink-0">Icebreaker</h2>

      <div className="flex-grow flex flex-col relative mb-8">
        {isFacilitator ? (
          <textarea
            value={localIcebreakerQuestion !== null ? localIcebreakerQuestion : session.icebreakerQuestion}
            onChange={(event) => onQuestionChange(event.target.value)}
            className="w-full h-full bg-slate-900 border border-slate-600 rounded-xl p-6 text-3xl text-center text-indigo-300 font-medium leading-relaxed focus:border-retro-primary outline-none resize-none flex-grow"
            placeholder="Type or generate a question..."
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-slate-900/50 rounded-xl border border-slate-700/50 p-6">
            <p className="text-3xl text-indigo-300 font-medium leading-relaxed">{session.icebreakerQuestion}</p>
          </div>
        )}
      </div>

      <div className="shrink-0 flex justify-center space-x-4">
        {isFacilitator ? (
          <>
            <button
              onClick={onRandom}
              className="text-retro-primary hover:text-white text-sm font-bold flex items-center px-4 py-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition"
            >
              <span className="material-symbols-outlined mr-2">shuffle</span> Random
            </button>
            <button
              onClick={onStart}
              className="bg-white text-slate-900 px-8 py-3 rounded-lg font-bold hover:bg-slate-200 shadow-lg transition transform hover:-translate-y-1"
            >
              Start Session
            </button>
          </>
        ) : (
          <div className="text-slate-500 italic animate-pulse">Waiting for facilitator to start...</div>
        )}
      </div>
    </div>
  </div>
);

export default IcebreakerPhase;
