import type { Language } from './i18n/languages';


export type Role = 'facilitator' | 'participant';

// Ephemeral "is typing" signal broadcast between session participants.
// 'brainstorm' = writing a ticket, 'proposal' = proposing an action in Discuss.
// Never persisted: it is a transient presence cue that auto-expires.
export type ParticipantActivity = 'brainstorm' | 'proposal';

export interface User {
  id: string;
  name: string;
  color: string;
  role: Role;
  email?: string;
  inviteToken?: string;
  joinedBefore?: boolean;
}

export interface Column {
  id: string;
  title: string;
  color: string;
  border: string;
  icon: string;
  text: string;
  ring: string;
  customColor?: string; // Optional hex color (e.g., '#6366F1') - overrides Tailwind classes
}

export interface TicketComment {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string; // ISO date
}

export interface Ticket {
  id: string;
  colId: string;
  text: string;
  authorId: string;
  groupId: string | null;
  votes: string[]; // Array of user IDs
  reactions?: Record<string, string[]>; // Emoji -> Array of UserIDs
  comments?: TicketComment[];
  // Column the ticket was written in, stamped when grouping moves it to a
  // different column. Keeps the original sentiment visible (e.g. a "went
  // well" card grouped under a "went wrong" topic) through Group, Vote,
  // Discuss and Review. Cleared when the ticket is explicitly re-homed by
  // dropping it directly on a column.
  originColId?: string;
}

export interface Group {
  id: string;
  title: string;
  colId: string;
  votes: string[];
  // Id of the drop-target ticket captured when the group was created. Keeps
  // the group at the position where it was created (where the ticket was
  // dropped) instead of moving it to the top of the column. Optional for
  // backward compatibility and for AI-suggested clusters, which fall back to
  // the earliest member ticket.
  anchorTicketId?: string;
}

// How much an action changed things for the team, as judged collectively once
// the action is closed. Deliberately 1-3 rather than ROTI's 1-5: the two ask
// different questions (did this action help / how did this session go), and a
// different scale is what stops them being read against each other.
export type ActionImpactScore = 1 | 2 | 3;

// 'abstain' is a cast vote, not a missing one: it completes a participant's
// round while staying out of every average, which is what keeps "this action
// was not about me" from landing as a middle score.
export type ActionImpactVote = ActionImpactScore | 'abstain';

export interface ActionItem {
  id: string;
  text: string;
  assigneeId: string | null;
  done: boolean;
  type: 'prev' | 'new' | 'proposal'; // 'proposal' needs validation
  rejected?: boolean; // Proposal rejected by the facilitator; reversible, never becomes a real action
  linkedTicketId?: string;
  proposalVotes: Record<string, 'up' | 'down' | 'neutral'>; // UserID -> Vote
  createdAt?: string; // ISO date; optional for backward compatibility with legacy actions
  originRetro?: string;
  contextText?: string;
  // ISO date stamped when `done` goes false -> true, cleared on re-open. Written
  // only by the granular action paths (a session blob carries no reliable
  // closing moment). Absent on every action closed before this feature shipped,
  // which is exactly what keeps the historical backlog out of the rating round.
  closedAt?: string;
  // userId -> vote. Written one key at a time by /api/team/:teamId/action/impact
  // so concurrent voters cannot overwrite each other; never removed wholesale by
  // any other write path.
  impactRatings?: Record<string, ActionImpactVote>;
  // Id of the retro whose facilitator pressed "Rate later". The action is put to
  // the team again by the retro that follows that one, and only that one.
  impactDeferredBy?: string;
  // The Jira issue created from this action, or the mark of a creation whose
  // answer was lost. Written only by the Jira route; see JiraLink.
  jira?: JiraLink;
}

// ==================== JIRA ====================
// The shared rules (what a key, an address and a target are) live in
// utils/jira.js; the issue content in utils/jiraIssueContent.js.

