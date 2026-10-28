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
  onKeepAnonymous: () => void;
  onShowAuthors: () => void;
}

const ShowAuthorsDialog: React.FC<Props> = ({ onKeepAnonymous, onShowAuthors }) => {
  const { t } = useTranslation();

  return (
    <ModalDialog
      labelledBy="show-authors-title"
      onClose={onKeepAnonymous}
      overlayClassName="fixed inset-0 bg-black/50 z-100 flex items-center justify-center p-4 backdrop-blur-xs"
      panelClassName="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full"
    >
      <h2 id="show-authors-title" className="text-lg font-bold text-slate-800 mb-2">
        {t('session.openBoard.showAuthorsTitle')}
      </h2>
      <p className="text-sm text-slate-600 mb-6">{t('session.openBoard.showAuthorsBody')}</p>
      <div className="flex gap-3">
        {/* First, so it takes the focus the dialog moves in: the safe choice. */}
        <button
          type="button"
          onClick={onKeepAnonymous}
          className="flex-1 bg-slate-100 text-slate-700 py-2.5 rounded-lg font-bold hover:bg-slate-200 transition"
        >
          {t('session.openBoard.keepAnonymous')}
        </button>
        <button
          type="button"
          onClick={onShowAuthors}
          className="flex-1 bg-retro-primary text-white py-2.5 rounded-lg font-bold hover:bg-retro-primaryHover transition"
        >
          {t('session.openBoard.showAuthors')}
        </button>
      </div>
    </ModalDialog>
  );
};

export default ShowAuthorsDialog;
