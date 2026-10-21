import type { ActionItem, JiraParentLink } from '../../types';
import { isJiraIssueKey } from '../../utils/jira.js';
import { issueFields, issueSource, jiraParentScope, parentIssueFields } from '../../utils/jiraIssueContent.js';
import type { JiraActionKind } from './jiraAvailability';

/** A retrospective or a health check, as much of it as the preview reads. */
export interface PreviewSession {
  id?: string;
  name?: string;
  actions?: ActionItem[];
}

/** The team record, as much of it as the preview reads. */
export interface PreviewTeam {
  /** The team dashboard's parent issue is titled after the team. */
  name?: string;
  retrospectives?: PreviewSession[];
  healthChecks?: PreviewSession[];
  globalActions?: ActionItem[];
  /** The parent issue of each session in `sessionParent` mode, as this browser last read it. */
  jiraParents?: Record<string, JiraParentLink>;
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

/**
 * One row of the batch dialog's parent issues (`sessionParent` mode): a
 * retrospective, a health check or the team dashboard (`backlog`) whose
 * actions are sent, and what its parent issue is.
 *
 *  - `existing`: the key the team record holds; the actions go under it;
 *  - `uncertain`: a creation whose answer was lost — the parent may exist, so
 *    nothing is sent for those actions unless the facilitator names it or
 *    confirms a new one. `searchText` is the title it would have had, to look
 *    for in Jira;
 *  - `new`: the title it is created with (`parentIssueFields`, the builder the
 *    server uses) and that title's language.
 */
export interface JiraParentPreview {
  scope: string;
  kind: JiraActionKind;
  /** The session's name as the record holds it; null for the team dashboard. */
  sessionName: string | null;
  /** The actions of the send that go under it, in the dialog's order. */
  actionIds: string[];
  parent:
    | { state: 'existing'; key: string }
    | { state: 'uncertain'; since: string; searchText: string }
    | { state: 'new'; summary: string; language: 'en' | 'fr' };
}

/**
 * The parent issue each action of a send goes under, grouped by scope in the
 * order the dialog lists the actions: built as the server decides it, from
 * the same team (the live session in place of its cached copy) and the same
 * session the request names. `issueSource` homes each action — a previous
 * action shown in a later retro goes under the parent of the retro it comes
 * from — and `jiraParentScope` names its scope.
 *
 * What it cannot promise: it reads this browser's copy of the team. A parent
 * created from another browser since is reused by the server, never created
 * twice, and the results name it; so a row can say `new` where the server
 * reuses one, never the reverse. An action the team holds no copy of goes
 * under no parent: the server answers it `not_found` first.
 */
export const jiraParentPreviews = ({
  actions,
  team,
  session,
  kind,
  sessionId,
  requestedBy,
  language
}: {
  actions: ActionItem[];
  team: PreviewTeam | null | undefined;
  session?: PreviewSession | null;
  kind: JiraActionKind;
  /** The session the request names: none for a backlog action, as the request sends none. */
  sessionId?: string;
  requestedBy: string;
  language: string;
}): JiraParentPreview[] => {
  const readTeam = withLiveSession(team, session, kind);
  const parents = readTeam?.jiraParents && typeof readTeam.jiraParents === 'object' ? readTeam.jiraParents : {};
  const rows = new Map<string, JiraParentPreview>();
  for (const action of actions) {
    const source = issueSource({
      team: readTeam,
      actionId: action.id,
      preferredSessionId: kind === 'backlog' ? undefined : sessionId
    });
    if (!source.action) continue;
    const scope = jiraParentScope(source);
    const row = rows.get(scope.key);
    if (row) {
      if (!row.actionIds.includes(action.id)) row.actionIds.push(action.id);
      continue;
    }
    const held = Object.prototype.hasOwnProperty.call(parents, scope.key) ? parents[scope.key] as Record<string, unknown> : null;
    const fields = () => parentIssueFields({ scope, team: readTeam, requestedBy, language });
    let parent: JiraParentPreview['parent'];
    if (held && isJiraIssueKey(held.key)) parent = { state: 'existing', key: held.key as string };
    else if (held && typeof held.uncertainSince === 'string') parent = { state: 'uncertain', since: held.uncertainSince, searchText: fields().summary };
    else {
      const built = fields();
      parent = { state: 'new', summary: built.summary, language: built.language };
    }
    const name = scope.session && typeof (scope.session as PreviewSession).name === 'string' ? (scope.session as PreviewSession).name as string : null;
    rows.set(scope.key, { scope: scope.key, kind: scope.kind, sessionName: scope.kind === 'backlog' ? null : name, actionIds: [action.id], parent });
  }
  return [...rows.values()];
};
