import React, { useId, useState } from 'react';
import ModalDialog from '../common/ModalDialog';
import { useTranslation } from '../../i18n/I18nContext';
import { Notice, noticeText } from '../../i18n/notice';
import type { MessageKey, Translator } from '../../i18n/translate';
import type { Team } from '../../types';
import { deleteTeamAsAdmin, DeleteReason, SourceChange } from './teamAdminApi';

/**
 * Deleting a team from the super-admin console — typically one of the two
 * teams of a merge, once the merged team has been checked.
 *
 * The team name is typed back (the server checks it too). Each way the
 * deletion could lose something comes back as a named reason with its facts —
 * the source changed since its merge and how, its merge cannot be verified, a
 * merged team was used since, its sources are gone, someone is in one of its
 * sessions or that could not be checked — and a digest of those facts. The
 * admin acknowledges exactly those reasons and the digest goes back with them:
 * anything that changed since is shown again instead of being waved through.
 *
 * A merge source's feedbacks move into its merged team only when there is one
 * merged team the merge signed; the dialog says where they will go, and says
 * so again if the server kept them in the Feedbacks tab after all.
 */

export interface MergeTarget {
  teamId: string;
  name: string;
  verified: boolean;
}

interface Confirmation {
  reasons: DeleteReason[];
  /** The digest of the facts below, sent back with the acknowledgement. */
  confirmation: string;
  changes?: SourceChange[];
  mergedChanges?: SourceChange[];
  mergedInto?: string[];
  sources?: string[];
  sessions?: string[];
}

interface Props {
  team: Team;
  /** Every merged team listing this one as a source. */
  mergedInto: MergeTarget[];
  sessionToken: string;
  onClose: () => void;
  /** What to tell the admin once the team is gone. */
  onDeleted: (notice: Exclude<Notice, null>) => void;
}

const CHANGE_KEYS: Record<string, { changed: MessageKey; added: MessageKey }> = {
  retrospective: { changed: 'adminTeamMerge.change.retrospective', added: 'adminTeamMerge.change.retrospectiveAdded' },
  healthCheck: { changed: 'adminTeamMerge.change.healthCheck', added: 'adminTeamMerge.change.healthCheckAdded' }
};
const LIST_CHANGE_KEYS: Record<string, MessageKey> = {
  backlog: 'adminTeamMerge.change.backlog',
  templates: 'adminTeamMerge.change.templates',
  hcTemplates: 'adminTeamMerge.change.hcTemplates'
};

const describeChange = (change: SourceChange, t: Translator): string => {
  const entryKeys = CHANGE_KEYS[change.kind];
  if (entryKeys) return t(change.added ? entryKeys.added : entryKeys.changed, { name: change.name ?? '' });
  return t(LIST_CHANGE_KEYS[change.kind] ?? 'adminTeamMerge.change.unknown');
};

