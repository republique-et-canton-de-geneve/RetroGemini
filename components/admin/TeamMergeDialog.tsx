import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import ModalDialog from '../common/ModalDialog';
import { useTranslation } from '../../i18n/I18nContext';
import { Notice, noticeText } from '../../i18n/notice';
import type { MessageKey } from '../../i18n/translate';
import type { Team } from '../../types';
import { PASSWORD_MIN_LENGTH, isPasswordLongEnough } from '../../utils/passwordPolicy.js';
import { parseEmailInput } from '../../utils/emailAddress.js';
import { TEAM_NAME_MAX_LENGTH } from '../../utils/teamNamePolicy.js';
import {
  MergeCounts,
  MergePreview,
  PasswordSource,
  mergeTeams,
  previewTeamMerge
} from './teamAdminApi';

/**
 * Merging two teams into a new one, from the super-admin Teams tab.
 *
 * Two steps, because the merge is only safe to confirm once the admin has seen
 * what it will do: first the two teams, then the server's own plan — the very
 * one the merge will run (`server/services/teamMerge.js`) — with the new team's
 * name, password and recovery email. The two teams are never changed; the
 * dialog says so, and says what to do next.
 */

const COUNT_ROWS: { field: keyof MergeCounts; key: MessageKey }[] = [
  { field: 'members', key: 'adminTeamMerge.row.members' },
  { field: 'archivedMembers', key: 'adminTeamMerge.row.archivedMembers' },
  { field: 'retrospectives', key: 'adminTeamMerge.row.retrospectives' },
  { field: 'healthChecks', key: 'adminTeamMerge.row.healthChecks' },
  { field: 'globalActions', key: 'adminTeamMerge.row.globalActions' },
  { field: 'customTemplates', key: 'adminTeamMerge.row.customTemplates' },
  { field: 'customHealthCheckTemplates', key: 'adminTeamMerge.row.customHealthCheckTemplates' },
  { field: 'feedbacks', key: 'adminTeamMerge.row.feedbacks' }
];


type EmailChoice = 'primary' | 'secondary' | 'other' | 'none';

interface Props {
  teams: Team[];
  sessionToken: string;
  onClose: () => void;
  onMerged: (name: string) => void;
}

const inputClass = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900';
const sectionTitleClass = 'text-sm font-bold text-slate-700 mb-2';

// Codes the server reports, mapped rather than spliced into a key: a code from
// a newer pod during a rolling update reads as a sentence, never as a raw key.
const UNIFIED_REASON_KEYS: Record<string, MessageKey> = {
  facilitator: 'adminTeamMerge.reason.facilitator',
  email: 'adminTeamMerge.reason.email',
  name: 'adminTeamMerge.reason.name'
};
const KEPT_APART_KEYS: Record<string, MessageKey> = {
  ambiguous: 'adminTeamMerge.keptApart.ambiguous',
  email_conflict: 'adminTeamMerge.keptApart.email_conflict',
  already_unified: 'adminTeamMerge.keptApart.already_unified'
};

