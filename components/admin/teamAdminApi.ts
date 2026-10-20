import type { Notice } from '../../i18n/notice';
import type { MessageKey } from '../../i18n/translate';
import { PASSWORD_MIN_LENGTH } from '../../utils/passwordPolicy.js';
import { TEAM_NAME_MAX_LENGTH } from '../../utils/teamNamePolicy.js';

/**
 * The super-admin team merge and team deletion, as the console calls them
 * (`server/routes/superAdminTeamMergeRoutes.js`). Answers are returned as data
 * plus a `Notice` naming what went wrong — never a translated sentence, so a
 * message on screen follows the language switcher (`i18n/notice.ts`).
 */

export type MergeRole = 'primary' | 'secondary';

export interface MergeCounts {
  members: number;
  archivedMembers: number;
  retrospectives: number;
  healthChecks: number;
  globalActions: number;
  customTemplates: number;
  customHealthCheckTemplates: number;
  feedbacks: number;
}

export interface MergeReport {
  sources: { role: MergeRole; id: string; name: string; counts: MergeCounts }[];
  merged: MergeCounts;
  members: {
    unified: { fromId: string; fromName: string; intoId: string; intoName: string; reason: 'facilitator' | 'email' | 'name' }[];
    keptSameName: { name: string; secondaryId: string; reason: 'ambiguous' | 'email_conflict' | 'already_unified' }[];
    reminted: { name: string; fromId: string; toId: string }[];
    mintedFacilitator: boolean;
    sharedEmails: { email: string; names: string[] }[];
    /** Member records that could not be read, copied as they are. */
    malformed: number;
  };
  actions: { reminted: number };
  templates: { renamed: { kind: string; from: string; to: string }[]; deduplicated: number; reminted: number };
  sessions: {
    inProgress: { source: MergeRole; name: string }[];
    freshened: { source: MergeRole; name: string }[];
    /** Retro ids one team holds twice: links to them follow the first copy. */
    ambiguousRetroIds: string[];
  };
  /** Top-level fields this release does not know; `conflicting` kept the main team's value. */
  unknownKeys: { carried: string[]; conflicting: string[] };
  feedbacksToMoveOnDelete: { primary: number; secondary: number };
  settings: { actionImpactRatingEnabled: boolean; actionImpactNoticeDismissed: boolean };
  conflicts: unknown[];
}

export interface MergePreview {
  report: MergeReport;
  /** `null` when the server could not list the open sessions. */
  liveSessions: { source: MergeRole; id: string; name: string }[] | null;
  /** Sent back with the merge, which refuses a plan the admin has not seen. */
  fingerprints: { primary: string; secondary: string };
  defaults: {
    name: string;
    emails: { primary: string | null; secondary: string | null };
    passwordSources: { primary: boolean; secondary: boolean };
  };
}

export type PasswordSource = MergeRole | 'new';

/** Why a deletion needs the admin's acknowledgment (`/api/super-admin/delete-team`). */
export type DeleteReason =
  | 'source_changed'
  | 'merge_unverified'
  | 'merged_team_changed'
  | 'sources_deleted'
  | 'sessions_open'
  | 'sessions_unknown';

/** One part of a merge source that changed since its merge. */
export interface SourceChange {
  kind: 'retrospective' | 'healthCheck' | 'backlog' | 'templates' | 'hcTemplates' | 'unknown';
  name?: string;
  added: boolean;
}

// Discriminated by a string: this project does not compile with
// strictNullChecks, under which a boolean `ok` would not narrow.
export type AdminResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'failed'; notice: Exclude<Notice, null>; data: Record<string, unknown> };

/** What each error code the routes answer with says, in the console's words. */
const ERROR_NOTICES: Record<string, Exclude<Notice, null>> = {
  same_team: { key: 'adminTeamMerge.error.sameTeam' },
  team_not_found: { key: 'adminTeamMerge.error.teamNotFound' },
  team_name_empty: { key: 'errors.teamNameEmpty' },
  team_name_exists: { key: 'errors.teamNameTaken' },
  team_name_too_long: { key: 'adminTeamMerge.error.nameTooLong', params: { max: TEAM_NAME_MAX_LENGTH } },
  password_unavailable: { key: 'adminTeamMerge.error.passwordUnavailable' },
  invalid_email: { key: 'adminTeamMerge.error.invalidEmail' },
  confirm_name_mismatch: { key: 'adminTeamMerge.error.confirmMismatch' },
  pre_delete_snapshot_failed: { key: 'adminTeamMerge.error.snapshotFailed' },
  sources_changed_since_preview: { key: 'adminTeamMerge.error.sourcesChanged' },
  session_read_failed: { key: 'adminTeamMerge.error.sessionReadFailed' },
  failed_to_move_feedbacks: { key: 'adminTeamMerge.error.feedbackMoveFailed' },
  related_teams: { key: 'adminTeamMerge.error.relatedTeams' },
  team_changed: { key: 'adminTeamMerge.error.teamChanged' }
};

