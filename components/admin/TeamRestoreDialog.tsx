import React, { useEffect, useId, useMemo, useState } from 'react';
import ModalDialog from '../common/ModalDialog';
import { useTranslation } from '../../i18n/I18nContext';
import { Notice, noticeText } from '../../i18n/notice';
import { TEAM_NAME_MAX_LENGTH } from '../../utils/teamNamePolicy.js';
import { listBackupTeams, restoreTeamFromBackup, RestorableTeam } from './teamAdminApi';

/**
 * Restoring **one** team from a stored backup, next to the "Restore" button
 * that rolls back the whole store (`server/routes/superAdminTeamRestoreRoutes.js`).
 *
 * The admin picks the team from the ones the backup holds, each labelled with
 * what became of it since (still there, renamed, deleted). The dialog then says
 * exactly what comes back and what does not, because the two cases differ: a
 * team that exists keeps its name, password, recovery address and feedbacks; a
 * deleted one returns with the password it had, under its old name or — when
 * another team has taken that name since — one the admin types.
 */

interface Props {
  backupId: string;
  /** How the backups table names this backup. */
  backupName: string;
  sessionToken: string;
  onClose: () => void;
  onRestored: (notice: Exclude<Notice, null>) => void;
}

const TeamRestoreDialog: React.FC<Props> = ({ backupId, backupName, sessionToken, onClose, onRestored }) => {
  const { t, locale } = useTranslation();
  const baseId = useId().replace(/:/g, '');
  const titleId = `${baseId}-title`;
  const searchId = `${baseId}-search`;
  const nameId = `${baseId}-name`;
  const nameHintId = `${baseId}-name-hint`;

  const [teams, setTeams] = useState<RestorableTeam[] | null>(null);
  const [error, setError] = useState<Notice>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listBackupTeams(sessionToken, backupId).then((result) => {
      if (cancelled) return;
      if (result.status === 'ok') setTeams(result.data.teams);
      else {
        setTeams([]);
        setError(result.notice);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [backupId, sessionToken]);

  // Read again when the server says the team is no longer what the list
  // showed (deleted, recreated, its name taken): the explanation, the name
  // field and what the next click sends all follow from that status.
  const reloadTeams = async () => {
    const result = await listBackupTeams(sessionToken, backupId);
    if (result.status !== 'ok') return;
    setTeams(result.data.teams);
    const fresh = result.data.teams.find((team) => team.id === selectedId);
    if (fresh) setName(fresh.status === 'deleted' && !fresh.nameTaken ? fresh.name : '');
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    if (!teams) return [];
    if (!needle) return teams;
    return teams.filter((team) =>
      [team.name, team.currentName ?? ''].some((value) => value.toLocaleLowerCase(locale).includes(needle))
    );
  }, [teams, query, locale]);

  const selected = teams?.find((team) => team.id === selectedId) ?? null;
  const deleted = selected?.status === 'deleted';

  const select = (team: RestorableTeam) => {
    setSelectedId(team.id);
    setError(null);
    // A deleted team comes back under its old name unless another team holds
    // it now; then the admin must choose, so the field starts empty.
    setName(team.status === 'deleted' && !team.nameTaken ? team.name : '');
  };

  const statusText = (team: RestorableTeam) => {
    if (team.status === 'present') return t('adminBackups.teamRestore.status.present');
    if (team.status === 'renamed') return t('adminBackups.teamRestore.status.renamed', { name: team.currentName ?? '' });
    return t('adminBackups.teamRestore.status.deleted');
  };

  const statusTone = (team: RestorableTeam) =>
    team.status === 'deleted' ? 'bg-red-100 text-red-800' : team.status === 'renamed' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800';

  const canRestore = !!selected && !busy && (!deleted || name.trim().length > 0);

  const restore = async () => {
    if (!selected) return;
    setError(null);
    setBusy(true);
    const result = await restoreTeamFromBackup(sessionToken, {
      backupId,
      teamId: selected.id,
      // What this dialog explained: the server refuses rather than restore
      // the other case (which brings back other credentials) behind it.
      expected: deleted ? 'deleted' : 'existing',
      ...(deleted ? { name: name.trim() } : {})
    });
    setBusy(false);
    if (result.status === 'ok') {
      const { data } = result;
      // Each partial outcome is said, both together when both happened: a
      // session still showing the old state needs a reload, and a feedback left
      // in two places needs its extra copy deleted.
      const sessionsBehind = data.sessionsNotUpdated.length > 0;
      const feedbacksTwice = data.feedbacksStillOrphaned === true;
      const key = sessionsBehind && feedbacksTwice
        ? 'adminBackups.teamRestore.restoredWithWarnings'
        : sessionsBehind
          ? 'adminBackups.teamRestore.restoredSessionsBehind'
          : feedbacksTwice
            ? 'adminBackups.teamRestore.restoredFeedbacksTwice'
            : 'adminBackups.teamRestore.restored';
      onRestored({ key, params: { name: data.team.name } });
      return;
    }
    setError(result.notice);
    if (result.data.error === 'team_changed' || result.data.error === 'team_name_exists') await reloadTeams();
  };

  return (
    <ModalDialog
      labelledBy={titleId}
      onClose={busy ? undefined : onClose}
      overlayClassName="fixed inset-0 bg-black/50 z-100 flex items-center justify-center p-4"
      panelClassName="bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto"
    >
      <h2 id={titleId} className="text-xl font-bold text-slate-800 mb-1">{t('adminBackups.teamRestore.title')}</h2>
      <p className="text-sm text-slate-600 mb-4 wrap-anywhere">{t('adminBackups.teamRestore.subtitle', { name: backupName })}</p>

      {error && (
        <div role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{noticeText(error, t)}</div>
      )}

      {teams === null ? (
        <p className="text-sm text-slate-600 py-6 text-center" role="status">{t('adminBackups.teamRestore.loading')}</p>
      ) : teams.length === 0 ? (
        !error && <p className="text-sm text-slate-600 py-6 text-center">{t('adminBackups.teamRestore.empty')}</p>
      ) : (
        <>
          <label htmlFor={searchId} className="block text-sm font-bold text-slate-600 mb-1">{t('adminBackups.teamRestore.search')}</label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            className="w-full border border-slate-300 rounded-lg p-2 mb-3 bg-white text-slate-900 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
          <fieldset className="mb-4">
            <legend className="text-sm font-bold text-slate-600 mb-1">{t('adminBackups.teamRestore.listLabel')}</legend>
            <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
              {visible.length === 0 && (
                <p className="text-sm text-slate-600 p-3">{t('adminBackups.teamRestore.noResult')}</p>
              )}
              {visible.map((team, index) => {
                // Named by the team; what became of it and how much it holds
                // are read as the option's description.
                const optionId = `${baseId}-team-${index}`;
                return (
                  <div
                    key={team.id}
                    className={`flex items-start gap-3 p-3 hover:bg-slate-50 ${team.id === selectedId ? 'bg-indigo-50' : ''}`}
                    data-testid={`restore-team-option-${team.id}`}
                  >
                    <input
                      id={optionId}
                      type="radio"
                      name={`${baseId}-team`}
                      value={team.id}
                      checked={team.id === selectedId}
                      onChange={() => select(team)}
                      aria-describedby={`${optionId}-status ${optionId}-counts`}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <label htmlFor={optionId} className="font-bold text-slate-800 wrap-anywhere cursor-pointer">{team.name}</label>
                      <span id={`${optionId}-status`} className={`text-xs font-bold px-2 py-0.5 rounded-sm ${statusTone(team)}`}>
                        {statusText(team)}
                      </span>
                      <span id={`${optionId}-counts`} className="basis-full text-xs text-slate-600">
                        {t('adminBackups.teamRestore.counts', {
                          retrospectives: team.counts.retrospectives,
                          healthChecks: team.counts.healthChecks,
                          actions: team.counts.globalActions,
                          members: team.counts.members
                        })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
        </>
      )}

      {selected && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 text-sm text-amber-900 space-y-2">
          <p>{t(deleted ? 'adminBackups.teamRestore.explainDeleted' : 'adminBackups.teamRestore.explainExisting')}</p>
          {/* Nothing current holds a deleted team's Jira links: an action it
              sent to Jira after the backup comes back unlinked. */}
          {deleted && <p>{t('adminBackups.teamRestore.explainDeletedJira')}</p>}
          <p>{t('adminBackups.teamRestore.explainLive')}</p>
          {deleted && (
            <div>
              <label htmlFor={nameId} className="block font-bold mb-1">{t('adminBackups.teamRestore.nameLabel')}</label>
              <input
                id={nameId}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={TEAM_NAME_MAX_LENGTH}
                autoComplete="off"
                aria-describedby={selected.nameTaken ? nameHintId : undefined}
                className="w-full border border-amber-300 rounded-lg p-2 bg-white text-slate-900 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
              {selected.nameTaken && (
                <p id={nameHintId} className="text-xs mt-1">{t('adminBackups.teamRestore.nameTaken', { name: selected.name })}</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-lg font-bold hover:bg-slate-200 disabled:opacity-50"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={restore}
          disabled={!canRestore}
          className="flex-1 bg-amber-700 text-white py-2 px-3 rounded-lg font-bold hover:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed wrap-anywhere"
        >
          {busy
            ? t('adminBackups.teamRestore.restoring')
            : selected
              ? t('adminBackups.teamRestore.confirm', { name: selected.name })
              : t('adminBackups.teamRestore.pick')}
        </button>
      </div>
    </ModalDialog>
  );
};

export default TeamRestoreDialog;
