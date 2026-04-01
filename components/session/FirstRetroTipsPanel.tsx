import React from 'react';
import { FIRST_RETRO_PHASE_TIPS, getFirstRetroPhaseTip } from './firstRetroTips';

interface Props {
  currentPhase: string;
  onApplyTimebox: (seconds: number) => void;
  onClose: () => void;
  onDismiss: () => void;
}

const FirstRetroTipsPanel: React.FC<Props> = ({
  currentPhase,
  onApplyTimebox,
  onClose,
  onDismiss
}) => {
  const currentTip = getFirstRetroPhaseTip(currentPhase);

  return (
    <section
      aria-label="First retro tips"
      data-testid="first-retro-tips-panel"
      className="border-b border-amber-200 bg-gradient-to-r from-amber-50 via-white to-sky-50"
    >
      <div className="px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-amber-800">
              <span className="material-symbols-outlined text-lg">tips_and_updates</span>
              <span className="text-sm font-bold uppercase tracking-wide">First retro tips</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Suggested timeboxes stay hidden until you open them. Use them as a starting point and adjust for your team size.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
            >
              Hide tips
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg border border-amber-200 bg-amber-100 px-3 py-2 text-sm font-bold text-amber-800 transition hover:border-amber-300 hover:bg-amber-200"
            >
              Dismiss for this team
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div
            data-testid="first-retro-current-stage"
            className="rounded-2xl border border-amber-200 bg-white/90 p-4 shadow-sm"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-amber-700">Current stage</div>
                <h2 className="mt-1 text-lg font-bold text-slate-800">{currentTip.label}</h2>
              </div>
              <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-800">
                {currentTip.suggestedTimebox}
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-600">{currentTip.guidance}</p>
            {currentTip.note && (
              <p className="mt-2 text-sm text-slate-500">{currentTip.note}</p>
            )}
            {currentTip.presets?.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {currentTip.presets.map((preset) => (
                  <button
                    key={`${currentTip.phase}-${preset.seconds}`}
                    type="button"
                    onClick={() => onApplyTimebox(preset.seconds)}
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-indigo-700"
                    aria-label={`Set timer to ${preset.label.replace('Set ', '').toLowerCase()}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-sky-200 bg-white/90 p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-sky-700">Typical flow</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {FIRST_RETRO_PHASE_TIPS.map((tip) => {
                const isCurrent = tip.phase === currentPhase;
                return (
                  <div
                    key={tip.phase}
                    className={`rounded-xl border px-3 py-3 ${
                      isCurrent ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm font-bold text-slate-800">{tip.label}</span>
                      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        {tip.suggestedTimebox}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-600">{tip.guidance}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FirstRetroTipsPanel;
