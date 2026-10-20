import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { parseJiraBaseUrl } from '../../utils/jira.js';
import { useTranslation } from '../../i18n/I18nContext';
import { noticeText, type Notice } from '../../i18n/notice';
import { translateErrorMessage } from '../../i18n/errorMessages';
import type { MessageKey, Translator } from '../../i18n/translate';

// The test is an anonymous `serverInfo` against the address in the field, so
// these codes say something about that address. Their shared sentences
// (`i18n/errorMessages.ts`) are written for a team's token, project or issue,
// none of which the test involves.
const TEST_ERROR_KEYS: Record<string, MessageKey> = {
  jira_not_found: 'admin.jira.testNotFound',
  jira_auth_failed: 'admin.jira.testAuthRequired',
  jira_forbidden: 'admin.jira.testForbidden'
};

const testErrorText = (code: string, t: Translator): string => {
  const key = Object.prototype.hasOwnProperty.call(TEST_ERROR_KEYS, code) ? TEST_ERROR_KEYS[code] : null;
  return key ? t(key) : translateErrorMessage(code, t);
};

interface Props {
  /** The console's credential, sent in the body as every super-admin route expects. */
  sessionToken: string;
}

interface JiraSettings {
  enabled: boolean;
  baseUrl: string | null;
  allowSelfSignedCerts: boolean;
}

// `/api/super-admin/test-jira` answers 200 either way (contracts §3).
type TestAnswer =
  | { ok: true; version: string; deploymentType: string | null }
  | { ok: false; error: string; status?: number; location?: string; messages?: string[] };

// Whether the stored settings are in. Until they are, the form holds its
// defaults, not the deployment's settings.
type LoadState = 'loading' | 'loaded' | 'failed';

// What the card's one status region says: kept as data, translated when shown,
// so the language switcher never leaves a sentence in the old language.
type CardMessage =
  | { kind: 'saved' }
  | { kind: 'error'; notice: Exclude<Notice, null> }
  | { kind: 'test'; answer: TestAnswer };

const readSettings = (data: unknown): JiraSettings | null => {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  return {
    enabled: value.enabled === true,
    baseUrl: typeof value.baseUrl === 'string' && value.baseUrl ? value.baseUrl : null,
    allowSelfSignedCerts: value.allowSelfSignedCerts === true
  };
};

const readTestAnswer = (data: unknown): TestAnswer => {
  const value = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (value.ok === true) {
    return {
      ok: true,
      version: typeof value.version === 'string' ? value.version : '',
      deploymentType: typeof value.deploymentType === 'string' ? value.deploymentType : null
    };
  }
  return {
    ok: false,
    error: typeof value.error === 'string' && value.error ? value.error : 'unknown_error',
    status: typeof value.status === 'number' ? value.status : undefined,
    location: typeof value.location === 'string' && value.location ? value.location : undefined,
    messages: Array.isArray(value.messages) ? value.messages.filter((m): m is string => typeof m === 'string') : undefined
  };
};

// What a refused super-admin call says, as the console's other cards say it.
const refusalOf = async (response: Response): Promise<{ notice: Exclude<Notice, null> | null; code: string | null }> => {
  if (response.status === 401) return { notice: { key: 'admin.notice.sessionExpired' }, code: null };
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (response.status === 429) {
    return {
      notice: data?.retryAfter
        ? { key: 'login.superAdmin.tooManyAttemptsRetryIn', params: { retryAfter: String(data.retryAfter) } }
        : { key: 'login.superAdmin.tooManyAttemptsLater' },
      code: null
    };
  }
  return { notice: null, code: typeof data?.error === 'string' ? data.error : null };
};

const INVALID_BASE_URL = 'invalid_jira_base_url';

