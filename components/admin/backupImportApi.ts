import type { BackupEntry, BackupLimits } from '../../types';
import type { Notice } from '../../i18n/notice';
import { megabytesText } from './backupFormat';

/**
 * Importing a backup file from the console (`POST /api/super-admin/backups/import`,
 * `server/routes/superAdminBackupImportRoutes.js`). Kept apart from
 * `teamAdminApi.ts`, whose `post()` sends only JSON: this one sends the file
 * itself, with the credential in a header.
 *
 * Every answer becomes a `Notice` — what to say, never the sentence — so a
 * message on screen follows the language switcher. A size in a notice is kept
 * as `megabytesText` and given the reader's decimal mark when it is rendered
 * (`withLocalizedMax`).
 */

/** When the backups list should be read again after an import that did not say "done". */
export type ListReload = 'now' | 'now-and-later';

export type ImportOutcome =
  | { status: 'ok'; backup: BackupEntry }
  /** `fileError`: the file is what was refused, so the field is marked invalid. */
  | { status: 'failed'; notice: Exclude<Notice, null>; fileError: boolean; reload?: ListReload }
  /**
   * No answer, or a gateway's page instead of one: the row may have landed, or
   * may still be landing — behind the OpenShift Route a 504 comes back at 30 s
   * while the server is still parsing or inserting. The list is read now and
   * once more a little later; a blind retry would leave a duplicate row.
   */
  | { status: 'uncertain'; notice: Exclude<Notice, null>; reload: 'now-and-later' };

type Body = Record<string, unknown> | null;

const failed = (notice: Exclude<Notice, null>, fileError: boolean, reload?: ListReload): ImportOutcome =>
  reload ? { status: 'failed', notice, fileError, reload } : { status: 'failed', notice, fileError };

const UNCERTAIN: ImportOutcome = {
  status: 'uncertain',
  notice: { key: 'adminBackups.import.error.uncertain' },
  reload: 'now-and-later'
};

// The store refused the INSERT, or something unexpected. An INSERT is atomic,
// but a PostgreSQL commit whose acknowledgement was lost with the connection
// reads the same way, so the list is read again rather than promise nothing
// changed.
const FAILED: ImportOutcome = failed({ key: 'adminBackups.import.error.failed' }, false, 'now');

const readBody = async (response: Response): Promise<Body> => {
  const data: unknown = await response.json().catch(() => null);
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
};

const bytesOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

/**
 * What a 413 means, for the import and for the old whole-store upload alike.
 * The application answers JSON naming which of its limits the file passed; a
 * 413 that is not JSON came from the network in front of it (ingress-nginx's
 * 1 MiB default, see k8s/README.md), which only the operator can raise.
 * `null` when the answer names nothing this console knows.
 */
export const sizeRefusalNotice = (body: Body, limits: BackupLimits | null): Exclude<Notice, null> | null => {
  if (!body) return { key: 'adminBackups.import.error.proxyTooLarge' };
  if (body.error === 'backup_file_too_large') {
    const max = bytesOf(body.maxBytes) ?? limits?.maxArchiveBytes ?? null;
    return max ? { key: 'adminBackups.import.error.tooLarge', params: { max: megabytesText(max) } } : null;
  }
  if (body.error === 'restore_archive_too_large') {
    const max = bytesOf(body.maxBytes) ?? limits?.maxUnpackedBytes ?? null;
    return max ? { key: 'adminBackups.import.error.tooLargeUnpacked', params: { max: megabytesText(max) } } : null;
  }
  return null;
};

const invalidDataNotice = (body: Record<string, unknown>): Exclude<Notice, null> => {
  switch (body.reason) {
    case 'team_malformed':
      return { key: 'adminBackups.import.error.teamMalformed', params: { count: Number(body.count) || 0 } };
    case 'team_id_duplicated':
      return {
        key: 'adminBackups.import.error.duplicateTeams',
        params: { ids: Array.isArray(body.ids) ? body.ids.map(String).join(', ') : '' }
      };
    case 'list_malformed':
      return { key: 'adminBackups.import.error.listMalformed', params: { field: String(body.field ?? '') } };
    default:
      return { key: 'adminBackups.import.error.invalidData' };
  }
};

const rateLimitNotice = (body: Body): Exclude<Notice, null> =>
  body?.retryAfter
    ? { key: 'login.superAdmin.tooManyAttemptsRetryIn', params: { retryAfter: String(body.retryAfter) } }
    : { key: 'login.superAdmin.tooManyAttemptsLater' };

/**
 * Sends one file. Checks it first (an empty file, or one larger than the
 * limit the list reported), so a file the server would refuse costs no upload;
 * without `limits` (a pod from before 41.0) the server judges the size alone.
 */
export const importBackupFile = async (
  sessionToken: string,
  file: File,
  limits: BackupLimits | null
): Promise<ImportOutcome> => {
  if (file.size === 0) return failed({ key: 'adminBackups.import.error.emptyFile' }, true);
  if (limits && file.size > limits.maxArchiveBytes) {
    return failed({ key: 'adminBackups.import.error.tooLarge', params: { max: megabytesText(limits.maxArchiveBytes) } }, true);
  }

  let response: Response;
  try {
    response = await fetch('/api/super-admin/backups/import', {
      method: 'POST',
      headers: {
        // Never `application/json`: the server's global JSON parser would take
        // the body first (audit H30). Octet-stream carries gzip and plain JSON.
        'Content-Type': 'application/octet-stream',
        'x-super-admin-session-token': sessionToken,
        // A header, not the query string: query strings land in access logs.
        'x-backup-label': encodeURIComponent(file.name)
      },
      body: file
    });
  } catch {
    return UNCERTAIN;
  }

  const body = await readBody(response);
  if (response.ok) {
    const backup = body?.backup;
    return backup && typeof backup === 'object' ? { status: 'ok', backup: backup as BackupEntry } : UNCERTAIN;
  }

  const error = body?.error;
  switch (response.status) {
    case 401:
      return failed({ key: 'admin.notice.sessionExpired' }, false);
    case 429:
      return failed(rateLimitNotice(body), false);
    case 409:
      return error === 'import_in_progress' ? failed({ key: 'adminBackups.import.error.inProgress' }, false) : FAILED;
    case 413: {
      const notice = sizeRefusalNotice(body, limits);
      return notice ? failed(notice, true) : FAILED;
    }
    case 400:
      if (error === 'missing_archive') return failed({ key: 'adminBackups.import.error.emptyFile' }, true);
      if (error === 'invalid_backup_format') return failed({ key: 'adminBackups.import.error.invalidFormat' }, true);
      if (error === 'invalid_backup_data' && body) return failed(invalidDataNotice(body), true);
      return FAILED;
    case 404:
      // Express's own HTML page: a pod from before 41.0 during a rolling
      // update. Re-uploading a large file blindly would be waste, so no retry.
      return body ? FAILED : failed({ key: 'adminBackups.import.error.unavailable' }, false);
    default:
      // A gateway's page (502, 504) is no answer from the application.
      return response.status >= 500 && !body ? UNCERTAIN : FAILED;
  }
};