/**
 * What an action knows about its Jira issue: a key, never a URL. `actions` is
 * not a protected session field, so any participant's write can put anything
 * here; a screen builds the href from the configured base URL and a key that
 * passes `isJiraIssueKey` (`jiraBrowseUrl`), and a stored URL would be a link
 * anyone could plant. `uncertainSince` marks a creation that was sent and whose
 * answer was lost: the issue may exist, so it is never created again without
 * the facilitator confirming.
 */
export type JiraLink = { key: string; createdAt: string } | { uncertainSince: string };

/**
 * Where a team's issues are created: in a project, as sub-tasks of one parent
 * issue (whose project is read from Jira), or as sub-tasks of one parent issue
 * per retrospective or health check, created in a project the first time one
 * of its actions is sent (`sessionParent`; the team dashboard's actions share
 * one parent for the whole team). `projectKey` is present in `project` and
 * `sessionParent` modes, `parentKey` in `parent` mode only, and
 * `parentIssueTypeId` in `sessionParent` mode only; `labels` may be empty.
 * Validated by `validateJiraTarget` on both sides of the wire.
 */
export interface JiraTarget {
  mode: 'project' | 'parent' | 'sessionParent';
  projectKey?: string;
  parentKey?: string;
  /** `sessionParent` only: the standard type of the parent issue created per session. */
  parentIssueTypeId?: string;
  /** The type of each action's issue: a sub-task type in `parent` and `sessionParent` modes. */
  issueTypeId: string;
  /** On every issue created, parent issues included. */
  labels: string[];
}

/**
 * A session's parent issue in `sessionParent` mode: its key and the sub-task
 * type recorded for it (the type its sub-tasks are created with when the
 * parent is in another project than the target's), or the mark of a parent
 * creation whose answer was lost — the parent may exist, so it is never
 * created again without the facilitator confirming that scope
 * (`forceParentScopes`). A key, never a URL, like `JiraLink`.
 */
export type JiraParentLink =
  | { key: string; createdAt: string; subtaskTypeId?: string }
  | { uncertainSince: string };

/** `retro:<id>`, `healthcheck:<id>`, or `backlog` for actions with no session (`isJiraParentScope`). */
export type JiraParentScope = string;

/** Why a stored Jira token cannot be used: the Jira address changed, or it no longer decrypts. */
export type JiraTokenReason = 'address_changed' | 'unreadable' | null;

/** `/api/team/:teamId/jira/status`. Never calls Jira, and never carries the token. */
export interface JiraStatus {
  enabled: boolean;
  /** Returned whenever an address is configured, even when `enabled` is false. */
  baseUrl: string | null;
  target: JiraTarget | null;
  token: {
    configured: boolean;
    usable: boolean;
    reason: JiraTokenReason;
    connectedAs: string | null;
    deploymentType: 'Cloud' | 'Server' | null;
    setAt: string | null;
    refusedAt: string | null;
  };
}

/** What became of one action in a `/jira/issues` request. */
export type JiraIssueStatus =
  | 'created'
  | 'already_linked'
  | 'uncertain'
  | 'in_progress'
  | 'closed'
  | 'not_found'
  | 'refused'
  | 'created_not_saved'
  // `sessionParent` mode: nothing was sent for the action, because its parent
  // issue may already be in Jira (a lost answer), is being created by another
  // request right now, or was refused by Jira (with Jira's words). Never read
  // as "may already be in Jira" for the action itself.
  | 'parent_uncertain'
  | 'parent_in_progress'
  | 'parent_refused';

export interface JiraIssueResult {
  actionId: string;
  status: JiraIssueStatus;
  key?: string;
  /**
   * On `created` and `created_not_saved` in both sub-task modes: the parent
   * issue the action's issue was created under.
   */
  parentKey?: string;
  /** Jira's own messages for a refused creation, shown as Jira wrote them. */
  jiraMessages?: string[];
  /**
   * The fields a refusal named (the keys of Jira's `errors`): `labels` says
   * the target's labels are not accepted, which the screens explain.
   */
  jiraFields?: string[];
  /**
   * Set on a `refused` the server made itself, without calling Jira:
   * `no_text`, the action has no text to make a summary of. A refusal Jira
   * gave without words (a gateway's page, an empty `errors` object) has no
   * messages and no reason, and is Jira's.
   */
  reason?: 'no_text';
}

