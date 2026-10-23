import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ActionItem, JiraStatus, JiraTarget } from '../../types';
import { isJiraIssueKey } from '../../utils/jira.js';
import { jiraService, JiraServiceError, type CreateIssuesOutcome } from '../../services/jiraService';
import { useTranslation } from '../../i18n/I18nContext';
import type { PluralKey } from '../../i18n/translate';
import { noticeText, type Notice } from '../../i18n/notice';
import { translateErrorMessage } from '../../i18n/errorMessages';
import ModalDialog from '../common/ModalDialog';
import JiraLinkBadge from './JiraLinkBadge';
import JiraTargetFields from './JiraTargetFields';
import JiraParentField from './JiraParentField';
import {
  EMPTY_JIRA_PARENT_FIELD,
  isJiraParentChecked,
  jiraParentSubtaskType,
  type JiraParentFieldValue
} from './jiraParentDraft';
import JiraParentPreviewList from './JiraParentPreviewList';
import JiraParentResults from './JiraParentResults';
import { jiraInFlight } from './jiraInFlight';
import { isJiraStatusStaleCode, type JiraActionKind } from './jiraAvailability';
import { descriptionAsJiraShowsIt, jiraIssuePreview, jiraParentPreviews, type PreviewSession, type PreviewTeam } from './jiraIssuePreview';
import { jiraScopeLabel } from './jiraParentLabels';
import { draftFromTarget, targetFromDraft } from './jiraTargetDraft';
import { groupJiraResults, type JiraBatchGroups } from './jiraBatchResults';

interface Props {
  /** The actions to create, as they were when the dialog opened. */
  actions: ActionItem[];
  status: JiraStatus;
  teamId: string;
  sessionId?: string;
  kind: JiraActionKind;
  team: PreviewTeam;
  session?: PreviewSession;
  requestedBy: string;
  /**
   * One action that may already be in Jira, opened through "Create anyway":
   * the dialog warns, its button says "Create anyway", and the request sends
   * `force`.
   */
  force?: boolean;
  onClose: () => void;
  /** After the batch, with the route's code when it refused a request outright. */
  onDone?: (outcome: CreateIssuesOutcome, refusal?: string | null) => void;
  onStatusStale?: () => void;
}

type Phase = 'confirm' | 'sending' | 'done';

const withFullStop = (line: string) => (/[.!?…]$/u.test(line) ? line : `${line}.`);