/**
 * The console's Jira card (spec §1): the deployment's one Jira, beside the AI
 * settings. Teams enter their own token in their settings; nothing here is a
 * secret.
 *
 *  - The address is checked with the shared rule (`parseJiraBaseUrl`: https,
 *    or http on loopback only; no user name, query or fragment) before it is
 *    sent, and saved in its canonical spelling, which the card then shows.
 *  - Changing a saved address makes every team enter its token again: a
 *    token is sealed to the address it was checked against and never sent
 *    anywhere else. So the card says so beside the field as soon as the
 *    address differs from the saved one — another spelling of the same
 *    address does not count — and asks before saving it (finding U-7).
 *  - "Allow self-signed certificates" turns off the certificate check for
 *    every team's token, so its description warns and names the safer
 *    `NODE_EXTRA_CA_CERTS` (finding S-2).
 *  - Test calls Jira with the address in the field, without a token and
 *    without saving, and shows what answered: the version and whether it is
 *    Cloud, or the failure, Jira's HTTP status, a redirect's destination and
 *    Jira's own message. When the test route itself fails, the card says the
 *    server could not run the test, and names no status: it would be the
 *    deployment's, and send the administrator to debug Jira instead.
 *
 * Results and confirmations are said in one status region, mounted with the
 * card; an address the rule refuses is said beside the field.
 *
 * Save waits for the stored settings. Until they are read the form holds its
 * defaults — Jira off, no address — and saving those would turn Jira off and
 * void every team's token without the confirmation an address change asks
 * for, since no address is known to have changed. So a read that fails (a
 * server error, a pod without the route during a rollout, the network) is
 * said in the status region, which keeps it beside later test results, with
 * "Try again", and Save stays unavailable, described by that line (plan v2,
 * failure modes: "console error, nothing erased").
 */