/** Why a `/jira/issues` request stopped before its last action. */
export type JiraStopCode =
  | 'token_refused'
  | 'jira_forbidden'
  | 'jira_not_found'
  | 'jira_rate_limited'
  | 'jira_unavailable'
  | 'jira_unreachable'
  | 'link_not_saved'
  | 'server_restarting'
  | 'client_gone'
  | 'jira_parent_invalid'
  // Jira refused a field the target sets (labels, issue type, project,
  // parent): every action would be refused the same way, so one was sent.
  | 'jira_target_refused'
  // Jira refused to create a parent issue (`sessionParent` mode): the same
  // type, project and labels go on every parent, so the batch stops there.
  | 'jira_parent_refused';

/** What became of one scope's parent issue in a `/jira/issues` request (`sessionParent` mode). */
export type JiraParentStatus =
  // The scope's parent was created: by this request, or by a rival request
  // whose key won (this request's issue is then logged as a duplicate).
  | 'created'
  // The parent named for this send became the scope's parent, in the write
  // that stored a sub-task created under it.
  | 'adopted'
  // The scope's parent may exist: this request set the mark, or found it.
  | 'uncertain'
  // Another request is creating it right now.
  | 'in_progress'
  // Jira refused to create it, with Jira's words.
  | 'refused'
  // It was created and its key could not be stored: `key` is given so the
  // facilitator can name it as the parent next time.
  | 'not_saved';

export interface JiraParentResult {
  /** `isJiraParentScope`: `retro:<id>`, `healthcheck:<id>` or `backlog`. */
  scope: JiraParentScope;
  status: JiraParentStatus;
  key?: string;
  uncertainSince?: string;
  jiraMessages?: string[];
  jiraFields?: string[];
}

export interface JiraIssuesResponse {
  /** One entry per action attempted, in order. */
  results: JiraIssueResult[];
  /** The actions not attempted (time budget, a stop, shutdown, client gone). */
  remaining: string[];
  stopped?: JiraStopCode;
  retryAfterSeconds?: number;
  /**
   * One entry per scope whose parent issue this request created, adopted,
   * found uncertain or in progress, or could not create or save, in the order
   * met. Absent when there is none (and from a pod of an older release).
   */
  parents?: JiraParentResult[];
}

export interface JiraIssueType {
  id: string;
  name: string;
  subtask: boolean;
  /** Jira Cloud only: −1 for a sub-task, 0 for a standard issue, 1 and above for an epic and higher. */
  hierarchyLevel?: number;
}

// The countdown both session types carry (utils/sessionTimer.ts reads and writes
// it, components/session/SessionTimer.tsx shows it). Nothing is written per
// tick: every client derives the remaining time from `timerStartedAt`, so the
// names and meanings below are a wire contract with the clients of the
// previous release during a rolling update.
export interface SessionTimerSettings {
  timerSeconds: number; // Remaining time while stopped (0 once it ran out)
  timerRunning: boolean;
  timerInitial: number; // Length of the current run (the remaining time when it was started)
  timerStartedAt?: number; // Unix timestamp when timer was started (for sync)
  timerAcknowledged?: boolean;
}

export interface RetroSettings extends SessionTimerSettings {
  isAnonymous: boolean;
  maxVotes: number;
  oneVotePerTicket: boolean;
  revealBrainstorm: boolean;
  revealHappiness: boolean;
  revealRoti: boolean;
  // Impact votes on closed actions stay hidden until the facilitator reveals
  // them, exactly like ROTI. Actions carry a named assignee, so an open vote
  // would be uniformly flattering and therefore worthless.
  revealActionImpact?: boolean;
  participantsPanelCollapsed?: boolean; // Whether participants panel is collapsed
  colorBy?: 'author' | 'topic'; // Color post-its by author or by topic/column
  showParticipantVotes?: boolean; // Show individual vote types in proposal vote tooltip
}