/**
 * The confirmation before a batch, and its results (findings U-2, U-4, U-8).
 *
 *  - In the sub-task modes it offers a parent issue for this send ("Parent
 *    issue (optional)", `JiraParentField`), sent as a one-time `parent`-mode
 *    target; in `sessionParent` mode with `adoptParent`, so the issue named
 *    becomes the parent of the sessions that have none, once a sub-task of
 *    theirs landed under it (and replaces theirs with the box ticked). In
 *    `sessionParent` mode it lists the parent issue of each session the send
 *    touches (`JiraParentPreviewList`): existing, new with its title, or in
 *    doubt with the box that creates one anyway — for the rows it shows in
 *    doubt, and only those (`forceParents`, review F2-1); the confirm button
 *    counts the parent issues it creates (design F2 [R9]), and the results
 *    say what became of each (`JiraParentResults`).
 *  - It names the target — project or parent issue, issue type, labels — and
 *    lets the facilitator change it for this one creation (another parent
 *    issue for this sprint, say). The target it shows, the stored one as last
 *    read or the one-time change, is sent with every request of the batch, so
 *    each issue is created where the facilitator confirmed even when someone
 *    saves another target meanwhile (any team session may: decision D1). The
 *    change is never saved: the stored target is the Settings card's.
 *  - The stored type is named as Jira names it, read once when the dialog
 *    opens; until Jira answers, or when it cannot, by its id. The read never
 *    holds the creation back: the send reports what Jira really refuses.
 *  - It shows, for each action, exactly what the issue will say, built by the
 *    shared builder the server uses (`utils/jiraIssueContent.js`), in the
 *    session's content language, so the facilitator sees what leaves for Jira
 *    before it does: the card quoted in full and a group's cards included,
 *    in anonymous sessions too (maintainer decision D2), with its line breaks
 *    and the list's bullets as Jira shows them (`descriptionAsJiraShowsIt`).
 *  - While it sends it cannot be dismissed (no Escape, no backdrop, Cancel
 *    unavailable): closing would not stop the request, and the results would
 *    have nowhere to go. Its actions are held in `jiraInFlight`, so their own
 *    buttons show them as sending.
 *  - While it sends, nothing in the target can be changed or read: the target
 *    is already in the request, and a control that says it is unavailable
 *    does nothing.
 *  - A status region, mounted with the dialog, says the progress while it
 *    sends — Escape and Cancel are off meanwhile, so a screen-reader user
 *    would otherwise hear nothing for tens of seconds — and the counts at the
 *    end, when the dialog lists every action's outcome: Jira's own words for a
 *    refusal, the reason a stop left some unsent, "check Jira" for an outcome
 *    that is unknown. The keyboard moves to Close, since the button it was on
 *    is gone.
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
  force = false,
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
  const [parentField, setParentField] = useState<JiraParentFieldValue>(EMPTY_JIRA_PARENT_FIELD);
  const [parentSendError, setParentSendError] = useState<React.ComponentProps<typeof JiraParentField>['sendError']>(null);
  const [replaceParents, setReplaceParents] = useState(false);
  const [forceParent, setForceParent] = useState(false);
  const parentInputRef = useRef<HTMLInputElement>(null);
  const parentTypeRef = useRef<HTMLSelectElement>(null);
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
  // The stored types' names, kept with the target they were read for: the
  // type of each action's issue, and in `sessionParent` mode the parent's.
  const [storedType, setStoredType] = useState<{ target: string; name: string | null; parentName: string | null } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const storedTargetJson = JSON.stringify(status.target ?? null);
  useEffect(() => {
    const stored = JSON.parse(storedTargetJson) as JiraTarget | null;
    if (!stored) return;
    const source = stored.mode === 'parent'
      ? (stored.parentKey ? { parentKey: stored.parentKey } : null)
      : (stored.projectKey ? { projectKey: stored.projectKey } : null);
    if (!source) return;
    let cancelled = false;
    jiraService.getIssueTypes(teamId, source).then((answer) => {
      if (cancelled) return;
      const nameOf = (id: string | undefined) => {
        const match = id ? answer.issueTypes.find(type => type?.id === id) : undefined;
        return match && typeof match.name === 'string' && match.name.trim() !== '' ? match.name : null;
      };
      const name = nameOf(stored.issueTypeId);
      const parentName = stored.mode === 'sessionParent' ? nameOf(stored.parentIssueTypeId) : null;
      if (name || parentName) setStoredType({ target: storedTargetJson, name, parentName });
    }, () => {
      // Said by its id: the creation reports what Jira really refuses.
    });
    return () => { cancelled = true; };
  }, [teamId, storedTargetJson]);

  useEffect(() => {
    if (phase === 'done') closeRef.current?.focus();
  }, [phase]);

  const textOf = useMemo(() => {
    const texts = new Map(actions.map(action => [action.id, action.text]));
    return (actionId: string) => texts.get(actionId) ?? actionId;
  }, [actions]);

  // Built as the server builds each issue (`issueSource`), from the session
  // the request names: what the dialog shows is what Jira receives.
  const previews = useMemo(() => actions.map(action => {
    const fields = jiraIssuePreview({
      action,
      team,
      session,
      kind,
      sessionId: kind === 'backlog' ? undefined : sessionId,
      requestedBy,
      language
    });
    return { actionId: action.id, summary: fields.summary, description: descriptionAsJiraShowsIt(fields.description), language: fields.language };
  }), [actions, team, session, kind, sessionId, requestedBy, language]);

  // The target the dialog shows: the stored one, or the change for this
  // creation as typed so far. The parent field and the parents preview follow
  // its mode.
  const shownMode = changingTarget ? draft.mode : status.target?.mode;
  const shownTarget: JiraTarget | null = useMemo(() => {
    if (!changingTarget) return status.target ?? null;
    const built = targetFromDraft(draft);
    return built.ok ? built.target : null;
  }, [changingTarget, draft, status.target]);
  const shownIssueTypeId = changingTarget ? draft.issueTypeId : status.target?.issueTypeId ?? '';
  const shownParentKey = changingTarget ? draft.parentKey.trim() : status.target?.parentKey ?? '';
  const subtaskMode = shownMode === 'parent' || shownMode === 'sessionParent';
  const typedParent = subtaskMode ? parentField.key.trim() : '';
  const explicitKey = isJiraIssueKey(typedParent) ? typedParent : null;

  // Built as the server decides which parent issue each action goes under.
  const parentPreviews = useMemo(() => jiraParentPreviews({
    actions,
    team,
    session,
    kind,
    sessionId: kind === 'backlog' ? undefined : sessionId,
    requestedBy,
    language
  }), [actions, team, session, kind, sessionId, requestedBy, language]);
  const showParents = shownMode === 'sessionParent';
  const replaceable = showParents && explicitKey
    ? parentPreviews.flatMap(preview => (preview.parent.state === 'existing' && preview.parent.key !== explicitKey
      ? [{ scope: preview.scope, label: jiraScopeLabel(preview.kind, preview.sessionName, t), key: preview.parent.key }]
      : []))
    : [];
  // [R9] The issues the click creates: the actions, and the parent issues it
  // creates for them. The preview can say "new" where the server reuses a
  // parent created meanwhile, so the count can be high by one for each such
  // session (several on a Dashboard batch, which spans sessions), never low.
  const newParents = showParents && !explicitKey
    ? parentPreviews.filter(preview => preview.parent.state === 'new' || (forceParent && preview.parent.state === 'uncertain')).length
    : 0;
  const issueCount = actions.length + newParents;

  const groups: JiraBatchGroups | null = outcome ? groupJiraResults(outcome) : null;

  const countLines = (g: JiraBatchGroups, result: CreateIssuesOutcome): [PluralKey, number][] => ([
    ['jira.batch.result.parentsCreated', result.parents.filter(entry => entry.status === 'created').length],
    ['jira.batch.result.parentsNotSaved', result.parents.filter(entry => entry.status === 'not_saved').length],
    ['jira.batch.result.created', g.created.length],
    ['jira.batch.result.alreadyLinked', g.alreadyLinked.length],
    ['jira.batch.result.notSaved', g.notSaved.length],
    ['jira.batch.result.refused', g.refused.length],
    ['jira.batch.result.noText', g.noText.length],
    ['jira.batch.result.skipped', g.skipped.length],
    ['jira.batch.result.uncertain', g.uncertain.length],
    ['jira.batch.result.parentUncertain', g.parentUncertain.length],
    ['jira.batch.result.parentRefused', g.parentRefused.length],
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
    // What the dialog shows is what Jira receives: the target on screen goes
    // with every request. A target that is still unknown (none stored) is left
    // to the route, which answers `jira_target_missing`.
    let target: JiraTarget | undefined = status.target ?? undefined;
    if (changingTarget) {
      const built = targetFromDraft(draft);
      if ('error' in built) {
        setTargetError({ raw: built.error });
        return;
      }
      target = built.target;
    }
    setTargetError(null);

    // A parent issue named for this send: checked with Jira, with a sub-task
    // type its project offers, or nothing is sent (design F2 §4.2).
    let adoptParent = false;
    if (typedParent) {
      if (!isJiraIssueKey(typedParent) || !isJiraParentChecked(parentField) || !parentField.checked) {
        setParentSendError({ notice: { key: 'jira.batch.parent.notChecked' }, on: 'key' });
        parentInputRef.current?.focus();
        return;
      }
      const subtaskType = jiraParentSubtaskType(parentField, target?.issueTypeId ?? '');
      if (!subtaskType) {
        if (parentField.checked.subtaskTypes.length === 0) {
          setParentSendError({ notice: { key: 'jira.target.noSubtaskTypes' }, on: 'key' });
          parentInputRef.current?.focus();
        } else {
          setParentSendError({ notice: { key: 'jira.batch.parent.subtaskTypeMissing', params: { project: parentField.checked.projectKey } }, on: 'type' });
          parentTypeRef.current?.focus();
        }
        return;
      }
      adoptParent = target?.mode === 'sessionParent';
      target = { mode: 'parent', parentKey: typedParent, issueTypeId: subtaskType, labels: target?.labels ?? [] };
    }
    setParentSendError(null);
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
        force: force || undefined,
        adoptParent: adoptParent || undefined,
        replaceParents: adoptParent && replaceParents ? true : undefined,
        // Only for the parents the stored or changed target creates itself,
        // and only the ones this dialog showed in doubt: a confirmation is for
        // a doubt the facilitator checked, never for one the server finds.
        forceParents: !typedParent && target?.mode === 'sessionParent' && forceParent
          ? parentPreviews.flatMap(preview => (preview.parent.state === 'uncertain' ? [{ scope: preview.scope, actionIds: [...preview.actionIds] }] : []))
          : undefined,
        onProgress: (results) => {
          if (mounted.current) setSentCount(results.length);
        }
      });
    } catch (err) {
      // The route refused the request itself: nothing more was sent.
      refusedWith = err instanceof JiraServiceError ? err.code : 'unknown_error';
      result = err instanceof JiraServiceError
        ? { results: err.results, notSent: err.notSent, unknown: [], parents: err.parents }
        : { results: [], notSent: actionIds, unknown: [], parents: [] };
    } finally {
      jiraInFlight.remove(actionIds);
    }

    onDone?.(result, refusedWith);
    if (isJiraStatusStaleCode(refusedWith ?? result.stopped)) onStatusStale?.();
    if (!mounted.current) return;
    const lines = countLines(groupJiraResults(result), result).map(([key, count]) => withFullStop(tp(key, count)));
    setOutcome(result);
    setRefusal(refusedWith);
    setSummary(lines.join(' '));
    setPhase('done');
  };

  const busy = phase === 'sending';
  const storedTarget = status.target;
  const storedTypeName = storedType && storedType.target === storedTargetJson ? storedType.name : null;
  const storedParentTypeName = storedType && storedType.target === storedTargetJson ? storedType.parentName : null;
  const progress = t('jira.batch.progress', { done: sentCount, total: actions.length });
  const actionList = (actionIds: string[]) => (
    <ul className="mt-1 list-disc pl-5 text-slate-700">
      {actionIds.map(actionId => <li key={actionId}>{textOf(actionId)}</li>)}
    </ul>
  );
  // The actions this screen still shows a text for: the server found none on
  // the team record, and an empty line would name nothing.
  const namedList = (actionIds: string[]) => {
    const named = actionIds.filter(actionId => textOf(actionId).trim() !== '');
    return named.length > 0 ? actionList(named) : null;
  };
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
        {force && phase !== 'done' && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('jira.batch.forceWarning')}</p>
        )}

        {phase !== 'done' && (
          <>
            <section aria-labelledby={ids.target} className="flex flex-col gap-2">
              <h3 id={ids.target} className="text-sm font-semibold text-slate-700">{t('jira.target.title')}</h3>
              {!changingTarget && storedTarget && (
                <div className="text-sm text-slate-700">
                  {storedTarget.mode === 'sessionParent' ? (
                    <>
                      <p>{t('jira.batch.target.sessionParent', { project: storedTarget.projectKey ?? '' })}</p>
                      <p>{t('jira.batch.target.parentIssueType', { type: storedParentTypeName ?? storedTarget.parentIssueTypeId ?? '' })}</p>
                      <p>{t('jira.batch.target.subtaskType', { type: storedTypeName ?? storedTarget.issueTypeId })}</p>
                    </>
                  ) : (
                    <>
                      <p>
                        {storedTarget.mode === 'parent'
                          ? t('jira.batch.target.parent', { parent: storedTarget.parentKey ?? '' })
                          : t('jira.batch.target.project', { project: storedTarget.projectKey ?? '' })}
                      </p>
                      <p>{t('jira.batch.target.issueType', { type: storedTypeName ?? storedTarget.issueTypeId })}</p>
                    </>
                  )}
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
                    // Announced unavailable while it sends: the target is in
                    // the request already. A keyboard still reaches it.
                    if (busy) return;
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
                // Off while it sends: nothing typed there would be used, and
                // "Load the issue types" would call Jira for nothing.
                <fieldset id={ids.fields} disabled={busy} className="min-w-0 rounded-lg border border-slate-200 p-3">
                  <JiraTargetFields teamId={teamId} value={draft} onChange={setDraft} idPrefix={`${baseId}-override`} />
                </fieldset>
              )}
              {targetError && <p role="alert" className="text-xs text-red-700">{noticeText(targetError, t)}</p>}
            </section>

            {subtaskMode && (
              // Always visible in both sub-task modes, never behind "Change
              // the target"; off while it sends, like the override.
              <fieldset disabled={busy} className="min-w-0 flex flex-col gap-3">
                <JiraParentField
                  teamId={teamId}
                  idPrefix={`${baseId}-parent`}
                  mode={shownMode === 'parent' ? 'parent' : 'sessionParent'}
                  targetParentKey={shownParentKey}
                  targetIssueTypeId={shownIssueTypeId}
                  value={parentField}
                  onChange={setParentField}
                  sendError={parentSendError}
                  onSendErrorClear={() => setParentSendError(null)}
                  inputRef={parentInputRef}
                  typeSelectRef={parentTypeRef}
                  replace={showParents ? {
                    checked: replaceParents,
                    onChange: setReplaceParents,
                    sessions: replaceable,
                    baseUrl: status.baseUrl
                  } : null}
                />
                {showParents && (
                  <JiraParentPreviewList
                    previews={parentPreviews}
                    explicitKey={explicitKey}
                    replace={replaceParents}
                    baseUrl={status.baseUrl}
                    target={shownTarget}
                    forceParent={forceParent}
                    onForceParentChange={setForceParent}
                    idPrefix={`${baseId}-parents`}
                  />
                )}
              </fieldset>
            )}

            <section className="flex flex-col gap-2">
              <h3 id={ids.preview} className="text-sm font-semibold text-slate-700">{t('jira.batch.previewHeading')}</h3>
              <ul aria-labelledby={ids.preview} className="flex flex-col gap-2">
                {previews.map(preview => (
                  <li key={preview.actionId} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                    <dl className="flex flex-col gap-1">
                      <dt className="text-xs font-semibold text-slate-600">{t('jira.batch.previewSummary')}</dt>
                      <dd className="font-medium text-slate-800">{preview.summary}</dd>
                      <dt className="text-xs font-semibold text-slate-600">{t('jira.batch.previewDescription')}</dt>
                      {/* Its line breaks kept: a group's cards are a list,
                          one per line, as Jira shows them. */}
                      <dd lang={preview.language} className="whitespace-pre-wrap wrap-break-word text-slate-700">{preview.description}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
            </section>

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
                  {/* Once, however many it refused for it (plan J-5). */}
                  {groups.refused.some(entry => entry.refusesLabels) && (
                    <p className="mt-1 text-slate-700">{t('jira.action.labelsRefused')}</p>
                  )}
                </li>
              )}
              {groups.noText.length > 0 && (
                <li>
                  <p className="font-semibold text-slate-800">{tp('jira.batch.result.noText', groups.noText.length)}</p>
                  {namedList(groups.noText)}
                </li>
              )}
              {groups.skipped.length > 0 && (
                <li><p className="font-semibold text-slate-800">{tp('jira.batch.result.skipped', groups.skipped.length)}</p>{actionList(groups.skipped)}</li>
              )}
              {groups.uncertain.length > 0 && (
                <li><p className="font-semibold text-amber-800">{tp('jira.batch.result.uncertain', groups.uncertain.length)}</p>{actionList(groups.uncertain)}</li>
              )}
              {groups.parentUncertain.length > 0 && (
                <li><p className="font-semibold text-amber-800">{tp('jira.batch.result.parentUncertain', groups.parentUncertain.length)}</p>{actionList(groups.parentUncertain)}</li>
              )}
              {groups.parentRefused.length > 0 && (
                <li>
                  <p className="font-semibold text-red-800">{tp('jira.batch.result.parentRefused', groups.parentRefused.length)}</p>
                  {actionList(groups.parentRefused.map(entry => entry.actionId))}
                </li>
              )}
              <JiraParentResults
                parents={outcome.parents}
                previews={parentPreviews}
                team={team}
                baseUrl={status.baseUrl}
                target={shownTarget}
              />
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

        {/* One region for both: the progress, shown and said while it sends;
            the counts, said at the end beside the list that shows them. */}
        <div role="status" className={busy ? 'text-sm text-slate-700' : 'sr-only'}>{busy ? progress : summary}</div>

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
                {busy ? t('jira.creating') : force ? t('jira.action.createAnyway') : tp('jira.batch.confirm', issueCount)}
              </button>
            </>
          )}
        </div>
      </div>
    </ModalDialog>
  );
};

export default JiraBatchDialog;
