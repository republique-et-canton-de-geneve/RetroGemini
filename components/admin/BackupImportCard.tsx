import React, { useId, useState } from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { Notice, noticeText } from '../../i18n/notice';
import type { BackupEntry, BackupLimits } from '../../types';
import { importBackupFile, type ListReload } from './backupImportApi';
import { formatBackupSize, megabytes, withLocalizedMax } from './backupFormat';

/**
 * The Backups tab's "Import a backup file" card, between "Create Checkpoint"
 * and the list (`POST /api/super-admin/backups/import`). The file becomes a
 * row of the list, marked "imported"; restoring from it is the row's own
 * buttons, and the page opens the team-restore dialog on the new row by itself.
 *
 * Accessibility, each point pinned by `backupImportCard.test.tsx`:
 * - a visible label, the hint and any error tied to the field
 *   (`aria-describedby`, `aria-invalid` when the file is what was refused);
 * - the button is `aria-disabled` while busy, never `disabled`: a focused
 *   button that turns disabled drops focus to <body>, and the dialog that opens
 *   afterwards would return focus to nowhere;
 * - the status is always mounted (so it is announced) and always visible,
 *   and both messages wrap: they quote file names, one unbreakable token wider
 *   than a 320 px screen;
 * - white on teal-700 (5.39:1); teal-600 measures 3.66:1 and is not used.
 *
 * Messages are kept as what to say, never as the sentence, so they follow the
 * language switcher while they are on screen.
 */

interface Props {
  sessionToken: string;
  /** What `/backups/list` reported; `null` from a pod before 41.0. */
  limits: BackupLimits | null;
  onImported: (backup: BackupEntry) => void;
  /** Read the list again: after a failure, and twice after a lost answer. */
  onReloadList: (when: ListReload) => void;
}

type Status =
  | { kind: 'importing'; name: string; bytes: number }
  | { kind: 'imported'; name: string; count: number }
  | null;

const BackupImportCard: React.FC<Props> = ({ sessionToken, limits, onImported, onReloadList }) => {
  const { t, locale } = useTranslation();
  const baseId = useId().replace(/:/g, '');
  const titleId = `${baseId}-title`;
  const inputId = `${baseId}-file`;
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;

  const [file, setFile] = useState<File | null>(null);
  // A new key clears the file input, which cannot be cleared from React.
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Notice>(null);
  const [fileError, setFileError] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const submit = async () => {
    if (busy) return;
    if (!file) {
      setStatus(null);
      setError({ key: 'adminBackups.import.error.noFile' });
      setFileError(true);
      return;
    }
    const chosen = file;
    setBusy(true);
    setError(null);
    setFileError(false);
    setStatus({ kind: 'importing', name: chosen.name, bytes: chosen.size });

    const outcome = await importBackupFile(sessionToken, chosen, limits);
    if (outcome.status === 'ok') {
      setFile(null);
      setInputKey((key) => key + 1);
      setStatus({ kind: 'imported', name: chosen.name, count: outcome.backup.teamCount });
      setBusy(false);
      // Last: the dialog it opens captures the opener while this button still
      // holds focus, so closing the dialog returns focus here.
      onImported(outcome.backup);
      return;
    }
    setBusy(false);
    setStatus(null);
    setError(outcome.notice);
    setFileError(outcome.status === 'failed' && outcome.fileError);
    if (outcome.reload) onReloadList(outcome.reload);
  };

  const statusText = !status
    ? ''
    : status.kind === 'importing'
      ? t('adminBackups.import.status.importing', { name: status.name, size: formatBackupSize(status.bytes, t, locale) })
      : t('adminBackups.import.imported', { name: status.name, count: status.count });

  return (
    <section aria-labelledby={titleId} data-testid="backup-import-card" className="bg-white rounded-lg shadow-sm p-4 mb-6">
      <h3 id={titleId} className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2">
        <span aria-hidden="true" className="material-symbols-outlined text-base text-teal-700">upload</span>
        {t('adminBackups.import.title')}
      </h3>
      <p className="text-sm text-slate-600 mb-3">{t('adminBackups.import.description')}</p>
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1 min-w-0">
          <label htmlFor={inputId} className="block text-sm font-medium text-slate-700 mb-1">
            {t('adminBackups.import.fileLabel')}
          </label>
          <input
            key={inputKey}
            id={inputId}
            type="file"
            accept=".gz,.json,application/gzip,application/json"
            aria-describedby={[hintId, error ? errorId : null].filter(Boolean).join(' ')}
            aria-invalid={error && fileError ? true : undefined}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setError(null);
              setFileError(false);
            }}
            className="w-full text-sm text-slate-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
          />
          <p id={hintId} className="text-xs text-slate-600 mt-1">
            {limits
              ? t('adminBackups.import.hint', { max: megabytes(limits.maxArchiveBytes, locale) })
              : t('adminBackups.import.hintNoLimit')}
          </p>
        </div>
        <button
          type="button"
          onClick={busy ? undefined : () => void submit()}
          aria-disabled={busy ? true : undefined}
          className="px-4 py-2 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 bg-teal-700 text-white hover:bg-teal-800 aria-disabled:cursor-wait aria-disabled:opacity-70"
        >
          <span aria-hidden="true" className={`material-symbols-outlined text-base ${busy ? 'animate-spin' : ''}`}>
            {busy ? 'sync' : 'upload'}
          </span>
          {busy ? t('adminBackups.import.importing') : t('adminBackups.import.submit')}
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-red-700 wrap-anywhere">
          {noticeText(withLocalizedMax(error, locale), t)}
        </p>
      )}
      <p role="status" className="mt-2 text-sm text-slate-600 wrap-anywhere">{statusText}</p>
    </section>
  );
};

export default BackupImportCard;
