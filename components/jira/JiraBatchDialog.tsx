import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ActionItem, JiraStatus, JiraTarget } from '../../types';
import { issueFields } from '../../utils/jiraIssueContent.js';
import { jiraService, JiraServiceError, type CreateIssuesOutcome } from '../../services/jiraService';
import { useTranslation } from '../../i18n/I18nContext';
import type { PluralKey } from '../../i18n/translate';
import { noticeText, type Notice } from '../../i18n/notice';
import { translateErrorMessage } from '../../i18n/errorMessages';
import ModalDialog from '../common/ModalDialog';
import JiraLinkBadge from './JiraLinkBadge';
import JiraTargetFields from './JiraTargetFields';
import { jiraInFlight } from './jiraInFlight';
import { isJiraStatusStaleCode, jiraActionHome, type JiraActionKind } from './jiraAvailability';
import { draftFromTarget, sameJiraTarget, targetFromDraft } from './jiraTargetDraft';
import { groupJiraResults, type JiraBatchGroups } from './jiraBatchResults';

type SessionLike = Parameters<typeof jiraActionHome>[0]['session'];
type TeamLike = Parameters<typeof jiraActionHome>[0]['team'];

interface Props {
  /** The actions to create, as they were when the dialog opened. */
  actions: ActionItem[];
  status: JiraStatus;
  teamId: string;
  sessionId?: string;
  kind: JiraActionKind;
  team: TeamLike;
  session?: SessionLike;
  requestedBy: string;
  onClose: () => void;
  onDone?: (outcome: CreateIssuesOutcome) => void;
  onStatusStale?: () => void;
}

type Phase = 'confirm' | 'sending' | 'done';

// The description as Jira shows it. `issueFields` escapes Jira's wiki markup
// with a backslash before each special character (`2026\-10\-06`), which Jira
// renders as the character alone. A participant's own backslashes became
// spaces in the builder, so every backslash left is one of those escapes.
const asJiraShowsIt = (description: string) => description.replace(/\\(.)/gsu, '$1');

const withFullStop = (line: string) => (/[.!?…]$/u.test(line) ? line : `${line}.`);

/**
 * The confirmation before a batch, and its results (findings U-2, U-4, U-8).
 *
 *  - It names the target, and lets the facilitator change it for this one
 *    creation (another parent issue for this sprint, say). The change is sent
 *    with the request only when it differs from the stored target, and it is
 *    never saved: the stored target is the Settings card's.
 *  - It shows, for each action, exactly what the issue will say, built by the
 *    shared builder the server uses (`utils/jiraIssueContent.js`), in the
 *    session's content language, so the facilitator sees what leaves for Jira
 *    before it does: a quoted card included, in anonymous sessions too
 *    (maintainer decision D2).
 *  - While it sends it cannot be dismissed (no Escape, no backdrop, Cancel
 *    unavailable): closing would not stop the request, and the results would
 *    have nowhere to go. Its actions are held in `jiraInFlight`, so their own
 *    buttons show them as sending.
 *  - At the end it lists every action's outcome — Jira's own words for a
 *    refusal, the reason a stop left some unsent, "check Jira" for an outcome
 *    that is unknown — and a status region, mounted with the dialog, says the
 *    counts. The keyboard moves to Close, since the button it was on is gone.
 */
