import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ActionItem, JiraIssueResult, JiraLink, JiraStatus } from '../../types';
import { isJiraIssueKey, isJiraLinked, isJiraUncertain } from '../../utils/jira.js';
import { jiraService, JiraServiceError, type CreateIssuesOutcome } from '../../services/jiraService';
import { useTranslation } from '../../i18n/I18nContext';
import { noticeText, type Notice } from '../../i18n/notice';
import JiraLinkBadge from './JiraLinkBadge';
import { jiraInFlight, useJiraActionInFlight } from './jiraInFlight';
import { isJiraStatusStaleCode, isOpenForJira, jiraAvailability, type JiraActionKind } from './jiraAvailability';
import { jiraSearchUrl } from './jiraSearchUrl';

interface Props {
  action: ActionItem;
  status: JiraStatus | null | undefined;
  teamId: string;
  isFacilitator: boolean;
  /** The live session showing the action, so the server patches its row too (finding A-5). */
  sessionId?: string;
  /** Where the action lives; a backlog action has no session to patch. */
  kind: JiraActionKind;
  /** Who clicked, named in the issue's description. */
  requestedBy: string;
  /** After an answer that changed the action (created, already linked, in doubt): refresh the screen (finding A-6). */
  onCreated?: (results: JiraIssueResult[]) => void;
  /** After an answer saying the status the screen holds is out of date (the token was refused…). */
  onStatusStale?: () => void;
}

// What this control learned from its own requests, on top of what the action
// carries. `key` and `uncertain` stand in until the screen re-renders with
// the refreshed action; `message` is what the region says, kept as what to
// say (a Notice), never as a sentence.
interface Learned {
  key: string | null;
  uncertain: boolean;
  message: Notice;
  jiraMessages: string[];
}

const NOTHING_LEARNED: Learned = { key: null, uncertain: false, message: null, jiraMessages: [] };

const SKIPPED_MESSAGES: Partial<Record<JiraIssueResult['status'], Exclude<Notice, null>>> = {
  in_progress: { key: 'jira.action.inProgress' },
  closed: { key: 'jira.action.closed' },
  not_found: { key: 'jira.action.notFound' }
};

const LINKING_STATUSES = new Set<JiraIssueResult['status']>(['created', 'already_linked', 'created_not_saved']);

// An answer after which the action the screen holds is out of date: it has an
// issue now, or may have one.
const changesAction = (outcome: CreateIssuesOutcome): boolean =>
  outcome.unknown.length > 0
  || outcome.stopped === 'outcome_unknown'
  || outcome.results.some(r => LINKING_STATUSES.has(r.status) || r.status === 'uncertain');

// Which element should hold the keyboard after a change unmounted the one
// that had it: the new link, the main button of the state, the confirmation.
type FocusTarget = 'badge' | 'primary' | 'confirm';

/**
 * One action's Jira control (finding U-3).
 *
 *  - A participant sees the action's issue, or the doubt about it, and
 *    nothing to press: facilitator-only is a rule of these screens
 *    (maintainer decision D1 leaves the routes open to any team credential).
 *  - A facilitator of a team that can create (a usable token and a target)
 *    gets "Create in Jira" on an open action without an issue, named
 *    "Create in Jira, <action>" so a list of them stays apart, the visible
 *    words first (WCAG 2.5.3).
 *  - Sending: the button stays where it is, focusable and named, with
 *    `aria-disabled` and "Creating…". Never the `disabled` attribute: a
 *    disabled button cannot hold focus, so the keyboard would land on the page
 *    in the very commit that turned it off. Clicks are ignored, and so are
 *    clicks while a batch holds the action (`jiraInFlight`).
 *  - Created: the button gives way to the link, the keyboard moves to it when
 *    it was on the button, and the status region says "<KEY> created".
 *  - Refused, or skipped by the server: the button stays, and the reason —
 *    Jira's own words for a refusal, shown as Jira wrote them — is tied to it
 *    with `aria-describedby`.
 *  - Uncertain (the answer was lost, or the server marked the action): never
 *    created again on its own. "May already be in Jira", a search of the
 *    target to check, and "Create anyway", which asks once more before sending
 *    `force: true`.
 *  - The conditions that offered the button can end under it: a refusal makes
 *    the screen read the status again (the token was refused, Jira was turned
 *    off), a reconnect can read it mid-request, and the facilitator role can
 *    move to someone else. Removing the button then
 *    would drop the keyboard on the page in that commit, and the message with
 *    it. So once a request starts, the control stays — unavailable, its
 *    message still tied to it — until the keyboard leaves it, the rule
 *    JiraBatchButton follows for its dialog; the reason line takes over then.
 *
 * The status region is rendered with the control and holds every message, so
 * a screen reader hears each change; the success it announces is visually
 * hidden, since the link itself shows it.
 */