// A teammate the facilitator invited by email while the session was open.
// Kept on the session so the participants panel can show who is still
// expected to join (and who was already invited) before everyone arrives.
export interface SessionInvitee {
  id: string; // Team member id (invites upsert the member into the team)
  name: string;
  email?: string;
  invitedAt?: string; // ISO date
}

/**
 * Optimistic-concurrency metadata the server stamps on every persisted
 * session. `update-session` compares `_rev` and rejects a write that was built
 * on a stale revision, so this field carries the session-sync CAS protocol —
 * it is not incidental bookkeeping. Keeping it on the type means a refactor
 * that drops the stamp from a spread fails `type-check` instead of silently
 * degrading the CAS into last-write-wins.
 *
 * Optional because a session exists client-side before the server has ever
 * stamped it; an absent `_rev` means revision 0.
 */
export interface RevisionStamped {
  /** Server-assigned revision. Absent means "never persisted" (0). */
  _rev?: number;
  /** ISO date of the last accepted server write. */
  _updatedAt?: string;
}

export interface RetroSession extends RevisionStamped {
  id: string;
  teamId: string;
  name: string;
  date: string;
  status: 'IN_PROGRESS' | 'CLOSED';
  // One of the guided phases, or `OPEN_BOARD` for an open board: every card
  // activity on one screen, no phases, never closed (utils/openBoard.ts).
  phase: string;
  // The guided phase a retro was at when the facilitator turned it into an
  // open board, and where turning it back resumes. Absent on a board created
  // open, and on every guided retro. Facilitator-only, like `phase`.
  guidedPhase?: string;
  participants?: User[];
  // Participants marked by the facilitator as having left mid-session
  // (emergency, other commitment...). They stay visible in the participants
  // panel but are excluded from every "waiting for votes" counter.
  leftUsers?: string[];
  // Teammates invited by email from this session, shown as "waiting to join"
  // in the participants panel until they actually connect.
  invitedUsers?: SessionInvitee[];
  discussionFocusId?: string | null;
  discussionNextTopicVotes?: Record<string, string[]>; // topic ID -> array of user IDs who voted next
  icebreakerQuestion: string;
  columns: Column[];
  // Language the facilitator chose for the template when starting the retro —
  // independent of anyone's interface language. Column titles and the default
  // icebreaker were created in it, and "Random" keeps drawing questions from it.
  // Absent on retros created before it existed, which were all English.
  templateLanguage?: Language;
  settings: RetroSettings;
  tickets: Ticket[];
  groups: Group[];
  actions: ActionItem[];
  openActionsSnapshot?: ActionItem[];
  historyActionsSnapshot?: ActionItem[];
  // The closed actions this session put to the team for rating. Persisted with
  // the retro, which is what makes it the record of what has already been asked
  // — no stamp on the action, and nothing to lose if the facilitator moves fast.
  closedActionsSnapshot?: ActionItem[];
  // actionId -> userId -> vote. Live mirror of the team record so every screen
  // updates during the round; the action record stays authoritative.
  actionImpactVotes?: Record<string, Record<string, ActionImpactVote>>;
  reviewSummary?: string;
  happiness: Record<string, number>;
  roti: Record<string, number>;
  finishedUsers: string[]; // List of user IDs who clicked "I'm finished"
  autoFinishedUsers?: string[]; // Tracks which users were auto-finished due to using all votes
}

export interface FeedbackComment {
  id: string;
  feedbackId: string;
  teamId: string;
  teamName: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string; // ISO date
  isAdmin?: boolean; // true if comment is from super admin
}