const JiraBatchDialog: React.FC<Props> = ({
  actions,
  status,
  teamId,
  sessionId,
  kind,
  team,
  session,
  requestedBy,
  onClose,
  onDone,
  onStatusStale
}) => {
  const { t, tp, language } = useTranslation();
  const baseId = useId();
  const ids = {
    title: `${baseId}-title`,
    target: `${baseId}-target`,
    fields: `${baseId}-fields`,
    preview: `${baseId}-preview`,
    results: `${baseId}-results`
  };
  const [phase, setPhase] = useState<Phase>('confirm');
  const [changingTarget, setChangingTarget] = useState(false);
  const [draft, setDraft] = useState(() => draftFromTarget(status.target));
  const [targetError, setTargetError] = useState<Notice>(null);
  const [sentCount, setSentCount] = useState(0);
  const [outcome, setOutcome] = useState<CreateIssuesOutcome | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (phase === 'done') closeRef.current?.focus();
  }, [phase]);

  const textOf = useMemo(() => {
    const texts = new Map(actions.map(action => [action.id, action.text]));
    return (actionId: string) => texts.get(actionId) ?? actionId;
  }, [actions]);

  const previews = useMemo(() => actions.map(action => {
    const home = jiraActionHome({ actionId: action.id, team, session, kind });
    const fields = issueFields({ action, session: home.session, kind: home.kind, team, requestedBy, language });
    return { actionId: action.id, summary: fields.summary, description: asJiraShowsIt(fields.description), language: fields.language };
  }), [actions, team, session, kind, requestedBy, language]);

  const groups: JiraBatchGroups | null = outcome ? groupJiraResults(outcome) : null;

  const countLines = (g: JiraBatchGroups): [PluralKey, number][] => ([
    ['jira.batch.result.created', g.created.length],
    ['jira.batch.result.alreadyLinked', g.alreadyLinked.length],
    ['jira.batch.result.notSaved', g.notSaved.length],
    ['jira.batch.result.refused', g.refused.length],
    ['jira.batch.result.skipped', g.skipped.length],
    ['jira.batch.result.uncertain', g.uncertain.length],
    ['jira.batch.result.notSent', g.notSent.length],
    ['jira.batch.result.unknown', g.unknown.length]
  ] as [PluralKey, number][]).filter(([, count]) => count > 0);

  const stopReason = (result: CreateIssuesOutcome): string | null => {
    if (refusal) return translateErrorMessage(refusal, t);
    if (!result.stopped || result.stopped === 'outcome_unknown') return null;
    if (result.stopped === 'jira_rate_limited') {
      const seconds = result.retryAfterSeconds;
      return typeof seconds === 'number' && seconds > 0
        ? tp('jira.batch.rateLimited', seconds)
        : t('jira.batch.rateLimitedNoDelay');
    }
    return translateErrorMessage(result.stopped, t);
  };

  const send = async () => {
    if (phase !== 'confirm') return;
    let target: JiraTarget | undefined;
    if (changingTarget) {
      const built = targetFromDraft(draft);
      if ('error' in built) {
        setTargetError({ raw: built.error });
        return;
      }
      if (!sameJiraTarget(built.target, status.target)) target = built.target;
    }
    setTargetError(null);
    setPhase('sending');

    const actionIds = actions.map(action => action.id);
    jiraInFlight.add(actionIds);
    let result: CreateIssuesOutcome;
    let refusedWith: string | null = null;
    try {
      result = await jiraService.createIssues(teamId, actionIds, {
        target,
        sessionId: kind === 'backlog' ? undefined : sessionId,
        requestedBy,
        language,
        onProgress: (results) => {
          if (mounted.current) setSentCount(results.length);
        }
      });
    } catch (err) {
      // The route refused the request itself: nothing more was sent.
      refusedWith = err instanceof JiraServiceError ? err.code : 'unknown_error';
      result = err instanceof JiraServiceError
        ? { results: err.results, notSent: err.notSent, unknown: [] }
        : { results: [], notSent: actionIds, unknown: [] };
    } finally {
      jiraInFlight.remove(actionIds);
    }

    onDone?.(result);
    if (isJiraStatusStaleCode(refusedWith ?? result.stopped)) onStatusStale?.();
    if (!mounted.current) return;
    const lines = countLines(groupJiraResults(result)).map(([key, count]) => withFullStop(tp(key, count)));
    setOutcome(result);
    setRefusal(refusedWith);
    setSummary(lines.join(' '));
    setPhase('done');
  };

  const busy = phase === 'sending';
  const storedTarget = status.target;
  const actionList = (actionIds: string[]) => (
    <ul className="mt-1 list-disc pl-5 text-slate-700">
      {actionIds.map(actionId => <li key={actionId}>{textOf(actionId)}</li>)}
    </ul>
  );
  const linkList = (entries: { actionId: string; key: string }[]) => (
    <ul className="mt-1 flex flex-col gap-1 pl-5">
      {entries.map(entry => (
        <li key={entry.actionId} className="flex flex-wrap items-center gap-2 text-slate-700">
          <span>{textOf(entry.actionId)}</span>
          <JiraLinkBadge link={{ key: entry.key, createdAt: '' }} baseUrl={status.baseUrl} />
        </li>
      ))}
    </ul>
  );

  return (
    <ModalDialog
      labelledBy={ids.title}
      onClose={busy ? undefined : onClose}
      panelClassName="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id={ids.title} className="text-lg font-bold text-slate-800">{t('jira.batch.title')}</h2>

        {phase !== 'done' && (
          <>
            <section aria-labelledby={ids.target} className="flex flex-col gap-2">
              <h3 id={ids.target} className="text-sm font-semibold text-slate-700">{t('jira.target.title')}</h3>
              {!changingTarget && storedTarget && (
                <div className="text-sm text-slate-700">
                  <p>
                    {storedTarget.mode === 'parent'
                      ? t('jira.batch.target.parent', { parent: storedTarget.parentKey ?? '' })
                      : t('jira.batch.target.project', { project: storedTarget.projectKey ?? '' })}
                  </p>
                  <p>
                    {storedTarget.labels.length > 0
                      ? t('jira.batch.target.labels', { labels: storedTarget.labels.join(', ') })
                      : t('jira.batch.target.noLabels')}
                  </p>
                </div>
              )}
              <div>
                <button
                  type="button"
                  aria-expanded={changingTarget}
                  aria-controls={changingTarget ? ids.fields : undefined}
                  onClick={() => {
                    setChangingTarget(open => !open);
                    setTargetError(null);
                  }}
                  aria-disabled={busy ? true : undefined}
                  className="text-xs font-semibold text-indigo-700 underline hover:text-indigo-900 aria-disabled:pointer-events-none aria-disabled:opacity-60"
                >
                  {t('jira.batch.changeTarget')}
                </button>
              </div>
              {changingTarget && (
                <div id={ids.fields} className="rounded-lg border border-slate-200 p-3">
                  <JiraTargetFields teamId={teamId} value={draft} onChange={setDraft} idPrefix={`${baseId}-override`} />
                </div>
              )}
              {targetError && <p role="alert" className="text-xs text-red-700">{noticeText(targetError, t)}</p>}
            </section>

            <section className="flex flex-col gap-2">
              <h3 id={ids.preview} className="text-sm font-semibold text-slate-700">{t('jira.batch.previewHeading')}</h3>
              <ul aria-labelledby={ids.preview} className="flex flex-col gap-2">
                {previews.map(preview => (
                  <li key={preview.actionId} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                    <dl className="flex flex-col gap-1">
                      <dt className="text-xs font-semibold text-slate-600">{t('jira.batch.previewSummary')}</dt>
                      <dd className="font-medium text-slate-800">{preview.summary}</dd>
                      <dt className="text-xs font-semibold text-slate-600">{t('jira.batch.previewDescription')}</dt>
                      <dd lang={preview.language} className="text-slate-700">{preview.description}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
            </section>

            {busy && (
              <p className="text-sm text-slate-700">
                {t('jira.batch.progress', { done: sentCount, total: actions.length })}
              </p>
            )}
          </>
        )}

        {phase === 'done' && groups && outcome && (
          <section aria-labelledby={ids.results} className="flex flex-col gap-2 text-sm">
            <h3 id={ids.results} className="text-sm font-semibold text-slate-700">{t('jira.batch.resultsHeading')}</h3>
            {refusal && <p role="alert" className="text-red-700">{translateErrorMessage(refusal, t)}</p>}
            <ul className="flex flex-col gap-3">
              {groups.created.length > 0 && (
                <li><p className="font-semibold text-green-800">{tp('jira.batch.result.created', groups.created.length)}</p>{linkList(groups.created)}</li>
              )}
              {groups.alreadyLinked.length > 0 && (
                <li><p className="font-semibold text-slate-800">{tp('jira.batch.result.alreadyLinked', groups.alreadyLinked.length)}</p>{linkList(groups.alreadyLinked)}</li>
              )}
              {groups.notSaved.length > 0 && (
                <li><p className="font-semibold text-amber-800">{tp('jira.batch.result.notSaved', groups.notSaved.length)}</p>{linkList(groups.notSaved)}</li>
              )}
              {groups.refused.length > 0 && (
                <li>
                  <p className="font-semibold text-red-800">{tp('jira.batch.result.refused', groups.refused.length)}</p>
                  <ul className="mt-1 list-disc pl-5 text-slate-700">
                    {groups.refused.map(entry => (
                      <li key={entry.actionId}>
                        <span>{textOf(entry.actionId)}</span>
                        {entry.messages.length > 0 ? (
                          <ul className="list-[circle] pl-5">
                            {entry.messages.map((message, index) => <li key={index}>{message}</li>)}
                          </ul>
                        ) : (
                          <span> — {t('jira.action.refusedNoMessage')}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              )}
              {groups.skipped.length > 0 && (
                <li><p className="font-semibold text-slate-800">{tp('jira.batch.result.skipped', groups.skipped.length)}</p>{actionList(groups.skipped)}</li>
              )}
              {groups.uncertain.length > 0 && (
                <li><p className="font-semibold text-amber-800">{tp('jira.batch.result.uncertain', groups.uncertain.length)}</p>{actionList(groups.uncertain)}</li>
              )}
              {groups.notSent.length > 0 && (
                <li>
                  <p className="font-semibold text-slate-800">{tp('jira.batch.result.notSent', groups.notSent.length)}</p>
                  {!refusal && stopReason(outcome) && <p className="text-slate-700">{stopReason(outcome)}</p>}
                  {actionList(groups.notSent)}
                </li>
              )}
              {groups.unknown.length > 0 && (
                <li>
                  <p className="font-semibold text-amber-800">{tp('jira.batch.result.unknown', groups.unknown.length)}</p>
                  <p className="text-slate-700">{t('jira.batch.outcomeUnknown')}</p>
                  {actionList(groups.unknown)}
                </li>
              )}
            </ul>
          </section>
        )}

        <div role="status" className="sr-only">{summary}</div>

        <div className="flex flex-wrap justify-end gap-3">
          {phase === 'done' ? (
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              {t('jira.batch.close')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('jira.batch.cancel')}
              </button>
              <button
                type="button"
                onClick={() => { void send(); }}
                aria-disabled={busy ? true : undefined}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 aria-disabled:cursor-wait aria-disabled:opacity-70"
              >
                {busy ? t('jira.creating') : tp('jira.batch.confirm', actions.length)}
              </button>
            </>
          )}
        </div>
      </div>
    </ModalDialog>
  );
};

export default JiraBatchDialog;
