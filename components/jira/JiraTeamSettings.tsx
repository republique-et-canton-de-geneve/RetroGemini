import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { JiraStatus, Team } from '../../types';
import { parseEmailInput } from '../../utils/emailAddress.js';
import { jiraService, JiraServiceError } from '../../services/jiraService';
import { useTranslation } from '../../i18n/I18nContext';
import { noticeText, type Notice } from '../../i18n/notice';
import { useJiraStatus } from './useJiraStatus';
import JiraTargetFields from './JiraTargetFields';
import { formatJiraDate } from './jiraAvailability';
import { draftFromTarget, targetFromDraft, type JiraTargetDraft } from './jiraTargetDraft';

interface Props {
  team: Team;
  /**
   * Off: the card shows the state only, with nothing to change. The routes
   * accept any team credential (maintainer decision D1); who sees the controls
   * is the screen's choice.
   */
  isFacilitatorView?: boolean;
  /**
   * Classes for the card's own outer element (the Dashboard's separator), so
   * a card that renders nothing leaves no empty frame behind.
   */
  className?: string;
}

// Which control should take the keyboard after a change removed the one that
// had it: the token field, the Replace button, the Remove button, the
// confirmation of a removal, the card's title (after "Try again" brought the
// card back).
type FocusTarget = 'token' | 'replace' | 'remove' | 'confirmRemove' | 'title';

const codeOf = (err: unknown) => (err instanceof JiraServiceError ? err.code : 'unknown_error');

/**
 * The Jira card of the Dashboard settings (spec §2-§3): the team's one Jira
 * token and where its issues are created.
 *
 * The token is write-only. It is typed into a password field and sent once,
 * on Save — never per keystroke, the lesson of `RecoveryEmailSetting`, whose
 * field once stored whatever was half-typed — then the field is emptied and
 * closed: the server never sends it back, not even in part, so the card shows
 * what the server says about it instead ("Connected to Jira as …, set on …",
 * refused by Jira on …, or to be entered again and why). The email field is
 * for Jira Cloud only (email + API token); a Data Center token goes alone.
 *
 * A working token can be replaced or removed; removing asks first, in place,
 * since nobody in the team can create issues until a new one is saved. The
 * target form appears once the token works, because the issue types it offers
 * are read from Jira with that token.
 *
 * Every refusal is kept as what to say (a Notice) and tied to the field it is
 * about — a failed removal to the confirmation it answers; saved / removed
 * confirmations are said in a status region.
 *
 * A status that cannot be read (an expired session, the network, a rollout
 * outlasting its retries) is said as such, with "Try again": "Jira is not
 * turned on" is kept for a deployment where it really is off, since it sends
 * the facilitator to the administrator.
 *
 * On a deployment where Jira is off the card renders nothing, as the discovery
 * note does: it would advertise a feature that does not exist for this
 * organisation. The one exception is a token still stored for the team (Jira
 * was turned off after it was saved): the card stays, says so, and offers to
 * remove it — and after a removal it stays until it is left, so the
 * confirmation is said and the keyboard is not dropped on the page. Until the
 * status is read the card renders nothing either, as the discovery note stays
 * off until it knows: a "Jira" section shown while reading and then removed
 * would advertise the feature for a moment, every time Settings opens on such
 * a deployment, and make the page jump.
 */
