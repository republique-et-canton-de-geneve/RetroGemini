import React, { useEffect, useId, useRef, useState } from 'react';
import type { ActionItem, JiraStatus } from '../../types';
import { isJiraLinked, isJiraUncertain } from '../../utils/jira.js';
import type { CreateIssuesOutcome } from '../../services/jiraService';
import { useTranslation } from '../../i18n/I18nContext';
import JiraReasonLine from './JiraReasonLine';
import JiraBatchDialog from './JiraBatchDialog';
import { useJiraInFlight } from './jiraInFlight';
import { isOpenForJira, jiraAvailability, type JiraActionKind } from './jiraAvailability';

type DialogProps = React.ComponentProps<typeof JiraBatchDialog>;

interface Props {
  /** The actions the screen lists; the button counts the ones it can send. */
  actions: ActionItem[];
  status: JiraStatus | null | undefined;
  teamId: string;
  isFacilitator: boolean;
  /** The live session the screen shows, so the server patches its row too (finding A-5). */
  sessionId?: string;
  kind: JiraActionKind;
  /** The team record the preview reads (contexts, previous retros, the content language). */
  team: DialogProps['team'];
  /** The retrospective or health check the screen shows, if any. */
  session?: DialogProps['session'];
  /** Who clicked, named in each issue's description. */
  requestedBy: string;
  /** After a batch, whatever its outcome: refresh the screen (finding A-6). */
  onDone?: (outcome: CreateIssuesOutcome) => void;
  /** After an answer saying the status the screen holds is out of date. */
  onStatusStale?: () => void;
}

/**
 * "Create in Jira (N)": every listed action that is open, has no issue, is not
 * in doubt and is not being sent right now — the actions this click would
 * really send. Facilitators only, and only on a deployment with Jira.
 *
 * When the team cannot create (no token, a token to enter again or that Jira
 * refused, no target), the button stays visible and reachable by keyboard,
 * marked unavailable with `aria-disabled` rather than `disabled` (which would
 * take it out of the tab order), and it is described by the reason note
 * under it, which says what to fix in Settings → Jira (finding U-1).
 *
 * Layout, the same at its three sites (the Dashboard's Actions tab and both
 * Review steps): the button is first and docked to the right edge of its row
 * from `sm` up (`sm:ml-auto sm:items-end`, which also holds when the column
 * wraps onto a line of its own); the note hangs under it, right-aligned with
 * it and at most 24rem wide, and never moves it. The column used to be as
 * wide as the sentence with the button at its left edge, so the button landed
 * wherever the sentence started, lined up with nothing (the maintainer's
 * "décale tout et c'est moche"). On a phone it is a left-aligned stack. With
 * nothing to send, the note stands alone in the button's place: per-action
 * controls render nothing while creation is blocked, so it is the only thing
 * saying why there is no Jira control.
 *
 * With nothing left to send it disappears — except after a batch it ran
 * itself: then it stays, unavailable, so that closing the dialog gives the
 * keyboard back to it instead of to the page (the dialog returns focus to its
 * opener only while the opener is still there).
 *
 * An open dialog outlives the conditions that offered it. A batch refused
 * because the administrator turned Jira off makes the screen read the status
 * again, and the facilitator role can move to someone else while a batch
 * runs; either way the request has run and its results — which issues exist
 * now, what was not sent — must stay readable until Close. The dialog keeps
 * a status to read (the latest one, or the one it was opened with), and the
 * button stays, unavailable, for the keyboard to come back to, until the
 * keyboard leaves it.
 */
const JiraBatchButton: React.FC<Props> = ({
  actions,
  status,
  teamId,
  isFacilitator,
  sessionId,
  kind,
  team,
  session,
  requestedBy,
  onDone,
  onStatusStale
}) => {
  const { tp } = useTranslation();
  const inFlight = useJiraInFlight();
  const reasonId = useId();
  const [dialogActions, setDialogActions] = useState<ActionItem[] | null>(null);
  const [ranOnce, setRanOnce] = useState(false);
  // Set when a dialog closes on a screen that no longer offers the button.
  const [lingering, setLingering] = useState(false);
  // The status the dialog was opened with, for a screen that reads none since
  // (a team switch); any status read since is newer, Jira off included.
  const [openedWith, setOpenedWith] = useState<JiraStatus | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The dialog gives the keyboard back before this runs (its cleanup comes
  // first). When it went elsewhere — the dialog was opened by a click that
  // focused nothing — nothing holds the button there any more.
  useEffect(() => {
    if (lingering && document.activeElement !== buttonRef.current) setLingering(false);
  }, [lingering]);

  const availability = jiraAvailability(status);
  const offered = isFacilitator && availability.state !== 'off' && !!status;
  if (!offered && dialogActions === null && !lingering) return null;

  const seen = new Set<string>();
  const sendable = actions.filter(action => {
    if (!action || seen.has(action.id)) return false;
    seen.add(action.id);
    return isOpenForJira(action) && !isJiraLinked(action) && !isJiraUncertain(action) && !inFlight.has(action.id);
  });

  const blocked = offered && availability.state === 'blocked';
  const showButton = !offered || sendable.length > 0 || ranOnce || dialogActions !== null;
  if (!blocked && !showButton) return null;
  const unavailable = !offered || blocked || sendable.length === 0 || dialogActions !== null;
  const dialogStatus = status ?? openedWith;

  return (
    <div className="flex max-w-full flex-col items-start gap-1.5 sm:ml-auto sm:max-w-sm sm:items-end">
      {showButton && (
        <button
          ref={buttonRef}
          type="button"
          aria-disabled={unavailable ? true : undefined}
          aria-describedby={blocked ? reasonId : undefined}
          onClick={() => {
            if (unavailable) return;
            setDialogActions(sendable);
            setOpenedWith(status);
            setRanOnce(true);
          }}
          onBlur={() => setLingering(false)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:bg-white"
        >
          {/* `!`: the unlayered `.material-symbols-outlined` rule in index.css
              (24px) beats plain utilities; 18px keeps the button at the
              filter pills' 34px. `leading-none` stops the important size
              bringing its own line-height. */}
          <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">add_task</span>
          {tp('jira.createCount', sendable.length)}
        </button>
      )}
      {blocked && status && <JiraReasonLine id={reasonId} status={status} isFacilitator />}
      {dialogActions && dialogStatus && (
        <JiraBatchDialog
          actions={dialogActions}
          status={dialogStatus}
          teamId={teamId}
          sessionId={sessionId}
          kind={kind}
          team={team}
          session={session}
          requestedBy={requestedBy}
          onClose={() => {
            setDialogActions(null);
            if (!offered) setLingering(true);
          }}
          onDone={(outcome) => onDone?.(outcome)}
          onStatusStale={onStatusStale}
        />
      )}
    </div>
  );
};

export default JiraBatchButton;