const post = async <T>(
  path: string,
  sessionToken: string,
  body: Record<string, unknown>,
  fallback: MessageKey,
  // Codes whose meaning depends on the operation (`team_changed` on a restore
  // is not the deletion's sentence) are read here first.
  notices: Record<string, Exclude<Notice, null>> = {}
): Promise<AdminResult<T>> => {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken, ...body })
    });
  } catch (err) {
    return { status: 'failed', notice: err instanceof Error && err.message ? { raw: err.message } : { key: fallback }, data: {} };
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return { status: 'ok', data: data as T };

  if (response.status === 401) return { status: 'failed', notice: { key: 'admin.notice.sessionExpired' }, data };
  if (response.status === 429) {
    const notice: Exclude<Notice, null> = data?.retryAfter
      ? { key: 'login.superAdmin.tooManyAttemptsRetryIn', params: { retryAfter: String(data.retryAfter) } }
      : { key: 'login.superAdmin.tooManyAttemptsLater' };
    return { status: 'failed', notice, data };
  }
  const code = typeof data?.error === 'string' ? data.error : '';
  if (code === 'source_needs_repair') {
    const fields = Array.isArray(data.anomalies)
      ? (data.anomalies as { field?: string }[]).map((anomaly) => anomaly.field).filter(Boolean).join(', ')
      : '';
    return { status: 'failed', notice: { key: 'adminTeamMerge.error.sourceNeedsRepair', params: { fields } }, data };
  }
  if (code === 'password_too_short') {
    return { status: 'failed', notice: { key: 'errors.passwordTooShort', params: { min: PASSWORD_MIN_LENGTH } }, data };
  }
  if (code === 'archived_team_malformed') {
    const fields = Array.isArray(data.fields) ? (data.fields as string[]).join(', ') : '';
    return { status: 'failed', notice: { key: 'adminBackups.teamRestore.error.malformed', params: { fields } }, data };
  }
  return { status: 'failed', notice: notices[code] ?? ERROR_NOTICES[code] ?? { key: fallback }, data };
};

export const previewTeamMerge = (
  sessionToken: string,
  primaryTeamId: string,
  secondaryTeamId: string
) => post<MergePreview>(
  '/api/super-admin/merge-teams/preview',
  sessionToken,
  { primaryTeamId, secondaryTeamId },
  'adminTeamMerge.notice.previewFailed'
);

export const mergeTeams = (
  sessionToken: string,
  request: {
    primaryTeamId: string;
    secondaryTeamId: string;
    name: string;
    passwordSource: PasswordSource;
    newPassword?: string;
    facilitatorEmail: string;
    expectedFingerprints: { primary: string; secondary: string };
  }
) => post<{ success: true; team: { id: string; name: string } }>(
  '/api/super-admin/merge-teams',
  sessionToken,
  request,
  'adminTeamMerge.notice.mergeFailed'
);

export const deleteTeamAsAdmin = (
  sessionToken: string,
  request: {
    teamId: string;
    confirmName: string;
    mergedInto?: string;
    acknowledge?: DeleteReason[];
    /** The digest the refusal answered with: the facts the admin saw. */
    confirmation?: string;
  }
) => post<{ success: true; movedFeedbacks: number; orphanedFeedbacks: number; mergedInto: string | null }>(
  '/api/super-admin/delete-team',
  sessionToken,
  request,
  'adminTeamMerge.notice.deleteFailed'
);

/** One team of a stored backup, and what became of it since. */
export interface RestorableTeam {
  id: string;
  name: string;
  status: 'present' | 'renamed' | 'deleted';
  currentName: string | null;
  /** A deleted team whose name another team holds now: it needs a new one. */
  nameTaken: boolean;
  lastConnectionDate: string | null;
  counts: { retrospectives: number; healthChecks: number; globalActions: number; members: number };
}

export interface TeamRestoreResult {
  success: true;
  team: { id: string; name: string };
  recreated: boolean;
  counts: { retrospectives: number; healthChecks: number; globalActions: number; members: number; feedbacksRecovered: number };
  sessionsUpdated: number;
  /** Rows written for restored sessions that had none. */
  sessionsSeeded: number;
  /** Open sessions still showing the state from before the restore. */
  sessionsNotUpdated: string[];
  feedbacksStillOrphaned: boolean;
  preRestoreSnapshot: string;
}

const RESTORE_NOTICES: Record<string, Exclude<Notice, null>> = {
  backup_not_found: { key: 'adminBackups.teamRestore.error.backupNotFound' },
  team_not_in_backup: { key: 'adminBackups.teamRestore.error.notInBackup' },
  team_changed: { key: 'adminBackups.teamRestore.error.teamChanged' },
  pre_restore_snapshot_failed: { key: 'adminBackups.teamRestore.error.snapshotFailed' },
  session_read_failed: { key: 'adminBackups.teamRestore.error.sessionReadFailed' },
  restore_in_progress: { key: 'adminBackups.notice.restoreInProgress' },
  team_secret_delete_failed: { key: 'adminBackups.teamRestore.error.secretDeleteFailed' }
};

export const listBackupTeams = (sessionToken: string, backupId: string) => post<{ teams: RestorableTeam[] }>(
  '/api/super-admin/backups/teams',
  sessionToken,
  { backupId },
  'adminBackups.teamRestore.error.listFailed',
  RESTORE_NOTICES
);

export const restoreTeamFromBackup = (
  sessionToken: string,
  request: {
    backupId: string;
    teamId: string;
    /** What the dialog showed; the server refuses (`team_changed`) if it no longer holds. */
    expected: 'existing' | 'deleted';
    /** Only for a team deleted since the backup. */
    name?: string;
  }
) => post<TeamRestoreResult>(
  '/api/super-admin/backups/restore-team',
  sessionToken,
  request,
  'adminBackups.teamRestore.error.failed',
  RESTORE_NOTICES
);