const JiraActionControl: React.FC<Props> = ({
  action,
  status,
  teamId,
  isFacilitator,
  sessionId,
  kind,
  requestedBy,
  onCreated,
  onStatusStale
}) => {
  const { t, language } = useTranslation();
  const baseId = useId();
  const regionId = `${baseId}-region`;
  const questionId = `${baseId}-question`;
  // Kept with the action it is about, so a control reused for another action
  // shows nothing of the previous one.
  const [learnedFor, setLearnedFor] = useState<{ actionId: string; learned: Learned }>({
    actionId: action.id,
    learned: NOTHING_LEARNED
  });
  const learned = learnedFor.actionId === action.id ? learnedFor.learned : NOTHING_LEARNED;
  const [announcement, setAnnouncement] = useState('');
  const [confirming, setConfirming] = useState(false);
  // Set by a request this control runs; cleared once the keyboard is
  // elsewhere. While set, the control stays even when nothing offers it now.
  const [lingering, setLingering] = useState(false);
  const sending = useJiraActionInFlight(action.id);

  const rootRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // A click that focused nothing (Safari), or a keyboard that moved on while
  // the request ran: there is nothing to hold, so nothing holds the control.
  // A passive effect, so it sees where the layout effect below has just moved
  // the keyboard (the new link, "Create anyway").
  useEffect(() => {
    if (lingering && !rootRef.current?.contains(document.activeElement)) setLingering(false);
  }, [lingering]);

  // Runs after every commit: the element asked for exists once the state that
  // renders it has, and the request is dropped once served.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = target === 'badge' ? badgeRef.current : target === 'confirm' ? confirmRef.current : primaryRef.current;
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
  });

  const text = action.text.trim();
  const linkedKey = learned.key ?? (isJiraLinked(action) ? (action.jira as { key: string }).key : null);
  const uncertain = !linkedKey && (learned.uncertain || isJiraUncertain(action));
  const badgeLink: JiraLink | undefined = linkedKey
    ? { key: linkedKey, createdAt: '' }
    : uncertain ? { uncertainSince: '' } : undefined;
  const baseUrl = status?.baseUrl ?? null;
  const offered = isFacilitator && jiraAvailability(status).state === 'ready' && isOpenForJira(action);

  // The keyboard moves only when it was on this control, or nowhere (a mouse
  // click in Safari focuses nothing): someone who tabbed on while a request
  // ran keeps their place.
  const keyboardIsHere = () => {
    const active = document.activeElement;
    return !active || active === document.body || !!rootRef.current?.contains(active);
  };

  const moveFocusTo = (target: FocusTarget) => {
    if (keyboardIsHere()) pendingFocus.current = target;
  };

  const settle = (actionId: string, next: Learned, say: string, focus?: FocusTarget) => {
    if (!mounted.current) return;
    if (focus) moveFocusTo(focus);
    setLearnedFor({ actionId, learned: next });
    setAnnouncement(say);
    // Again, for a keyboard that this answer brings back (the new link).
    setLingering(true);
  };

  const readOutcome = (actionId: string, outcome: CreateIssuesOutcome, wasUncertain: boolean) => {
    const result = outcome.results.find(r => r.actionId === actionId);
    const keep = { ...NOTHING_LEARNED, uncertain: wasUncertain };

    if (result && LINKING_STATUSES.has(result.status) && isJiraIssueKey(result.key)) {
      const key = result.key as string;
      if (result.status === 'created_not_saved') {
        // Said by the region, visibly: the next click would create it again.
        settle(actionId, { ...NOTHING_LEARNED, key, message: { key: 'jira.action.notSaved', params: { key } } }, '', 'badge');
      } else {
        const say = result.status === 'already_linked' ? t('jira.action.alreadyLinked', { key }) : t('jira.action.created', { key });
        settle(actionId, { ...NOTHING_LEARNED, key }, say, 'badge');
      }
      return;
    }
    if (result?.status === 'refused') {
      const jiraMessages = (result.jiraMessages ?? []).filter((m): m is string => typeof m === 'string' && m.trim() !== '');
      settle(actionId, {
        ...keep,
        message: { key: jiraMessages.length > 0 ? 'jira.action.refused' : 'jira.action.refusedNoMessage' },
        jiraMessages
      }, '');
      return;
    }
    const skipped = result ? SKIPPED_MESSAGES[result.status] : undefined;
    if (skipped) {
      settle(actionId, { ...keep, message: skipped }, '');
      return;
    }
    // Marked by the server, a result this client cannot read (a "created"
    // without a valid key), or the answer was lost: it may exist in Jira.
    if (result || outcome.unknown.includes(actionId) || outcome.stopped === 'outcome_unknown') {
      const message: Notice = result?.status === 'uncertain' ? { key: 'jira.action.uncertain' } : { key: 'jira.batch.outcomeUnknown' };
      settle(actionId, { ...NOTHING_LEARNED, uncertain: true, message }, '', 'primary');
      return;
    }
    if (outcome.stopped) {
      settle(actionId, { ...keep, message: { raw: outcome.stopped } }, '');
      if (isJiraStatusStaleCode(outcome.stopped)) onStatusStale?.();
      return;
    }
    settle(actionId, { ...keep, message: { raw: 'unknown_error' } }, '');
  };

  const create = async (force: boolean) => {
    const actionId = action.id;
    if (!offered || sending || jiraInFlight.has(actionId)) return;
    const wasUncertain = uncertain;
    setLingering(true);
    if (confirming) {
      setConfirming(false);
      moveFocusTo('primary');
    }
    setAnnouncement('');
    setLearnedFor({ actionId, learned: { ...learned, message: null, jiraMessages: [] } });

    jiraInFlight.add([actionId]);
    try {
      const outcome = await jiraService.createIssues(teamId, [actionId], {
        sessionId: kind === 'backlog' ? undefined : sessionId,
        requestedBy,
        language,
        force: force || undefined
      });
      readOutcome(actionId, outcome, wasUncertain);
      if (changesAction(outcome)) onCreated?.(outcome.results);
    } catch (err) {
      const code = err instanceof JiraServiceError ? err.code : 'unknown_error';
      settle(actionId, { ...NOTHING_LEARNED, uncertain: wasUncertain, message: { raw: code } }, '');
      if (isJiraStatusStaleCode(code)) onStatusStale?.();
    } finally {
      jiraInFlight.remove([actionId]);
    }
  };

  const askToForce = () => {
    if (!offered || sending) return;
    moveFocusTo('confirm');
    setConfirming(true);
  };

  const cancelForce = () => {
    moveFocusTo('primary');
    setConfirming(false);
  };

  if (!isFacilitator && !lingering) return <JiraLinkBadge link={action.jira} baseUrl={baseUrl} />;

  const hasRegion = offered || lingering || !!linkedKey;
  if (!hasRegion) return badgeLink ? <JiraLinkBadge link={badgeLink} baseUrl={baseUrl} /> : null;
  // Sending, or kept only for the keyboard: focusable, named, inert.
  const unavailable = sending || !offered;

  const hasMessage = !!learned.message;
  const region = (
    <div id={regionId} role="status" className={hasMessage ? 'basis-full text-xs text-slate-700' : 'sr-only'}>
      {hasMessage && (
        <>
          <span>{noticeText(learned.message, t)}</span>
          {learned.jiraMessages.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {learned.jiraMessages.map((message, index) => <li key={index}>{message}</li>)}
            </ul>
          )}
        </>
      )}
      {announcement && <span className="sr-only">{announcement}</span>}
    </div>
  );

  const buttonClass = `inline-flex items-center gap-1 rounded-md border border-indigo-300 bg-white px-2 py-0.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 aria-disabled:opacity-70 aria-disabled:hover:bg-white ${sending ? 'aria-disabled:cursor-wait' : 'aria-disabled:cursor-not-allowed'}`;
  const describedBy = hasMessage ? regionId : undefined;

  let body: React.ReactNode;
  if (linkedKey) {
    body = (
      <JiraLinkBadge link={badgeLink} baseUrl={baseUrl} focusRef={badgeRef} />
    );
  } else if (uncertain) {
    const checkUrl = jiraSearchUrl(baseUrl, { text, target: status?.target });
    body = (
      <>
        <JiraLinkBadge link={badgeLink} baseUrl={baseUrl} />
        {checkUrl && (
          <a
            href={checkUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('jira.action.checkLabel', { text })}
            className="text-xs font-semibold text-indigo-700 underline hover:text-indigo-900"
          >
            {t('jira.action.check')}
          </a>
        )}
        {confirming ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span id={questionId} className="text-xs text-slate-700">{t('jira.action.confirmForce')}</span>
            <button
              ref={confirmRef}
              type="button"
              onClick={() => { void create(true); }}
              aria-disabled={unavailable ? true : undefined}
              aria-label={t('jira.action.confirmForceYesLabel', { text })}
              aria-describedby={questionId}
              className={buttonClass}
            >
              {t('jira.action.confirmForceYes')}
            </button>
            <button
              type="button"
              onClick={cancelForce}
              className="rounded-md px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              {t('jira.action.cancel')}
            </button>
          </span>
        ) : (
          <button
            ref={primaryRef}
            type="button"
            onClick={askToForce}
            aria-disabled={unavailable ? true : undefined}
            aria-label={sending ? t('jira.action.creatingLabel', { text }) : t('jira.action.createAnywayLabel', { text })}
            aria-describedby={describedBy}
            className={buttonClass}
          >
            {sending ? t('jira.creating') : t('jira.action.createAnyway')}
          </button>
        )}
      </>
    );
  } else {
    body = (
      <button
        ref={primaryRef}
        type="button"
        onClick={() => { void create(false); }}
        aria-disabled={unavailable ? true : undefined}
        aria-label={sending ? t('jira.action.creatingLabel', { text }) : t('jira.action.createLabel', { text })}
        aria-describedby={describedBy}
        className={buttonClass}
      >
        <span className="material-symbols-outlined text-sm" aria-hidden="true">{sending ? 'sync' : 'add_task'}</span>
        {sending ? t('jira.creating') : t('jira.create')}
      </button>
    );
  }

  return (
    <div
      ref={rootRef}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setLingering(false);
      }}
      className="inline-flex flex-wrap items-center gap-2"
    >
      {body}
      {region}
    </div>
  );
};

export default JiraActionControl;
