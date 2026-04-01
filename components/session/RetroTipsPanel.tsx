import React from 'react';
import { getRetroPhaseTip } from './retroTips';

interface Props {
  currentPhase: string;
  onClose: () => void;
}

const RetroTipsPanel: React.FC<Props> = ({
  currentPhase,
  onClose
}) => {
  const currentTip = getRetroPhaseTip(currentPhase);

  return (
    <section
      aria-label="Retro tips"
      data-testid="retro-tips-panel"
      className="border-b border-amber-200 bg-gradient-to-r from-amber-50 via-white to-sky-50"
    >
      <div className="px-4 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-amber-800">
              <span className="material-symbols-outlined text-lg">tips_and_updates</span>
              <span className="text-xs font-bold uppercase tracking-[0.2em]">Retro tips</span>
            </div>
            <h2 className="mt-2 text-lg font-bold text-slate-800">{currentTip.label}</h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close retro tips panel"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
          >
            Hide
          </button>
        </div>

        <div
          data-testid="retro-tips-current-stage"
          className="mt-2 rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm"
        >
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Purpose</div>
          <p className="mt-2 text-sm leading-5 text-slate-600">{currentTip.purpose}</p>
        </div>
      </div>
    </section>
  );
};

export default RetroTipsPanel;
