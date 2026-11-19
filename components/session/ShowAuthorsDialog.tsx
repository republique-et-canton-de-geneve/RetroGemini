import React from 'react';
import ModalDialog from '../common/ModalDialog';
import { useTranslation } from '../../i18n/I18nContext';

/**
 * Asked before an open board stops being anonymous.
 *
 * A board stays open for weeks, so its facilitator may need to change its
 * anonymity on the way — but authorship is stored on every card, and turning
 * anonymity off shows it on all of them at once, including the cards written
 * while the board promised not to. Turning it on asks nothing: it hides.
 */

interface Props {
  /**
   * Reconnecting: the write would be dropped, and a confirmation that closes
   * as if done would say the authors are shown when they are not.
   */
  disabled?: boolean;
  onKeepAnonymous: () => void;
  onShowAuthors: () => void;
}

const ShowAuthorsDialog: React.FC<Props> = ({ disabled = false, onKeepAnonymous, onShowAuthors }) => {
  const { t } = useTranslation();

  return (
    <ModalDialog
      labelledBy="show-authors-title"
      onClose={onKeepAnonymous}
      overlayClassName="fixed inset-0 bg-slate-900/45 z-100 flex items-center justify-center p-4"
      panelClassName="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-md w-full"
    >
      <h2 id="show-authors-title" className="text-lg font-semibold tracking-tight text-slate-900 mb-2">
        {t('session.openBoard.showAuthorsTitle')}
      </h2>
      <p className="text-sm leading-relaxed text-slate-600 mb-6">{t('session.openBoard.showAuthorsBody')}</p>
      <div className="flex gap-3">
        {/* First, so it takes the focus the dialog moves in: the safe choice. */}
        <button
          type="button"
          onClick={onKeepAnonymous}
          className="flex-1 bg-white text-slate-700 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 py-2.5 rounded-lg font-semibold transition"
        >
          {t('session.openBoard.keepAnonymous')}
        </button>
        <button
          type="button"
          onClick={onShowAuthors}
          disabled={disabled}
          // Reconnecting, it is off: said by its colours, not by an opacity.
          className={`flex-1 py-2.5 rounded-lg font-semibold transition ${
            disabled
              ? 'bg-slate-200 text-slate-600 cursor-not-allowed'
              : 'bg-indigo-600 text-white hover:bg-indigo-700 btn-brand-glow motion-safe:active:scale-[0.97]'
          }`}
        >
          {t('session.openBoard.showAuthors')}
        </button>
      </div>
    </ModalDialog>
  );
};

export default ShowAuthorsDialog;
