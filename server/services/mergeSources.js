import { applyFresherSessionRows, describeContentChanges, fingerprintTeamContent, sessionIdsOf } from './teamMerge.js';

/**
 * Reading a merge source as the merge sees it: the team record plus any live
 * session copy that is ahead of it (`applyFresherSessionRows`). Used by the
 * merge, its preview, and both deletion routes, which must all see a source
 * the same way for the fingerprint comparison to mean anything.
 */

/**
 * A live session row could not be read. Not the same thing as "no row": taken
 * for one, it would silently leave the room's last writes out of the merged
 * team, and make a later deletion compare against the wrong content.
 */
class SessionReadError extends Error {
  constructor(sessionId, cause) {
    super(`could not read live session ${sessionId}`);
    this.name = 'SessionReadError';
    this.cause = cause;
  }
}

/**
 * @param {{ dataStore: object, sessionCache?: { get?: (id: string) => object|undefined } }} deps
 * @param {object} team a team record (as `loadTeam` returns it)
 */
const loadEffectiveTeam = async ({ dataStore, sessionCache }, team) => {
  const rows = new Map();
  for (const id of sessionIdsOf(team)) {
    let stored;
    try {
      stored = await dataStore.loadSessionState(id, { strict: true });
    } catch (err) {
      throw new SessionReadError(id, err);
    }
    // This pod's cache can be ahead of the database while a write is in
    // flight, or while degraded mode keeps live sessions going through a
    // database outage.
    const cached = sessionCache?.get?.(id) ?? null;
    const newer = cached && (!stored || Number(cached._rev) > Number(stored._rev)) ? cached : stored;
    if (newer) rows.set(id, newer);
  }
  return applyFresherSessionRows(team, rows);
};

/**
 * Whether a merge source holds work its merged team does not — the one way
 * deleting it loses something — and if so, what.
 *
 * Unchanged against any of the merges that list it is unchanged: the work is
 * in that merged team. Each entry is matched two ways, because a restore wipes
 * every live session row: after one, a source that never changed reads as its
 * team record, which is what `recordFingerprint` holds.
 *
 * @param {{ dataStore: object, sessionCache?: object }} deps
 * @param {object} team the source, as `loadTeam` returns it
 * @param {object[]} entries the `mergedFrom` entries naming it
 * @returns {Promise<{ changed: boolean, changes: object[] }>}
 */
const assessSourceChanges = async (deps, team, entries) => {
  if (entries.length === 0) return { changed: false, changes: [] };
  const { team: effective } = await loadEffectiveTeam(deps, team);
  const now = fingerprintTeamContent(effective);
  // The record-only digest stands in only when no live copy is ahead of the
  // record now. With one ahead, it is the live copy that holds the newest work,
  // and a match on the record alone would wave through a session write that
  // never reached it.
  const liveCopyAhead = now !== fingerprintTeamContent(team);
  const unchanged = entries.some((entry) =>
    now === entry.fingerprint || (!liveCopyAhead && now === entry.recordFingerprint)
  );
  if (unchanged) return { changed: false, changes: [] };
  const latest = [...entries].sort((a, b) => String(b.mergedAt ?? '').localeCompare(String(a.mergedAt ?? '')))[0];
  return { changed: true, changes: describeContentChanges(effective, latest.parts) };
};

export { SessionReadError, assessSourceChanges, loadEffectiveTeam };