export interface TeamFeedback {
  id: string;
  teamId: string;
  teamName: string; // For display in super admin
  type: 'bug' | 'feature';
  title: string;
  description: string;
  images?: string[]; // Base64 encoded images
  submittedBy: string; // Facilitator user ID
  submittedByName: string; // Name for display
  submittedAt: string; // ISO date
  isRead: boolean; // For unread indicator
  status: 'pending' | 'in_progress' | 'resolved' | 'rejected';
  comments?: FeedbackComment[]; // Comments from teams and admins
  submissionId?: string; // One per draft, so a retry whose first answer was lost is not stored twice
}

export interface Team {
  id: string;
  name: string;
  passwordHash: string;
  facilitatorEmail?: string; // Email for password recovery (separate from participant emails)
  members: User[];
  archivedMembers?: User[];
  customTemplates: { name: string; cols: Column[] }[];
  retrospectives: RetroSession[];
  globalActions: ActionItem[];
  // Health checks
  healthChecks?: HealthCheckSession[];
  customHealthCheckTemplates?: HealthCheckTemplate[];
  lastConnectionDate?: string;
  // No `teamFeedbacks`: the record stores them, but the server leaves them out
  // of every team answer and the Feedback Hub reads `/api/feedbacks/all`. The
  // field is absent here so no screen can start reading data that never comes.
  // Impact rating on closed actions. Absent means enabled: the feature ships on
  // for everyone, and a team that does not want it turns it off here once.
  actionImpactRatingEnabled?: boolean;
  // ISO date the facilitator dismissed the one-time explanation banner. Stored
  // on the team rather than in localStorage because the setting it points at is
  // team-scoped and facilitator-only: once per team, not once per browser.
  actionImpactNoticeDismissedAt?: string;
  // The teams a super-admin merge built this one from. Only the super-admin
  // team list carries it; the server strips it from every team-side answer.
  mergedFrom?: TeamMergeSource[];
  // Where this team's Jira issues are created. A team setting written only by
  // /api/team/:teamId/jira/target; /update ignores it. (The claims the server
  // keeps on actions being created are server-only and not typed here.)
  jiraTarget?: JiraTarget;
  // The parent issue of each retrospective, health check and of the team
  // dashboard's actions in `sessionParent` mode, keyed by `JiraParentScope`.
  // Written only by /api/team/:teamId/jira/issues; /update ignores it. (The
  // claims on parents being created are server-only and not typed here.)
  jiraParents?: Record<JiraParentScope, JiraParentLink>;
}

export interface TeamMergeSource {
  teamId: string;
  name: string;
  mergedAt?: string;
  /** The merge signed this entry; an unsigned one is shown, never trusted. */
  verified?: boolean;
}

export interface TeamSummary {
  id: string;
  name: string;
  memberCount: number;
  lastConnectionDate?: string;
}

export interface Template {
    name: string;
    cols: Column[];
}

// ==================== HEALTH CHECK TYPES ====================

export interface HealthCheckDimension {
  id: string;
  name: string;
  goodDescription: string;
  badDescription: string;
}

export interface HealthCheckTemplate {
  id: string;
  name: string;
  dimensions: HealthCheckDimension[];
  isDefault?: boolean;
}

export interface HealthCheckRating {
  odimensionId: string;
  rating: number; // 1-5
  comment?: string;
}

// The timer fields are optional: health checks stored before they had a timer
// carry none, and read as stopped at the current phase's default.
export interface HealthCheckSettings extends Partial<SessionTimerSettings> {
  isAnonymous: boolean;
  revealRoti: boolean;
  // Legacy: the panel used to be collapsed for everyone through the session.
  // It is now local to each browser, as in a retro; older clients may still
  // write this during a rolling update, and nothing reads it any more.
  participantsPanelCollapsed?: boolean;
  showParticipantVotes?: boolean; // Show individual vote types in proposal vote tooltip
}

