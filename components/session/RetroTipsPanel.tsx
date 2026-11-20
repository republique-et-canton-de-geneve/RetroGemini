import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { getRetroPhaseTip } from './retroTips';

interface Props {
  currentPhase: string;
  onClose: () => void;
}

const RetroTipsPanel: React.FC<Props> = ({
  currentPhase,
  onClose
}) => {
  const { t } = useTranslation();
  const currentTip = getRetroPhaseTip(currentPhase, t);

  return (
    <section
      aria-label={t('phases.tips.title')}
      data-testid="retro-tips-panel"
      className="border-b border-slate-200 bg-white"
    >
      <div className="px-4 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-amber-800">
              {/* The header's bulb, on its own warm tile. */}
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-amber-100" aria-hidden="true">
                <span className="material-symbols-outlined text-lg">tips_and_updates</span>
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider">{t('phases.tips.title')}</span>
            </div>
            <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">{currentTip.label}</h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('phases.tips.closePanel')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            {t('phases.tips.hide')}
          </button>
        </div>

        <div
          data-testid="retro-tips-current-stage"
          className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">{t('phases.tips.purpose')}</div>
          <p className="mt-2 text-sm leading-5 text-slate-700">{currentTip.purpose}</p>
        </div>
      </div>
    </section>
  );
};

export default RetroTipsPanel;