const TeamMergeDialog: React.FC<Props> = ({ teams, sessionToken, onClose, onMerged }) => {
  const { t } = useTranslation();
  const baseId = useId().replace(/:/g, '');
  const ids = {
    title: `${baseId}-title`,
    primary: `${baseId}-primary`,
    secondary: `${baseId}-secondary`,
    name: `${baseId}-name`,
    nameHint: `${baseId}-name-hint`,
    primaryHint: `${baseId}-primary-hint`,
    passwordHint: `${baseId}-password-hint`,
    newPassword: `${baseId}-new-password`,
    otherEmail: `${baseId}-other-email`
  };

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [teams]
  );
  const [primaryId, setPrimaryId] = useState('');
  const [secondaryId, setSecondaryId] = useState('');
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [name, setName] = useState('');
  const [passwordSource, setPasswordSource] = useState<PasswordSource>('primary');
  const [newPassword, setNewPassword] = useState('');
  const [emailChoice, setEmailChoice] = useState<EmailChoice>('none');
  const [otherEmail, setOtherEmail] = useState('');
  const [busy, setBusy] = useState<'preview' | 'merge' | null>(null);
  const [error, setError] = useState<Notice>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null);
  const primarySelectRef = useRef<HTMLSelectElement>(null);
  const previewShown = preview !== null;
  const shownStep = useRef(previewShown);

  // The panel scrolls, and the buttons that report a refusal sit at its
  // bottom: an error shown at the top would otherwise be off screen.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [error]);

  // Changing step unmounts the button that had focus. Focus goes to the new
  // step's start instead of falling to the page, so a screen reader hears
  // where it now is.
  useEffect(() => {
    if (shownStep.current === previewShown) return;
    shownStep.current = previewShown;
    if (previewShown) summaryHeadingRef.current?.focus();
    else primarySelectRef.current?.focus();
  }, [previewShown]);

  const teamName = (id: string) => teams.find((team) => team.id === id)?.name ?? '';

  /**
   * `keepSettings` refreshes the plan after the server refused a stale one,
   * without throwing away the name and choices the admin already made.
   */
  const loadPreview = async ({ keepSettings = false } = {}) => {
    if (!keepSettings) setError(null);
    if (!primaryId || !secondaryId || primaryId === secondaryId) {
      setError({ key: 'adminTeamMerge.error.sameTeam' });
      return;
    }
    setBusy('preview');
    const result = await previewTeamMerge(sessionToken, primaryId, secondaryId);
    setBusy(null);
    if (result.status === 'failed') {
      setError(result.notice);
      return;
    }
    setPreview(result.data);
    if (keepSettings) return;
    const { defaults } = result.data;
    setName(defaults.name);
    setPasswordSource(
      defaults.passwordSources.primary ? 'primary' : defaults.passwordSources.secondary ? 'secondary' : 'new'
    );
    setEmailChoice(defaults.emails.primary ? 'primary' : defaults.emails.secondary ? 'secondary' : 'none');
  };

  const submit = async () => {
    if (!preview) return;
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError({ key: 'errors.teamNameEmpty' });
      return;
    }
    if (trimmed.length > TEAM_NAME_MAX_LENGTH) {
      setError({ key: 'adminTeamMerge.error.nameTooLong', params: { max: TEAM_NAME_MAX_LENGTH } });
      return;
    }
    if (passwordSource === 'new' && !isPasswordLongEnough(newPassword)) {
      setError({ key: 'errors.passwordTooShort', params: { min: PASSWORD_MIN_LENGTH } });
      return;
    }
    const { emails } = preview.defaults;
    const facilitatorEmail =
      emailChoice === 'primary' ? emails.primary ?? '' :
        emailChoice === 'secondary' ? emails.secondary ?? '' :
          emailChoice === 'other' ? otherEmail : '';
    if (emailChoice === 'other') {
      const parsed = parseEmailInput(otherEmail);
      if (!parsed.ok || !parsed.email) {
        setError({ key: 'adminTeamMerge.error.invalidEmail' });
        return;
      }
    }

    setBusy('merge');
    const result = await mergeTeams(sessionToken, {
      primaryTeamId: primaryId,
      secondaryTeamId: secondaryId,
      name: trimmed,
      passwordSource,
      ...(passwordSource === 'new' ? { newPassword } : {}),
      facilitatorEmail,
      expectedFingerprints: preview.fingerprints
    });
    setBusy(null);
    if (result.status === 'failed') {
      if (result.data.error === 'sources_changed_since_preview') await loadPreview({ keepSettings: true });
      setError(result.notice);
      return;
    }
    onMerged(result.data.team.name);
  };

  const warnings = useMemo(() => {
    if (!preview) return [];
    const { report, liveSessions } = preview;
    const list: string[] = [];
    const names = (entries: { name: string }[]) => entries.map((entry) => entry.name).join(', ');
    if (liveSessions === null) list.push(t('adminTeamMerge.warning.liveUnknown'));
    else if (liveSessions.length > 0) list.push(t('adminTeamMerge.warning.live', { names: names(liveSessions) }));
    if (report.sessions.inProgress.length > 0) {
      list.push(t('adminTeamMerge.warning.inProgress', { names: names(report.sessions.inProgress) }));
    }
    if (report.sessions.freshened.length > 0) {
      list.push(t('adminTeamMerge.warning.freshened', { names: names(report.sessions.freshened) }));
    }
    if (report.templates.renamed.length > 0) {
      list.push(t('adminTeamMerge.warning.renamedTemplates', {
        names: report.templates.renamed.map((entry) => entry.to).join(', ')
      }));
    }
    if (!report.settings.actionImpactRatingEnabled) list.push(t('adminTeamMerge.warning.ratingOff'));
    if (report.members.reminted.length > 0 || report.actions.reminted > 0 || report.templates.reminted > 0) {
      list.push(t('adminTeamMerge.warning.reminted'));
    }
    if (report.conflicts.length > 0) list.push(t('adminTeamMerge.warning.conflicts'));
    // One line per address: a list joined with "; " in code would miss the
    // French no-break space before the semicolon.
    for (const entry of report.members.sharedEmails ?? []) {
      list.push(t('adminTeamMerge.warning.sharedEmail', { email: entry.email, names: entry.names.join(', ') }));
    }
    if (report.members.malformed > 0) {
      list.push(t('adminTeamMerge.warning.malformed', { count: report.members.malformed }));
    }
    if ((report.sessions.ambiguousRetroIds ?? []).length > 0) list.push(t('adminTeamMerge.warning.ambiguousRetros'));
    if ((report.unknownKeys?.conflicting ?? []).length > 0) {
      list.push(t('adminTeamMerge.warning.unknownConflict', { keys: report.unknownKeys.conflicting.join(', ') }));
    }
    return list;
  }, [preview, t]);

  const emails = preview?.defaults.emails;
  const sameEmail = Boolean(emails?.primary && emails.primary === emails.secondary);

  const radio = (
    groupName: string,
    value: string,
    checked: boolean,
    onChange: () => void,
    label: React.ReactNode,
    disabled = false
  ) => (
    <label className={`flex items-start gap-2 text-sm ${disabled ? 'text-slate-500' : 'text-slate-700'}`}>
      <input
        type="radio"
        name={groupName}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5 accent-indigo-600"
      />
      <span className="wrap-anywhere">{label}</span>
    </label>
  );

  return (
    <ModalDialog
      labelledBy={ids.title}
      onClose={busy ? undefined : onClose}
      closeOnBackdropClick={false}
      overlayClassName="fixed inset-0 bg-black/50 z-100 flex items-center justify-center p-4"
      panelClassName="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6"
    >
      <h2 id={ids.title} className="text-xl font-bold text-slate-800 mb-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-indigo-600" aria-hidden="true">merge</span>
        {t('adminTeamMerge.title')}
      </h2>
      <p className="text-sm text-slate-600 mb-4">{t('adminTeamMerge.intro')}</p>

      {error && (
        <div ref={errorRef} role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">
          {noticeText(error, t)}
        </div>
      )}

      {!preview ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 mb-4">
            <div>
              <label htmlFor={ids.primary} className={sectionTitleClass + ' block'}>{t('adminTeamMerge.primary')}</label>
              <select
                id={ids.primary}
                ref={primarySelectRef}
                aria-describedby={ids.primaryHint}
                value={primaryId}
                onChange={(e) => {
                  setPrimaryId(e.target.value);
                  if (e.target.value === secondaryId) setSecondaryId('');
                }}
                className={inputClass}
              >
                <option value="">{t('adminTeamMerge.choose')}</option>
                {sortedTeams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
              <p id={ids.primaryHint} className="text-xs text-slate-500 mt-1">{t('adminTeamMerge.primaryHint')}</p>
            </div>
            <div>
              <label htmlFor={ids.secondary} className={sectionTitleClass + ' block'}>{t('adminTeamMerge.secondary')}</label>
              <select
                id={ids.secondary}
                value={secondaryId}
                onChange={(e) => setSecondaryId(e.target.value)}
                className={inputClass}
              >
                <option value="">{t('adminTeamMerge.choose')}</option>
                {sortedTeams.filter((team) => team.id !== primaryId).map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={onClose}
              className="bg-slate-100 text-slate-700 px-4 py-2 rounded-lg font-bold hover:bg-slate-200"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => loadPreview()}
              disabled={!primaryId || !secondaryId || busy !== null}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy === 'preview' ? t('adminTeamMerge.loading') : t('adminTeamMerge.continue')}
            </button>
          </div>
        </>
      ) : (
        <>
          <section className="mb-5">
            <h3 ref={summaryHeadingRef} tabIndex={-1} className={sectionTitleClass + ' outline-hidden'}>{t('adminTeamMerge.summary')}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-slate-200 rounded-lg" data-testid="team-merge-summary">
                <thead className="bg-slate-50">
                  <tr>
                    <th scope="col" className="text-left p-2 font-bold text-slate-700">{t('adminTeamMerge.column.item')}</th>
                    {preview.report.sources.map((source) => (
                      <th key={source.id} scope="col" className="text-right p-2 font-bold text-slate-700 wrap-anywhere">{source.name}</th>
                    ))}
                    <th scope="col" className="text-right p-2 font-bold text-indigo-700">{t('adminTeamMerge.column.merged')}</th>
                  </tr>
                </thead>
                <tbody>
                  {COUNT_ROWS.map(({ field, key }) => (
                    <tr key={field} className="border-t border-slate-100">
                      <th scope="row" className="text-left p-2 font-normal text-slate-700">{t(key)}</th>
                      {preview.report.sources.map((source) => (
                        <td key={source.id} className="text-right p-2 text-slate-700 tabular-nums">{source.counts[field]}</td>
                      ))}
                      <td className="text-right p-2 font-bold text-slate-800 tabular-nums">
                        {field === 'feedbacks'
                          ? <span className="font-normal text-xs text-slate-600">{t('adminTeamMerge.feedbacksMoveLater')}</span>
                          : preview.report.merged[field]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-5">
            <h3 className={sectionTitleClass}>{t('adminTeamMerge.unifiedTitle')}</h3>
            {preview.report.members.unified.length === 0 ? (
              <p className="text-sm text-slate-600">{t('adminTeamMerge.unifiedNone')}</p>
            ) : (
              <ul className="text-sm text-slate-700 list-disc pl-5 space-y-1">
                {preview.report.members.unified.map((entry) => (
                  <li key={entry.fromId}>
                    {t('adminTeamMerge.unified', {
                      from: entry.fromName,
                      team: teamName(secondaryId),
                      into: entry.intoName
                    })}{' '}
                    <span className="text-slate-500">({t(UNIFIED_REASON_KEYS[entry.reason] ?? 'adminTeamMerge.reason.unknown')})</span>
                  </li>
                ))}
              </ul>
            )}
            {preview.report.members.keptSameName.length > 0 && (
              <>
                <h4 className="text-sm font-bold text-slate-700 mt-3 mb-1">{t('adminTeamMerge.keptApartTitle')}</h4>
                <ul className="text-sm text-slate-700 list-disc pl-5 space-y-1">
                  {preview.report.members.keptSameName.map((entry) => (
                    <li key={entry.secondaryId}>
                      {t(KEPT_APART_KEYS[entry.reason] ?? 'adminTeamMerge.keptApart.unknown', { name: entry.name })}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {warnings.length > 0 && (
            <section className="mb-5 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <h3 className="text-sm font-bold text-amber-800 mb-1">{t('adminTeamMerge.warningsTitle')}</h3>
              <ul className="text-sm text-amber-900 list-disc pl-5 space-y-1">
                {warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </section>
          )}

          <section className="mb-5">
            <h3 className={sectionTitleClass}>{t('adminTeamMerge.settingsTitle')}</h3>
            <label htmlFor={ids.name} className="block text-sm text-slate-700 mb-1">{t('adminTeamMerge.name')}</label>
            <input
              id={ids.name}
              type="text"
              value={name}
              maxLength={TEAM_NAME_MAX_LENGTH}
              onChange={(e) => setName(e.target.value)}
              aria-describedby={ids.nameHint}
              className={inputClass}
            />
            <p id={ids.nameHint} className="text-xs text-slate-500 mt-1 mb-4">{t('adminTeamMerge.nameHint')}</p>

            <fieldset className="mb-4" aria-describedby={ids.passwordHint}>
              <legend className="text-sm text-slate-700 mb-1">{t('adminTeamMerge.password')}</legend>
              <p id={ids.passwordHint} className="text-xs text-slate-500 mb-1">{t('adminTeamMerge.password.independent')}</p>
              <div className="space-y-1">
                {preview.report.sources.map((source) => {
                  const available = preview.defaults.passwordSources[source.role];
                  return (
                    <React.Fragment key={source.role}>
                      {radio(
                        `${baseId}-password`,
                        source.role,
                        passwordSource === source.role,
                        () => setPasswordSource(source.role),
                        <>
                          {t('adminTeamMerge.password.keep', { name: source.name })}
                          {!available && <> {t('adminTeamMerge.password.unavailable')}</>}
                        </>,
                        !available
                      )}
                    </React.Fragment>
                  );
                })}
                {radio(`${baseId}-password`, 'new', passwordSource === 'new', () => setPasswordSource('new'), t('adminTeamMerge.password.new'))}
              </div>
              {passwordSource === 'new' && (
                <div className="mt-2 pl-6">
                  <label htmlFor={ids.newPassword} className="block text-xs text-slate-600 mb-1">{t('adminTeamMerge.password.newLabel')}</label>
                  <input
                    id={ids.newPassword}
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t('adminTeamMerge.password.newPlaceholder', { min: PASSWORD_MIN_LENGTH })}
                    className={inputClass}
                  />
                </div>
              )}
            </fieldset>

            <fieldset>
              <legend className="text-sm text-slate-700 mb-1">{t('adminTeamMerge.email')}</legend>
              <div className="space-y-1">
                {emails?.primary && radio(`${baseId}-email`, 'primary', emailChoice === 'primary', () => setEmailChoice('primary'), emails.primary)}
                {emails?.secondary && !sameEmail && radio(`${baseId}-email`, 'secondary', emailChoice === 'secondary', () => setEmailChoice('secondary'), emails.secondary)}
                {radio(`${baseId}-email`, 'other', emailChoice === 'other', () => setEmailChoice('other'), t('adminTeamMerge.email.other'))}
                {radio(`${baseId}-email`, 'none', emailChoice === 'none', () => setEmailChoice('none'), t('adminTeamMerge.email.none'))}
              </div>
              {emailChoice === 'other' && (
                <div className="mt-2 pl-6">
                  <label htmlFor={ids.otherEmail} className="block text-xs text-slate-600 mb-1">{t('adminTeamMerge.email.otherLabel')}</label>
                  <input
                    id={ids.otherEmail}
                    type="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={otherEmail}
                    onChange={(e) => setOtherEmail(e.target.value)}
                    placeholder={t('adminTeamMerge.email.otherPlaceholder')}
                    className={inputClass}
                  />
                </div>
              )}
            </fieldset>
          </section>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={() => { setPreview(null); setError(null); }}
              disabled={busy !== null}
              className="bg-slate-100 text-slate-700 px-4 py-2 rounded-lg font-bold hover:bg-slate-200 disabled:opacity-50"
            >
              {t('adminTeamMerge.back')}
            </button>
            <button
              onClick={submit}
              disabled={busy !== null}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy === 'merge' ? t('adminTeamMerge.creating') : t('adminTeamMerge.create')}
            </button>
          </div>
        </>
      )}
    </ModalDialog>
  );
};

export default TeamMergeDialog;