export interface HealthCheckSession extends RevisionStamped {
  id: string;
  teamId: string;
  name: string;
  date: string;
  status: 'IN_PROGRESS' | 'CLOSED';
  phase: 'SURVEY' | 'DISCUSS' | 'REVIEW' | 'CLOSE';
  templateId: string;
  templateName: string;
  dimensions: HealthCheckDimension[];
  participants?: User[];
  // Shared with RetroSession: participants marked by the facilitator as having
  // left mid-session, and teammates invited by email who have not joined yet.
  // The participants panel and the invite modal are the same components for
  // both session types, so both record the same state.
  leftUsers?: string[];
  invitedUsers?: SessionInvitee[];
  settings: HealthCheckSettings;
  // Ratings: userId -> dimensionId -> { rating, comment }
  ratings: Record<string, Record<string, { rating?: number; comment?: string }>>;
  // Actions created during this session
  actions: ActionItem[];
  // Discussion focus
  discussionFocusId?: string | null;
  // ROTI for close phase
  roti: Record<string, number>;
  // Track who has finished each phase
  finishedUsers: string[];
}

// ==================== ANNOUNCEMENT TYPES ====================

export type AnnouncementType = 'feature' | 'improvement' | 'fix' | 'security' | 'removed';

export interface AnnouncementItem {
  type: AnnouncementType;
  description: string;
}

export interface VersionAnnouncement {
  version: string;
  date: string;
  // The release notes as written in CHANGELOG.md, in English.
  items: AnnouncementItem[];
  // The same release in other interface languages (CHANGELOG.fr.md for
  // French). Absent for a release with no translation, and from a server that
  // predates translated release notes — `items` is what to show then.
  localized?: Partial<Record<Language, { items: AnnouncementItem[] }>>;
}

export interface AppVersion {
  current: string;
  announcements: VersionAnnouncement[];
}

// ==================== GLOBAL SETTINGS ====================

export interface AiSettings {
  enabled: boolean;
  apiUrl: string; // OpenAI-compatible API base URL (e.g. https://codeia.dev.etat-ge.ch/v1)
  apiKey?: string; // Optional API key for authentication
  model?: string; // Optional model name override
  allowSelfSignedCerts?: boolean; // Allow self-signed TLS certificates (for internal servers)
}

export interface GlobalSettings {
  infoMessage?: string; // Global info message displayed on team selection and dashboard
  adminEmail?: string; // Email address for admin notifications (feedback alerts)
  notifyNewTeam?: boolean; // Send email notification to admin when a new team is created
  ai?: AiSettings; // AI/LLM configuration for automatic suggestions
}

// ==================== ACTIVE SESSIONS (LIVE MONITORING) ====================

export interface ActiveSessionMember {
  id: string;
  name: string;
}

export interface ActiveSession {
  sessionId: string;
  type: 'retrospective' | 'healthcheck';
  teamId: string;
  teamName: string;
  sessionName: string;
  phase: string;
  status: 'IN_PROGRESS' | 'CLOSED';
  participants: ActiveSessionMember[];
  connectedCount: number;
  startedAt?: string;
}

// ==================== SERVER LOGS ====================

export type LogLevel = 'error' | 'warn' | 'info';
export type LogSource = 'postgres' | 'server' | 'socket' | 'email';

export interface ServerLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  details?: string;
  /**
   * The request or socket this record belongs to (audit H44). Optional because
   * a line logged at startup, or by a background task, belongs to no request.
   */
  correlationId?: string;
}

// ==================== BACKUP TYPES ====================

export type BackupType = 'auto' | 'manual' | 'startup' | 'imported';

/** Upload limits `/api/super-admin/backups/list` reports (absent from pods before 41.0). */
export interface BackupLimits {
  /** RESTORE_MAX_BODY_MB, in bytes: the largest file the server accepts. */
  maxArchiveBytes: number;
  /** RESTORE_MAX_DECOMPRESSED_MB, in bytes: the largest an archive may unpack to. */
  maxUnpackedBytes: number;
}

export interface BackupEntry {
  id: string;
  filename: string;
  type: BackupType;
  label?: string;
  createdAt: string;
  sizeBytes: number;
  teamCount: number;
  protected: boolean;
}