const JiraTeamSettings: React.FC<Props> = ({ team, isFacilitatorView = true, className }) => {
  const { t, locale } = useTranslation();
  const baseId = useId();
  const ids = {
    title: `${baseId}-title`,
    token: `${baseId}-token`,
    tokenHelp: `${baseId}-token-help`,
    tokenError: `${baseId}-token-error`,
    email: `${baseId}-email`,
    emailError: `${baseId}-email-error`,
    removeQuestion: `${baseId}-remove-question`,
    removeError: `${baseId}-remove-error`
  };

  const { status: readStatus, loading, failed, refresh } = useJiraStatus(team.id);
  // The answer of a save stands for the status until the hook reads a newer one.
  const [saved, setSaved] = useState<{ teamId: string; status: JiraStatus } | null>(null);
  useEffect(() => {
    setSaved(null);
  }, [readStatus]);
  const status = saved && saved.teamId === team.id ? saved.status : readStatus;

  const [replacing, setReplacing] = useState(false);
  const [tokenDraft, setTokenDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [tokenError, setTokenError] = useState<Notice>(null);
  const [emailError, setEmailError] = useState<Notice>(null);
  const [tokenNotice, setTokenNotice] = useState<Notice>(null);
  const [savingToken, setSavingToken] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Shown with the confirmation, the only part of the card a failed removal
  // leaves on screen: the token form is closed while the token works.
  const [removeError, setRemoveError] = useState<Notice>(null);

  // The target draft, rebuilt from the stored target when that changes and
  // the facilitator is not editing; `version` remounts the fields, so a
  // rebuilt draft reads its issue types afresh.
  const storedTargetJson = JSON.stringify(status?.target ?? null);
  const hasStatus = !!status;
  const [targetDraft, setTargetDraft] = useState<{ from: string | null; version: number; draft: JiraTargetDraft }>({
    from: null,
    version: 0,
    draft: draftFromTarget(null)
  });
  const [targetDirty, setTargetDirty] = useState(false);
  const [targetError, setTargetError] = useState<Notice>(null);
  const [targetNotice, setTargetNotice] = useState<Notice>(null);
  const [savingTarget, setSavingTarget] = useState(false);

  useEffect(() => {
    if (!hasStatus || targetDirty) return;
    setTargetDraft(prev => (prev.from === storedTargetJson
      ? prev
      : { from: storedTargetJson, version: prev.version + 1, draft: draftFromTarget(JSON.parse(storedTargetJson)) }));
  }, [hasStatus, storedTargetJson, targetDirty]);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const confirmRemoveRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    if (target === 'title') {
      // "Try again": while it reads, the button stays; when the read fails
      // again it is still there, holding the keyboard; when it succeeds the
      // button is gone, and the keyboard goes to the card — unless it has
      // moved on meanwhile.
      if (!status) {
        if (!loading) pendingFocus.current = null;
        return;
      }
      pendingFocus.current = null;
      const active = document.activeElement;
      if (!active || active === document.body) titleRef.current?.focus();
      return;
    }
    const element = { token: tokenRef, replace: replaceRef, remove: removeRef, confirmRemove: confirmRemoveRef }[target].current;
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
  });

  const sectionClass = ['mb-4', className].filter(Boolean).join(' ');
  const title = (
    <h3 ref={titleRef} id={ids.title} tabIndex={-1} className="mb-2 flex items-center font-bold text-slate-700 outline-hidden">
      <span className="material-symbols-outlined mr-2 text-slate-500" aria-hidden="true">integration_instructions</span>
      {t('jira.settings.title')}
    </h3>
  );

  if (!status && failed) {
    return (
      <section aria-labelledby={ids.title} className={sectionClass}>
        {title}
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-slate-700">{t('jira.settings.loadFailed')}</p>
          <button
            type="button"
            onClick={() => {
              if (loading) return;
              pendingFocus.current = 'title';
              void refresh();
            }}
            aria-disabled={loading ? true : undefined}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 aria-disabled:cursor-wait aria-disabled:opacity-70"
          >
            {t('jira.settings.retry')}
          </button>
        </div>
      </section>
    );
  }

  // Not read yet, and no read has failed: see above.
  if (!status) return null;

  const token = status.token;
  const tokenWorks = token.configured && token.usable && !token.reason && !token.refusedAt;
  const showTokenForm = isFacilitatorView && (!tokenWorks || replacing);

  let tokenState: string;
  if (!token.configured) tokenState = t('jira.settings.noToken');
  else if (token.reason === 'address_changed') tokenState = t('jira.settings.addressChanged');
  else if (token.reason === 'unreadable' || !token.usable) tokenState = t('jira.settings.unreadable');
  else if (token.refusedAt) tokenState = t('jira.settings.refused', { date: formatJiraDate(token.refusedAt, locale) });
  else {
    const date = formatJiraDate(token.setAt, locale);
    tokenState = token.connectedAs
      ? t('jira.settings.connected', { name: token.connectedAs, date })
      : t('jira.settings.connectedNoName', { date });
  }

  const saveToken = async () => {
    if (savingToken) return;
    const value = tokenDraft.trim();
    const email = parseEmailInput(emailDraft);
    setTokenNotice(null);
    setTokenError(value ? null : { key: 'jira.settings.tokenRequired' });
    setEmailError(email.ok ? null : { key: 'errors.invalidEmail' });
    if (!value) {
      pendingFocus.current = 'token';
      return;
    }
    if (!email.ok) return;

    setSavingToken(true);
    try {
      const next = await jiraService.saveToken(team.id, value, email.email ?? undefined);
      setSaved({ teamId: team.id, status: next });
      setTokenDraft('');
      setEmailDraft('');
      setReplacing(false);
      setTokenNotice({ key: 'jira.settings.saved' });
      // The form and its button are gone: the keyboard goes to what replaces them.
      pendingFocus.current = next.token.configured && next.token.usable ? 'replace' : 'token';
    } catch (err) {
      const code = codeOf(err);
      if (code === 'invalid_email') setEmailError({ raw: code });
      // Here a 404 is Jira's serverInfo or myself: the server's address does
      // not reach Jira's REST API. No project or issue is involved, as the
      // shared sentence for the code says, and the team cannot fix it.
      else if (code === 'jira_not_found') setTokenError({ key: 'jira.settings.notFound' });
      else setTokenError({ raw: code });
    } finally {
      setSavingToken(false);
    }
  };

  const removeToken = async () => {
    if (removing) return;
    setRemoving(true);
    setTokenNotice(null);
    setRemoveError(null);
    try {
      const next = await jiraService.removeToken(team.id);
      setSaved({ teamId: team.id, status: next });
      setConfirmingRemove(false);
      setReplacing(false);
      setTokenNotice({ key: 'jira.settings.removed' });
      // With Jira on, the field a new token is typed in; off, there is none.
      pendingFocus.current = next.enabled ? 'token' : 'title';
    } catch (err) {
      // The confirmation stays, with the keyboard on it: said there.
      setRemoveError({ raw: codeOf(err) });
    } finally {
      setRemoving(false);
    }
  };

  const saveTarget = async (clear: boolean) => {
    if (savingTarget) return;
    setTargetNotice(null);
    let target = null;
    if (!clear) {
      const built = targetFromDraft(targetDraft.draft);
      if ('error' in built) {
        setTargetError({ raw: built.error });
        return;
      }
      target = built.target;
    }
    setTargetError(null);
    setSavingTarget(true);
    try {
      const next = await jiraService.saveTarget(team.id, target);
      setSaved({ teamId: team.id, status: next });
      const nextJson = JSON.stringify(next.target ?? null);
      // A save keeps the form as typed; a clear empties it.
      setTargetDraft(prev => (clear
        ? { from: nextJson, version: prev.version + 1, draft: draftFromTarget(null) }
        : { ...prev, from: nextJson }));
      setTargetDirty(false);
      setTargetNotice({ key: clear ? 'jira.target.cleared' : 'jira.target.saved' });
    } catch (err) {
      setTargetError({ raw: codeOf(err) });
    } finally {
      setSavingTarget(false);
    }
  };

  const primaryButton = 'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 aria-disabled:cursor-wait aria-disabled:opacity-70';
  const secondaryButton = 'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 aria-disabled:cursor-wait aria-disabled:opacity-70';
  const inputClass = 'w-full rounded-lg border border-slate-300 p-2 text-sm aria-invalid:border-red-500';

  const removeControls = isFacilitatorView && token.configured && !replacing && (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {confirmingRemove ? (
        <>
          <p id={ids.removeQuestion} className="basis-full text-sm text-slate-700">{t('jira.settings.removeConfirm')}</p>
          {removeError && (
            <p id={ids.removeError} role="alert" className="basis-full text-xs text-red-700">{noticeText(removeError, t)}</p>
          )}
          <button
            ref={confirmRemoveRef}
            type="button"
            onClick={() => { void removeToken(); }}
            aria-disabled={removing ? true : undefined}
            aria-describedby={removeError ? `${ids.removeQuestion} ${ids.removeError}` : ids.removeQuestion}
            className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 aria-disabled:cursor-wait aria-disabled:opacity-70"
          >
            {t('jira.settings.remove')}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmingRemove(false);
              setRemoveError(null);
              pendingFocus.current = 'remove';
            }}
            className={secondaryButton}
          >
            {t('jira.settings.cancel')}
          </button>
        </>
      ) : (
        <>
          {/* Replacing checks the new token with Jira, which needs Jira on. */}
          {tokenWorks && status.enabled && (
            <button
              ref={replaceRef}
              type="button"
              onClick={() => {
                setReplacing(true);
                setTokenNotice(null);
                pendingFocus.current = 'token';
              }}
              className={secondaryButton}
            >
              {t('jira.settings.replace')}
            </button>
          )}
          <button
            ref={removeRef}
            type="button"
            onClick={() => {
              setConfirmingRemove(true);
              setTokenNotice(null);
              pendingFocus.current = 'confirmRemove';
            }}
            className={secondaryButton}
          >
            {t('jira.settings.remove')}
          </button>
        </>
      )}
    </div>
  );
  const tokenStatus = <p role="status" className="mt-2 text-xs text-green-700">{tokenNotice ? noticeText(tokenNotice, t) : ''}</p>;

  if (!status.enabled) {
    if (!token.configured && !tokenNotice) return null;
    return (
      <section aria-labelledby={ids.title} className={sectionClass}>
        {title}
        <p className="text-sm text-slate-600">{t('jira.settings.disabled')}</p>
        {token.configured && <p className="mt-2 text-sm font-medium text-slate-800">{t('jira.settings.disabledTokenStored')}</p>}
        {removeControls}
        {tokenStatus}
      </section>
    );
  }

  return (
    <section aria-labelledby={ids.title} className={sectionClass}>
      {title}
      <p className="mb-3 text-sm text-slate-600">{t('jira.settings.description')}</p>

      <p className="text-sm font-medium text-slate-800">{tokenState}</p>
      {tokenWorks && token.deploymentType && (
        <p className="text-xs text-slate-600">{t(token.deploymentType === 'Cloud' ? 'jira.settings.deployment.Cloud' : 'jira.settings.deployment.Server')}</p>
      )}

      {showTokenForm && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.token} className="text-sm font-medium text-slate-700">{t('jira.settings.tokenLabel')}</label>
            <input
              ref={tokenRef}
              id={ids.token}
              type="password"
              value={tokenDraft}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={tokenError ? true : undefined}
              aria-describedby={tokenError ? `${ids.tokenError} ${ids.tokenHelp}` : ids.tokenHelp}
              onChange={(e) => {
                setTokenDraft(e.target.value);
                setTokenError(null);
                setTokenNotice(null);
              }}
              className={inputClass}
            />
            {tokenError && <p id={ids.tokenError} role="alert" className="text-xs text-red-700">{noticeText(tokenError, t)}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.email} className="text-sm font-medium text-slate-700">{t('jira.settings.emailLabel')}</label>
            <input
              id={ids.email}
              type="email"
              value={emailDraft}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? `${ids.emailError} ${ids.tokenHelp}` : ids.tokenHelp}
              onChange={(e) => {
                setEmailDraft(e.target.value);
                setEmailError(null);
              }}
              className={inputClass}
            />
            {emailError && <p id={ids.emailError} role="alert" className="text-xs text-red-700">{noticeText(emailError, t)}</p>}
          </div>
          <div id={ids.tokenHelp} className="flex flex-col gap-1 text-xs text-slate-600">
            <p>{t('jira.settings.tokenHelp')}</p>
            <p>{t('jira.settings.writeOnly')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { void saveToken(); }}
              aria-disabled={savingToken ? true : undefined}
              className={primaryButton}
            >
              {savingToken ? t('jira.settings.saving') : t('jira.settings.save')}
            </button>
            {replacing && (
              <button
                type="button"
                onClick={() => {
                  setReplacing(false);
                  setTokenDraft('');
                  setEmailDraft('');
                  setTokenError(null);
                  setEmailError(null);
                  pendingFocus.current = 'replace';
                }}
                className={secondaryButton}
              >
                {t('jira.settings.cancel')}
              </button>
            )}
          </div>
        </div>
      )}

      {removeControls}
      {tokenStatus}

      {isFacilitatorView && tokenWorks && (
        <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4">
          <h4 className="text-sm font-semibold text-slate-700">{t('jira.target.title')}</h4>
          {!status.target && <p className="text-sm text-slate-600">{t('jira.target.none')}</p>}
          {targetDraft.from !== null && (
            <JiraTargetFields
              key={targetDraft.version}
              teamId={team.id}
              value={targetDraft.draft}
              onChange={(draft) => {
                setTargetDraft(prev => ({ ...prev, draft }));
                setTargetDirty(true);
                setTargetError(null);
                setTargetNotice(null);
              }}
              idPrefix={`${baseId}-target`}
            />
          )}
          {targetError && <p role="alert" className="text-xs text-red-700">{noticeText(targetError, t)}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { void saveTarget(false); }}
              aria-disabled={savingTarget ? true : undefined}
              className={primaryButton}
            >
              {t('jira.target.save')}
            </button>
            {status.target && (
              <button
                type="button"
                onClick={() => { void saveTarget(true); }}
                aria-disabled={savingTarget ? true : undefined}
                className={secondaryButton}
              >
                {t('jira.target.clear')}
              </button>
            )}
          </div>
          <p role="status" className="text-xs text-green-700">{targetNotice ? noticeText(targetNotice, t) : ''}</p>
        </div>
      )}
    </section>
  );
};

export default JiraTeamSettings;