const TeamDeleteDialog: React.FC<Props> = ({ team, mergedInto, sessionToken, onClose, onDeleted }) => {
  const { t, tRich } = useTranslation();
  const baseId = useId().replace(/:/g, '');
  const titleId = `${baseId}-title`;
  const inputId = `${baseId}-confirm`;
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Notice>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const matches = confirmText.trim() === team.name.trim();
  const signedTargets = mergedInto.filter((target) => target.verified);
  // Feedbacks move only into the one merged team the merge signed.
  const moveTarget = signedTargets.length === 1 ? signedTargets[0] : null;

  const feedbackNote = (() => {
    if (moveTarget) return t('adminTeamMerge.deleteDialog.mergedInto', { name: moveTarget.name });
    if (signedTargets.length > 1) {
      return t('adminTeamMerge.deleteDialog.mergedIntoSeveral', { names: signedTargets.map((target) => target.name).join(', ') });
    }
    if (mergedInto.length > 0) {
      return t('adminTeamMerge.deleteDialog.mergedIntoUnverified', { name: mergedInto.map((target) => target.name).join(', ') });
    }
    return t('adminTeamMerge.deleteDialog.feedbacksKept');
  })();

  const remove = async () => {
    setError(null);
    setBusy(true);
    const result = await deleteTeamAsAdmin(sessionToken, {
      teamId: team.id,
      confirmName: confirmText,
      ...(moveTarget ? { mergedInto: moveTarget.teamId } : {}),
      ...(confirmation ? { acknowledge: confirmation.reasons, confirmation: confirmation.confirmation } : {})
    });
    setBusy(false);
    if (result.status === 'ok') {
      const { data } = result;
      // The server checks the signature again under its lock and keeps the
      // feedbacks in the Feedbacks tab when it does not hold: say so, since the
      // dialog announced a move.
      if (moveTarget && data.mergedInto !== moveTarget.teamId && data.orphanedFeedbacks > 0) {
        onDeleted({ key: 'adminTeamMerge.notice.deletedOrphaned', params: { name: team.name, target: moveTarget.name } });
      } else {
        onDeleted({ key: 'adminTeamMerge.notice.deleted', params: { name: team.name } });
      }
      return;
    }
    const { data } = result;
    if (data.error === 'confirmation_required' && Array.isArray(data.reasons)) {
      // Asked again after an acknowledgement: what the admin confirmed no
      // longer holds. Say so, or the same box simply comes back.
      setError(confirmation ? { key: 'adminTeamMerge.deleteDialog.changedSince' } : null);
      setConfirmation(data as unknown as Confirmation);
      return;
    }
    // Whatever was acknowledged no longer describes the team.
    if (data.error === 'team_changed') setConfirmation(null);
    setError(result.notice);
  };

  const reasonText = (reason: DeleteReason, facts: Confirmation): string => {
    switch (reason) {
      case 'source_changed':
        return t('adminTeamMerge.deleteDialog.changed', {
          name: (facts.mergedInto ?? []).join(', '),
          changes: (facts.changes ?? []).map((change) => describeChange(change, t)).join(', ')
        });
      case 'merge_unverified':
        return t('adminTeamMerge.deleteDialog.mergeUnverified', { name: (facts.mergedInto ?? []).join(', ') });
      case 'merged_team_changed':
        return t('adminTeamMerge.deleteDialog.mergedTeamChanged', {
          changes: (facts.mergedChanges ?? []).map((change) => describeChange(change, t)).join(', ')
        });
      case 'sources_deleted':
        return t('adminTeamMerge.deleteDialog.sourcesDeleted', { names: (facts.sources ?? []).join(', ') });
      case 'sessions_open':
        return t('adminTeamMerge.deleteDialog.inUse', { names: (facts.sessions ?? []).join(', ') });
      default:
        return t('adminTeamMerge.deleteDialog.inUseUnknown');
    }
  };

  return (
    <ModalDialog
      labelledBy={titleId}
      onClose={busy ? undefined : onClose}
      overlayClassName="fixed inset-0 bg-black/50 z-100 flex items-center justify-center p-4"
      panelClassName="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto"
    >
      <div className="text-center mb-4">
        <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-3">
          <span className="material-symbols-outlined text-3xl" aria-hidden="true">warning</span>
        </div>
        <h2 id={titleId} className="text-xl font-bold text-slate-800 mb-2 wrap-anywhere">
          {t('adminTeamMerge.deleteDialog.title', { name: team.name })}
        </h2>
        <p className="text-sm text-slate-600">{t('adminTeamMerge.deleteDialog.warning')}</p>
        <p className="text-sm text-slate-600 mt-2">{feedbackNote}</p>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{noticeText(error, t)}</div>
      )}

      {confirmation && (
        <div role="alert" className="bg-amber-50 border border-amber-200 text-amber-900 p-3 rounded-lg mb-4 text-sm">
          <ul className="list-disc pl-5 space-y-1">
            {confirmation.reasons.map((reason) => <li key={reason}>{reasonText(reason, confirmation)}</li>)}
          </ul>
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
          onChange={(e) => { setConfirmText(e.target.value); setConfirmation(null); }}
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
        <button
          onClick={remove}
          disabled={!matches || busy}
          className="flex-1 bg-red-600 text-white py-2 rounded-lg font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy
            ? t('adminTeamMerge.deleteDialog.deleting')
            : t(confirmation ? 'adminTeamMerge.deleteDialog.acknowledge' : 'adminTeamMerge.deleteDialog.confirm')}
        </button>
      </div>
    </ModalDialog>
  );
};

export default TeamDeleteDialog;
