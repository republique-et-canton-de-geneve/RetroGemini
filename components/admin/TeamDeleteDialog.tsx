import React, { useId, useState } from 'react';
import ModalDialog from '../common/ModalDialog';
import { useTranslation } from '../../i18n/I18nContext';
import { Notice, noticeText } from '../../i18n/notice';
import type { Team } from '../../types';
import { deleteTeamAsAdmin } from './teamAdminApi';

/**
 * Deleting a team from the super-admin console — typically one of the two
 * teams of a merge, once the merged team has been checked.
 *
 * The team name is typed back (the server checks it too), and the cases where
 * deleting would lose something are refused once and explained: the team
 * changed after it was merged, it is a merged team whose sources are already
 * gone, or someone is in one of its sessions right now.
 * "Delete anyway" then asks the server to go ahead.
 */

type Conflict =
  | { kind: 'changed'; mergedInto: string }
  | { kind: 'inUse'; sessions: string }
  | { kind: 'sourcesDeleted'; names: string };

interface Props {
  team: Team;
  /** The merged team this one was merged into, if any: its feedbacks move there. */
  mergedInto: { teamId: string; name: string } | null;
  sessionToken: string;
  onClose: () => void;
  onDeleted: (name: string) => void;
}

const TeamDeleteDialog: React.FC<Props> = ({ team, mergedInto, sessionToken, onClose, onDeleted }) => {
  const { t, tRich } = useTranslation();
  const baseId = useId().replace(/:/g, '');
  const titleId = `${baseId}-title`;
  const inputId = `${baseId}-confirm`;
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Notice>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const matches = confirmText.trim() === team.name.trim();

  const remove = async (force: boolean) => {
    setError(null);
    setBusy(true);
    const result = await deleteTeamAsAdmin(sessionToken, { teamId: team.id, confirmName: confirmText, ...(force ? { force: true } : {}) });
    setBusy(false);
    if (result.status === 'ok') {
      onDeleted(team.name);
      return;
    }
    const { data } = result;
    if (data.error === 'source_changed_since_merge') {
      const target = data.mergedInto as { name?: string } | undefined;
      setConflict({ kind: 'changed', mergedInto: target?.name ?? mergedInto?.name ?? '' });
      return;
    }
    if (data.error === 'merge_sources_deleted') {
      const names = Array.isArray(data.sources) ? (data.sources as string[]).join(', ') : '';
      setConflict({ kind: 'sourcesDeleted', names });
      return;
    }
    if (data.error === 'team_in_use') {
      const sessions = Array.isArray(data.sessions) ? (data.sessions as string[]).join(', ') : '';
      setConflict({ kind: 'inUse', sessions });
      return;
    }
    setError(result.notice);
  };

  return (
    <ModalDialog
      labelledBy={titleId}
      onClose={busy ? undefined : onClose}
      overlayClassName="fixed inset-0 bg-black/50 z-100 flex items-center justify-center p-4"
      panelClassName="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full"
    >
      <div className="text-center mb-4">
        <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-3">
          <span className="material-symbols-outlined text-3xl" aria-hidden="true">warning</span>
        </div>
        <h2 id={titleId} className="text-xl font-bold text-slate-800 mb-2 break-all">
          {t('adminTeamMerge.deleteDialog.title', { name: team.name })}
        </h2>
        <p className="text-sm text-slate-600">{t('adminTeamMerge.deleteDialog.warning')}</p>
        <p className="text-sm text-slate-600 mt-2">
          {mergedInto
            ? t('adminTeamMerge.deleteDialog.mergedInto', { name: mergedInto.name })
            : t('adminTeamMerge.deleteDialog.feedbacksKept')}
        </p>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{noticeText(error, t)}</div>
      )}

      {conflict && (
        <div role="alert" className="bg-amber-50 border border-amber-200 text-amber-900 p-3 rounded-lg mb-4 text-sm">
          {conflict.kind === 'changed' && t('adminTeamMerge.deleteDialog.changed', { name: conflict.mergedInto })}
          {conflict.kind === 'inUse' && t('adminTeamMerge.deleteDialog.inUse', { names: conflict.sessions })}
          {conflict.kind === 'sourcesDeleted' && t('adminTeamMerge.deleteDialog.sourcesDeleted', { names: conflict.names })}
        </div>
      )}

      <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
        <label htmlFor={inputId} className="block text-sm text-red-800 mb-2">
          {tRich('adminTeamMerge.deleteDialog.confirmLabel', { name: <strong className="break-all">{team.name}</strong> })}
        </label>
        <input
          id={inputId}
          type="text"
          value={confirmText}
          onChange={(e) => { setConfirmText(e.target.value); setConflict(null); }}
          autoComplete="off"
          className="w-full border border-red-300 rounded-lg p-2 bg-white text-slate-900 outline-hidden focus:border-red-500 focus:ring-1 focus:ring-red-500"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-lg font-bold hover:bg-slate-200 disabled:opacity-50"
        >
          {t('common.cancel')}
        </button>
        {conflict ? (
          <button
            onClick={() => remove(true)}
            disabled={!matches || busy}
            className="flex-1 bg-red-600 text-white py-2 rounded-lg font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? t('adminTeamMerge.deleteDialog.deleting') : t('adminTeamMerge.deleteDialog.force')}
          </button>
        ) : (
          <button
            onClick={() => remove(false)}
            disabled={!matches || busy}
            className="flex-1 bg-red-600 text-white py-2 rounded-lg font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? t('adminTeamMerge.deleteDialog.deleting') : t('adminTeamMerge.deleteDialog.confirm')}
          </button>
        )}
      </div>
    </ModalDialog>
  );
};

export default TeamDeleteDialog;