const JiraSettingsCard: React.FC<Props> = ({ sessionToken }) => {
  const { t } = useTranslation();
  const baseId = useId();
  const ids = {
    title: `${baseId}-title`,
    baseUrl: `${baseId}-base-url`,
    hint: `${baseId}-hint`,
    warning: `${baseId}-warning`,
    error: `${baseId}-error`,
    selfSignedTitle: `${baseId}-self-signed-title`,
    selfSignedDescription: `${baseId}-self-signed-description`,
    testHint: `${baseId}-test-hint`,
    loadError: `${baseId}-load-error`
  };
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [savedBaseUrl, setSavedBaseUrl] = useState<string | null>(null);
  const [allowSelfSigned, setAllowSelfSigned] = useState(false);
  const [fieldError, setFieldError] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<CardMessage | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<Notice>(null);
  // Bumped by "Try again", which reads the settings once more.
  const [loadAttempt, setLoadAttempt] = useState(0);
  // Set by the first edit: settings that arrive after it must not overwrite
  // what the admin has started to change.
  const edited = useRef(false);
  const baseUrlRef = useRef<HTMLInputElement>(null);
  // Set by "Try again": the button goes once the settings are in.
  const focusAfterLoad = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const fail = (notice: Notice) => {
      if (cancelled) return;
      setLoadError(notice);
      setLoadState('failed');
    };
    const load = async () => {
      try {
        const response = await fetch('/api/super-admin/jira-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionToken })
        });
        if (cancelled) return;
        if (!response.ok) {
          // An expired console session or the limiter say so; anything else
          // (a 500, an older pod's HTML 404) is "could not be read".
          const { notice } = await refusalOf(response);
          fail(notice ?? { key: 'admin.jira.loadFailed' });
          return;
        }
        const settings = readSettings(await response.json());
        if (cancelled) return;
        if (!settings) {
          fail({ key: 'admin.jira.loadFailed' });
          return;
        }
        setSavedBaseUrl(settings.baseUrl);
        setLoadError(null);
        setLoadState('loaded');
        if (edited.current) return;
        setEnabled(settings.enabled);
        setBaseUrl(settings.baseUrl ?? '');
        setAllowSelfSigned(settings.allowSelfSignedCerts);
      } catch (err) {
        console.error('Failed to load the Jira settings', err);
        fail({ key: 'admin.jira.loadFailed' });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [sessionToken, loadAttempt]);

  // After "Try again": a failure leaves the button, and the keyboard, where
  // they are; a success removes the button, and the keyboard goes to the
  // form — unless it has moved on meanwhile.
  useLayoutEffect(() => {
    if (loadState === 'loading' || !focusAfterLoad.current) return;
    focusAfterLoad.current = false;
    if (loadState !== 'loaded') return;
    const active = document.activeElement;
    if (!active || active === document.body) baseUrlRef.current?.focus();
  }, [loadState]);

  const retryLoad = () => {
    if (loadState === 'loading') return;
    focusAfterLoad.current = true;
    setLoadState('loading');
    setLoadAttempt(attempt => attempt + 1);
  };

  const post = (path: string, payload: Record<string, unknown>) => fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionToken, ...payload })
  });

  const trimmed = baseUrl.trim();
  const parsed = parseJiraBaseUrl(trimmed);
  const addressChanges = savedBaseUrl !== null && (parsed ?? trimmed) !== savedBaseUrl;

  const save = async () => {
    if (saving || loadState !== 'loaded') return;
    setMessage(null);
    if ((trimmed && !parsed) || (enabled && !parsed)) {
      setFieldError({ raw: INVALID_BASE_URL });
      return;
    }
    setFieldError(null);
    // The native confirmation, as the console's other irreversible actions
    // (a restore, a deletion) use: every team's token stops working.
    // eslint-disable-next-line no-alert -- judged: a change that voids every team's Jira token must be confirmed, and the console confirms its irreversible actions this way
    if (addressChanges && !window.confirm(t('admin.jira.addressChangeConfirm'))) return;

    setSaving(true);
    try {
      const response = await post('/api/super-admin/update-jira-settings', {
        enabled,
        baseUrl: parsed,
        allowSelfSignedCerts: allowSelfSigned
      });
      if (!response.ok) {
        const { notice, code } = await refusalOf(response);
        if (code === INVALID_BASE_URL) setFieldError({ raw: code });
        else setMessage({ kind: 'error', notice: notice ?? { key: 'admin.jira.saveFailed' } });
        return;
      }
      const stored = readSettings(await response.json());
      if (stored) {
        setEnabled(stored.enabled);
        setBaseUrl(stored.baseUrl ?? '');
        setSavedBaseUrl(stored.baseUrl);
        setAllowSelfSigned(stored.allowSelfSignedCerts);
      }
      setMessage({ kind: 'saved' });
    } catch {
      setMessage({ kind: 'error', notice: { key: 'admin.jira.saveFailed' } });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (testing) return;
    setMessage(null);
    if (!parsed) {
      setFieldError({ raw: INVALID_BASE_URL });
      return;
    }
    setFieldError(null);
    setTesting(true);
    try {
      const response = await post('/api/super-admin/test-jira', { baseUrl: trimmed, allowSelfSignedCerts: allowSelfSigned });
      if (response.ok) {
        setMessage({ kind: 'test', answer: readTestAnswer(await response.json()) });
        return;
      }
      // The route itself refused or failed. Its HTTP status is the
      // deployment's (an older pod's 404 during a rollout, a gateway's 502),
      // never Jira's: only a 200 answer carries what Jira did.
      const { notice, code } = await refusalOf(response);
      if (notice) setMessage({ kind: 'error', notice });
      else if (code) setMessage({ kind: 'test', answer: { ok: false, error: code } });
      else setMessage({ kind: 'error', notice: { key: 'admin.jira.testUnavailable' } });
    } catch {
      setMessage({ kind: 'error', notice: { key: 'errors.connectionFailed' } });
    } finally {
      setTesting(false);
    }
  };

  const messageLines = (): string[] => {
    if (!message) return [];
    if (message.kind === 'saved') return [t('admin.jira.saved')];
    if (message.kind === 'error') return [noticeText(message.notice, t)];
    const answer = message.answer;
    // `in`, not `answer.ok`: without strictNullChecks a boolean does not narrow.
    if (!('error' in answer)) {
      const deployment = t(answer.deploymentType === 'Cloud' ? 'admin.jira.deployment.Cloud' : 'admin.jira.deployment.Server');
      return [t('admin.jira.testSucceeded', { version: answer.version, deployment })];
    }
    return [
      t('admin.jira.testFailed', { error: testErrorText(answer.error, t) }),
      ...(answer.status !== undefined ? [t('admin.jira.testStatus', { status: answer.status })] : []),
      ...(answer.location ? [t('admin.jira.testRedirect', { location: answer.location })] : []),
      ...(answer.messages && answer.messages.length > 0 ? [t('admin.jira.testMessages', { messages: answer.messages.join(' ') })] : [])
    ];
  };
  const success = message?.kind === 'saved' || (message?.kind === 'test' && !('error' in message.answer));
  const lines = messageLines();
  const loadFailed = loadState === 'failed' && !!loadError;

  const describedBy = [ids.hint, addressChanges ? ids.warning : null, fieldError ? ids.error : null].filter(Boolean).join(' ');
  const switchClass = (on: boolean) =>
    `relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${on ? 'bg-indigo-600' : 'bg-slate-300'}`;
  const knobClass = (on: boolean) =>
    `inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`;

  return (
    <section aria-labelledby={ids.title} className="mb-6 rounded-xl bg-white p-6 shadow-lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={ids.title} className="flex items-center gap-2 text-xl font-bold text-slate-800">
              <span className="material-symbols-outlined text-indigo-600" aria-hidden="true">integration_instructions</span>
              {t('admin.jira.title')}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{t('admin.jira.description')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t('admin.jira.enable')}
            onClick={() => {
              edited.current = true;
              setEnabled(on => !on);
            }}
            className={switchClass(enabled)}
          >
            <span className={knobClass(enabled)} />
          </button>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-200 pt-4">
          <label htmlFor={ids.baseUrl} className="text-sm font-medium text-slate-700">{t('admin.jira.baseUrlLabel')}</label>
          <input
            ref={baseUrlRef}
            id={ids.baseUrl}
            type="url"
            value={baseUrl}
            autoComplete="off"
            spellCheck={false}
            placeholder={t('admin.jira.baseUrlPlaceholder')}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={describedBy}
            onChange={(e) => {
              edited.current = true;
              setBaseUrl(e.target.value);
              setFieldError(null);
            }}
            className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 aria-invalid:border-red-500"
          />
          <p id={ids.hint} className="text-xs text-slate-600">{t('admin.jira.baseUrlHint')}</p>
          {addressChanges && (
            <p id={ids.warning} className="flex items-start gap-1 text-xs text-amber-800">
              <span className="material-symbols-outlined text-sm" aria-hidden="true">warning</span>
              {t('admin.jira.addressChangeWarning')}
            </p>
          )}
          {fieldError && <p id={ids.error} className="text-xs text-red-700">{noticeText(fieldError, t)}</p>}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-3">
          <div>
            <h3 id={ids.selfSignedTitle} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <span className="material-symbols-outlined text-base text-indigo-600" aria-hidden="true">verified_user</span>
              {t('admin.jira.selfSignedTitle')}
            </h3>
            <p id={ids.selfSignedDescription} className="mt-1 text-xs text-slate-600">{t('admin.jira.selfSignedDescription')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={allowSelfSigned}
            aria-label={t('admin.jira.selfSignedTitle')}
            aria-describedby={ids.selfSignedDescription}
            onClick={() => {
              edited.current = true;
              setAllowSelfSigned(on => !on);
            }}
            className={switchClass(allowSelfSigned)}
          >
            <span className={knobClass(allowSelfSigned)} />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          <p id={ids.testHint} className="mr-auto text-xs text-slate-600">{t('admin.jira.testHint')}</p>
          <button
            type="button"
            onClick={() => { void test(); }}
            aria-disabled={testing ? true : undefined}
            aria-describedby={ids.testHint}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-200 aria-disabled:cursor-wait aria-disabled:opacity-70"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">{testing ? 'sync' : 'science'}</span>
            {testing ? t('admin.jira.testing') : t('admin.jira.test')}
          </button>
          <button
            type="button"
            onClick={() => { void save(); }}
            aria-disabled={saving || loadState !== 'loaded' ? true : undefined}
            aria-describedby={loadFailed ? ids.loadError : undefined}
            className={`flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 aria-disabled:opacity-70 ${loadFailed ? 'aria-disabled:cursor-not-allowed' : 'aria-disabled:cursor-wait'}`}
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">{saving ? 'sync' : 'save'}</span>
            {saving ? t('admin.saving') : t('admin.jira.save')}
          </button>
        </div>

        <div role="status" className="flex flex-col gap-2">
          {loadFailed && (
            <p id={ids.loadError} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {noticeText(loadError, t)}
            </p>
          )}
          {lines.length > 0 && (
            <div className={`rounded-lg border p-3 text-sm ${success ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
              {lines.map((line, index) => <p key={index}>{line}</p>)}
            </div>
          )}
        </div>
        {/* Kept while a new read runs, so the keyboard stays on it. */}
        {(loadFailed || (loadState === 'loading' && loadAttempt > 0)) && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={retryLoad}
              aria-disabled={loadState === 'loading' ? true : undefined}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 aria-disabled:cursor-wait aria-disabled:opacity-70"
            >
              {t('admin.jira.retry')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
};

export default JiraSettingsCard;
