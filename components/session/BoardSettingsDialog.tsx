import React, { useId } from 'react';
import ModalDialog from '../common/ModalDialog';
import { useTranslation } from '../../i18n/I18nContext';
import type { RetroSettings } from '../../types';

/**
 * The open board's settings, for its facilitator: who wrote what, whether the
 * cards are hidden, and how votes work. A board's bar used to carry them all
 * inline, beside the search and the sort everyone uses, and wrapped onto three
 * lines on a laptop.
 *
 * Every setting here is facilitator-only content (`sessionGuard.js`), written
 * by the session's own handlers: showing the authors again asks first
 * (ShowAuthorsDialog, opened over this one), turning unlimited votes off takes
 * back the votes above the number, and "one vote per item" keeps one per
 * voter. The number of votes and the colour are the controls the guided bars
 * render, passed in as they are.
 */

interface Props {
  settings: RetroSettings;
  /** Reconnecting: edits would be dropped, so the controls are off. */
  disabled: boolean;
  onClose: () => void;
  onToggleAnonymous: (anonymous: boolean) => void;
  onHideCards: (hidden: boolean) => void;
  onDisableVoting: (disabled: boolean) => void;
  onHideVoteCount: (hidden: boolean) => void;
  onUnlimitedVotes: (unlimited: boolean) => void;
  onOneVotePerItem: (oneVote: boolean) => void;
  maxVotesControl: React.ReactNode;
  colorByControl: React.ReactNode;
}

interface ToggleProps {
  label: string;
  hint?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

const SettingToggle: React.FC<ToggleProps> = ({ label, hint, checked, disabled, onChange }) => {
  const id = useId();
  return (
    <div className="flex items-start gap-3 py-2">
      <input
        id={id}
        type="checkbox"
        className="mt-1"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-slate-800 cursor-pointer">{label}</label>
        {hint && <p id={`${id}-hint`} className="text-xs text-slate-600">{hint}</p>}
      </div>
    </div>
  );
};

const BoardSettingsDialog: React.FC<Props> = ({
  settings,
  disabled,
  onClose,
  onToggleAnonymous,
  onHideCards,
  onDisableVoting,
  onHideVoteCount,
  onUnlimitedVotes,
  onOneVotePerItem,
  maxVotesControl,
  colorByControl
}) => {
  const { t } = useTranslation();
  const titleId = useId();

  return (
    <ModalDialog
      labelledBy={titleId}
      onClose={onClose}
      overlayClassName="fixed inset-0 bg-black/50 z-100 flex items-center justify-center p-4 backdrop-blur-xs"
      panelClassName="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto"
    >
      <div className="flex items-center justify-between gap-4 mb-2">
        <h2 id={titleId} className="text-lg font-bold text-slate-800">{t('session.openBoard.settingsTitle')}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="w-8 h-8 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 transition"
        >
          <span className="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>

      <fieldset className="mb-4">
        <legend className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">{t('session.openBoard.settingsCards')}</legend>
        <SettingToggle
          label={t('session.openBoard.anonymous')}
          hint={t('session.openBoard.anonymousHint')}
          checked={settings.isAnonymous}
          disabled={disabled}
          onChange={onToggleAnonymous}
        />
        <SettingToggle
          label={t('session.openBoard.hideCards')}
          hint={t('session.openBoard.hideCardsHint')}
          checked={!settings.revealBrainstorm}
          disabled={disabled}
          onChange={onHideCards}
        />
        <div className="py-2">{colorByControl}</div>
      </fieldset>

      <fieldset>
        <legend className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">{t('session.openBoard.settingsVotes')}</legend>
        <SettingToggle
          label={t('session.openBoard.disableVoting')}
          hint={t('session.openBoard.disableVotingHint')}
          checked={!!settings.votingDisabled}
          disabled={disabled}
          onChange={onDisableVoting}
        />
        <SettingToggle
          label={t('session.openBoard.hideVoteCount')}
          hint={t('session.openBoard.hideVoteCountHint')}
          checked={!!settings.voteCountHidden}
          disabled={disabled}
          onChange={onHideVoteCount}
        />
        <SettingToggle
          label={t('session.board.unlimitedVotes')}
          hint={t('session.openBoard.unlimitedVotesHint')}
          checked={!!settings.unlimitedVotes}
          disabled={disabled}
          onChange={onUnlimitedVotes}
        />
        <div className="py-2">{maxVotesControl}</div>
        <SettingToggle
          label={t('session.openBoard.oneVotePerItem')}
          checked={settings.oneVotePerTicket}
          disabled={disabled}
          onChange={onOneVotePerItem}
        />
      </fieldset>
    </ModalDialog>
  );
};

export default BoardSettingsDialog;
