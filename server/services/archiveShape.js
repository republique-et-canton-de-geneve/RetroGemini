/**
 * What every restore path and the backup import require of a parsed archive
 * before anything is written (AGENTS.md → *Key Design Principles* →
 * *Backup/restore*). One rule, applied by:
 *
 * - `/api/super-admin/backups/import`, at write time — a stored row is then
 *   trusted by every route that reads it;
 * - `/api/super-admin/backups/restore`, after its snapshot, for rows written
 *   before 41.0 or by hand;
 * - `/api/super-admin/restore` (the uploaded whole-store restore), before its
 *   snapshot.
 *
 * Why each refusal exists:
 * - `normalizePersistedData` turns a `teams` that is not an array into `[]`,
 *   and a whole-store replace of `[]` deletes every team and live session;
 * - a team with no string name makes `savePersistedData` throw at
 *   `team.name.toLowerCase()` once the earlier teams are already upserted,
 *   leaving a hybrid store (the index, the meta and the replace cleanup never
 *   run);
 * - two entries with one id give the team-restore dialog two radios with one
 *   `key` and one `value`;
 * - `resetTokens` / `orphanedFeedbacks` present but not lists would silently be
 *   written as `[]` for something the file claimed to carry. Absent is fine: an
 *   older archive may predate them, and the replace fills them in.
 *
 * Two names that differ only in case — or are equal — are accepted on purpose:
 * a genuine store can hold two records displaying one name (a deletion whose
 * last step failed), and its genuine backups then do too. Refusing would block
 * restoring every other team in the file.
 *
 * Extra top-level keys (`globalSettings`, `jiraSettings`, anything else) are
 * accepted and stay inert: `savePersistedData` reads only `teams`, `meta`,
 * `resetTokens` and `orphanedFeedbacks`.
 */

const MAX_POSITIONS = 10;
const MAX_DUPLICATE_IDS = 5;
const MAX_ID_LENGTH = 64;

/** A team record an archive can hold: a non-empty string id and a string name. */
export const isTeamShape = (team) =>
  !!team && typeof team === 'object' && typeof team.id === 'string' && team.id !== '' && typeof team.name === 'string';

/** Thrown by the import for a parsed archive `archiveShapeProblem` refuses. */
export class ArchiveShapeError extends Error {
  constructor(reason, details = {}) {
    super(reason);
    this.name = 'ArchiveShapeError';
    this.code = 'INVALID_BACKUP_DATA';
    this.reason = reason;
    this.details = details;
  }
}

// Code points, never half a surrogate pair: the ids come from the file.
const cutId = (id) => Array.from(id).slice(0, MAX_ID_LENGTH).join('');

/**
 * `null` when the parsed archive is acceptable, else `{ reason, ...details }`:
 *   'not_an_object'      — the archive is not a plain object (an array included)
 *   'teams_missing'      — `teams` absent or not an array (an explicit [] is fine)
 *   'team_malformed'     — { count, positions: the first 10 indexes }
 *   'team_id_duplicated' — { ids: the first 5 duplicated ids, each cut to 64 code points }
 *   'list_malformed'     — { field: 'resetTokens' | 'orphanedFeedbacks' } present but not an array
 */
export const archiveShapeProblem = (data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { reason: 'not_an_object' };
  if (!Array.isArray(data.teams)) return { reason: 'teams_missing' };

  let malformed = 0;
  const positions = [];
  data.teams.forEach((team, index) => {
    if (isTeamShape(team)) return;
    malformed += 1;
    if (positions.length < MAX_POSITIONS) positions.push(index);
  });
  if (malformed > 0) return { reason: 'team_malformed', count: malformed, positions };

  const seen = new Set();
  const duplicated = new Set();
  const ids = [];
  for (const team of data.teams) {
    if (!seen.has(team.id)) {
      seen.add(team.id);
      continue;
    }
    if (duplicated.has(team.id)) continue;
    duplicated.add(team.id);
    if (ids.length < MAX_DUPLICATE_IDS) ids.push(cutId(team.id));
  }
  if (duplicated.size > 0) return { reason: 'team_id_duplicated', ids };

  for (const field of ['resetTokens', 'orphanedFeedbacks']) {
    if (data[field] !== undefined && !Array.isArray(data[field])) return { reason: 'list_malformed', field };
  }
  return null;
};
