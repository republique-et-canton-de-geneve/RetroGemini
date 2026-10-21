import type { ActionItem } from '../../types';
import { issueFields, issueSource } from '../../utils/jiraIssueContent.js';
import type { JiraActionKind } from './jiraAvailability';

/** A retrospective or a health check, as much of it as the preview reads. */
export interface PreviewSession {
  id?: string;
  actions?: ActionItem[];
}

/** The team record, as much of it as the preview reads. */
export interface PreviewTeam {
  retrospectives?: PreviewSession[];
  healthChecks?: PreviewSession[];
  globalActions?: ActionItem[];
}

/**
 * The team as the server will read it once this screen's writes have landed:
 * the live session on screen in place of the cached copy of it. The batch
 * waits for every queued write before it sends (`dataService.whenPersisted`),
 * so the record the server builds the issue from holds what the screen shows;
 * the cached team a screen was handed can be older than its live session.
 *
 * A session the cached team does not hold yet goes first, where a new session
 * goes on the record.
 */
export const withLiveSession = <T extends PreviewTeam>(
  team: T | null | undefined,
  session: PreviewSession | null | undefined,
  kind: JiraActionKind
): T | null | undefined => {
  if (!team || !session || kind === 'backlog' || typeof session.id !== 'string') return team;
  const list = kind === 'retro' ? 'retrospectives' : 'healthChecks';
  const entries = team[list] ?? [];
  const index = entries.findIndex(entry => entry?.id === session.id);
  const next = index === -1 ? [session, ...entries] : entries.map((entry, i) => (i === index ? session : entry));
  return { ...team, [list]: next };
};

/**
 * What the issue of one action will say, for the confirmation dialog: built as
 * the server builds it (`issueSource`, then `issueFields`), from the same
 * session the request names, so the preview is exactly what Jira receives.
 *
 * `action` is the copy the screen lists; it is used only when the team holds
 * no copy of the action, which the server would answer `not_found` anyway.
 */
export const jiraIssuePreview = ({
  action,
  team,
  session,
  kind,
  sessionId,
  requestedBy,
  language
}: {
  action: ActionItem;
  team: PreviewTeam | null | undefined;
  session?: PreviewSession | null;
  kind: JiraActionKind;
  /** The session the request names: none for a backlog action, as the request sends none. */
  sessionId?: string;
  requestedBy: string;
  language: string;
}): { summary: string; description: string; language: 'en' | 'fr' } => {
  const readTeam = withLiveSession(team, session, kind);
  const source = issueSource({
    team: readTeam,
    actionId: action.id,
    preferredSessionId: kind === 'backlog' ? undefined : sessionId
  });
  return issueFields({
    action: source.action ?? action,
    session: source.session,
    kind: source.kind,
    team: readTeam,
    requestedBy,
    language
  });
};
