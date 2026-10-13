import React, { useEffect, useId, useRef, useState } from 'react';
import { Team } from '../../types';
import { dataService } from '../../services/dataService';
import { parseEmailInput } from '../../utils/emailAddress.js';
import { useTranslation } from '../../i18n/I18nContext';
import { Notice, noticeFromError, noticeText } from '../../i18n/notice';

interface Props {
  team: Team;
  onRefresh: () => void;
}

/**
 * The team's recovery address, in the Dashboard settings.
 *
 * It used to save on **every keystroke**, outside any form and with no check at
 * all, so whatever was in the field at the last keystroke became the address
 * the password-reset route compares against — a pasted
 * `elisabeth.trolliet@etat.ge.ch;` included, which no typed address could ever
 * match. It could not be emptied either: the clear went out as `undefined`,
 * which JSON drops.
 *
 * Now it keeps a draft and commits it on blur or Enter, through the shared rule
 * (`utils/emailAddress.js`, applied in `dataService.updateFacilitatorEmail`):
 * the cleaned address is saved and shown, an emptied field removes it, and
 * anything else is refused with an error the field points at. Nothing is
 * judged while the user types — a half-typed address is not a mistake yet.
 */
const RecoveryEmailSetting: React.FC<Props> = ({ team, onRefresh }) => {
  const { t } = useTranslation();
  const stored = team.facilitatorEmail || '';
  const [draft, setDraft] = useState(stored);
  const [error, setError] = useState<Notice>(null);
  const [saved, setSaved] = useState<Notice>(null);
  const editing = useRef(false);
  // What the server was last asked to store. Enter commits and the blur that
  // usually follows commits again; comparing against this rather than the prop
  // (which only moves once the parent refreshes) keeps that to one write.
  const lastSaved = useRef(stored);
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const descriptionId = `${baseId}-description`;
  const errorId = `${baseId}-error`;

  // Follow a change made elsewhere (another tab, the super admin, the server's
  // answer) — but never while the user is editing, or a refresh landing
  // mid-word would replace what they are typing.
  useEffect(() => {
    lastSaved.current = stored;
    if (!editing.current) setDraft(stored);
  }, [stored]);

  const commit = () => {
    const parsed = parseEmailInput(draft);
    // Nothing to save: show the canonical form and write nothing, so a blur
    // that changed nothing costs no request and says nothing.
    if (parsed.ok && (parsed.email ?? '') === lastSaved.current) {
      setDraft(lastSaved.current);
      setError(null);
      return;
    }
    try {
      const result = dataService.updateFacilitatorEmail(team.id, draft);
      lastSaved.current = result ?? '';
      setDraft(result ?? '');
      setError(null);
      setSaved({ key: result ? 'dashboard.settings.recoveryEmailSaved' : 'dashboard.settings.recoveryEmailRemoved' });
      onRefresh();
    } catch (err) {
      setSaved(null);
      setError(noticeFromError(err, { key: 'errors.invalidEmail' }));
    }
  };

  return (
    <div className="mb-4">
      <h3 className="font-bold text-slate-700 mb-2 flex items-center">
        <span className="material-symbols-outlined mr-2 text-slate-500" aria-hidden="true">email</span>
        <label htmlFor={inputId}>{t('dashboard.settings.recoveryEmail')}</label>
      </h3>
      <p id={descriptionId} className="text-sm text-slate-500 mb-3">
        {t('dashboard.settings.recoveryEmailDescription')}
      </p>
      <div className="flex gap-3">
        <input
          id={inputId}
          type="email"
          value={draft}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${errorId} ${descriptionId}` : descriptionId}
          onFocus={() => {
            editing.current = true;
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
            setSaved(null);
          }}
          onBlur={() => {
            editing.current = false;
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          className="flex-1 border border-slate-300 rounded-lg p-2 text-sm"
          placeholder={t('dashboard.settings.recoveryEmailPlaceholder')}
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-red-600 mt-2 flex items-center">
          <span className="material-symbols-outlined text-xs mr-1" aria-hidden="true">error</span>
          {noticeText(error, t)}
        </p>
      )}
      {saved && (
        <p role="status" className="text-xs text-green-700 mt-2 flex items-center">
          <span className="material-symbols-outlined text-xs mr-1" aria-hidden="true">check_circle</span>
          {noticeText(saved, t)}
        </p>
      )}
      {!stored && (
        <p className="text-xs text-amber-600 mt-2 flex items-center">
          <span className="material-symbols-outlined text-xs mr-1" aria-hidden="true">warning</span>
          {t('dashboard.settings.noRecoveryEmail')}
        </p>
      )}
    </div>
  );
};

export default RecoveryEmailSetting;
