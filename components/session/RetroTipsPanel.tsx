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
      className="border-b border-amber-200 bg-linear-to-r from-amber-50 via-white to-sky-50"
    >
      <div className="px-4 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-amber-800">
              <span className="material-symbols-outlined text-lg">tips_and_updates</span>
              <span className="text-xs font-bold uppercase tracking-[0.2em]">{t('phases.tips.title')}</span>
            </div>
            <h2 className="mt-2 text-lg font-bold text-slate-800">{currentTip.label}</h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('phases.tips.closePanel')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
          >
            {t('phases.tips.hide')}
          </button>
        </div>

        <div
          data-testid="retro-tips-current-stage"
          className="mt-2 rounded-xl border border-slate-200 bg-white/90 p-3 shadow-xs"
        >
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{t('phases.tips.purpose')}</div>
          <p className="mt-2 text-sm leading-5 text-slate-600">{currentTip.purpose}</p>
        </div>
      </div>
    </section>
  );
};

export default RetroTipsPanel;
