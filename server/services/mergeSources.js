import { applyFresherSessionRows, fingerprintTeamContent, sessionIdsOf } from './teamMerge.js';

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

/** Whether a merge source holds something its merged team does not. */
const changedSinceMerge = async (deps, team, mergeTarget) => {
  const { team: effective } = await loadEffectiveTeam(deps, team);
  return fingerprintTeamContent(effective) !== mergeTarget?.entry?.fingerprint;
};

export { SessionReadError, changedSinceMerge, loadEffectiveTeam };
