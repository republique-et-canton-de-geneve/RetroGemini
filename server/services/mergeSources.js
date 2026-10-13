import { applyFresherSessionRows, describeContentChanges, fingerprintTeamContent, sessionIdsOf } from './teamMerge.js';

/**
 * Reading a team as the merge sees it: the team record plus any live session
 * copy that is ahead of it (`applyFresherSessionRows`). Used by the merge, its
 * preview and the super-admin deletion (`/api/super-admin/delete-team`), which
 * must all see a team the same way for the fingerprint comparison to mean
 * anything. A team deleting itself does not come here.
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

const asArray = (value) => (Array.isArray(value) ? value : []);

/**
 * Every team a team was merged from, at any depth, through the provenance the
 * merges signed — read from the summaries projection, never full records. Each
 * signed entry also lists its source's own ancestors (`ancestorIds`), so the
 * chain survives the deletion of a team in the middle of it.
 *
 * @param {Array<{ id: string, mergedFrom?: object[] }>} summaries `loadTeamSummaries({ withMergeProvenance: true })`
 * @returns {Set<string>}
 */
const mergeAncestors = (summaries, teamId, verifyProvenance) => {
  const byId = new Map(asArray(summaries).filter((summary) => summary && summary.id).map((summary) => [summary.id, summary]));
  const found = new Set();
  const queue = [teamId];
  while (queue.length > 0) {
    const id = queue.shift();
    for (const entry of asArray(byId.get(id)?.mergedFrom)) {
      if (!entry || !verifyProvenance?.(id, entry)) continue;
      for (const ancestor of [entry.teamId, ...asArray(entry.ancestorIds)]) {
        if (typeof ancestor === 'string' && ancestor !== teamId && !found.has(ancestor)) {
          found.add(ancestor);
          queue.push(ancestor);
        }
      }
    }
  }
  return found;
};

const newestFirst = (entries) =>
  [...entries].sort((a, b) => String(b.mergedAt ?? '').localeCompare(String(a.mergedAt ?? '')));

/**
 * Whether a merge source holds work its merged team does not — the one way
 * deleting it loses something — and if so, what.
 *
 * Only provenance the merge signed counts: an entry anyone could have written
 * (a pod of the previous release stores whatever `/update` receives) must never
 * be able to make a changed source read as unchanged. Listed only by unsigned
 * entries, a source is `unverified`: nothing confirms the merged team holds its
 * work.
 *
 * Unchanged against any of the signed merges that list it is unchanged: the
 * work is in that merged team. Each entry is matched two ways, because a restore
 * wipes every live session row: after one, a source that never changed reads as
 * its team record, which is what `recordFingerprint` holds. A source that only
 * *lost* retros or health checks since its latest merge is unchanged too — what
 * it no longer has is in the merged team.
 *
 * @param {{ dataStore: object, sessionCache?: object }} deps
 * @param {object} team the source, as `loadTeam` returns it
 * @param {Array<{ id: string, name: string, entry: object }>} targets the merged teams listing it
 * @param {(mergedTeamId: string, entry: object) => boolean} verifyProvenance
 * @returns {Promise<{ status: 'none' | 'unchanged' | 'changed' | 'unverified', fingerprint?: string, changes?: object[], mergedInto?: string[] }>}
 */
const assessSourceChanges = async (deps, team, targets, verifyProvenance) => {
  if (targets.length === 0) return { status: 'none' };
  const signed = targets.filter((target) => verifyProvenance?.(target.id, target.entry));
  if (signed.length === 0) return { status: 'unverified', mergedInto: targets.map((target) => target.name) };

  const { team: effective } = await loadEffectiveTeam(deps, team);
  const now = fingerprintTeamContent(effective);
  // The record-only digest stands in only when no live copy is ahead of the
  // record now. With one ahead, it is the live copy that holds the newest work,
  // and a match on the record alone would wave through a session write that
  // never reached it.
  const liveCopyAhead = now !== fingerprintTeamContent(team);
  const entries = signed.map((target) => target.entry);
  const unchanged = entries.some((entry) =>
    now === entry.fingerprint || (!liveCopyAhead && now === entry.recordFingerprint)
  );
  if (unchanged) return { status: 'unchanged', fingerprint: now };
  const changes = describeContentChanges(effective, newestFirst(entries)[0].parts);
  if (changes.length === 0) return { status: 'unchanged', fingerprint: now };
  return { status: 'changed', fingerprint: now, changes, mergedInto: signed.map((target) => target.name) };
};

/**
 * Whether a merged team was written to since its merge. Deleting one is how a
 * merge is undone — but once the team has been used, deleting it also deletes
 * what was written there since, which no source holds.
 *
 * @param {{ dataStore: object, sessionCache?: object }} deps
 * @param {object} team the merged team, as `loadTeam` returns it
 * @param {(mergedTeamId: string, entry: object) => boolean} verifyProvenance
 * @returns {Promise<{ changed: boolean, fingerprint?: string, changes?: object[] }>}
 */
const assessMergedTeamChanges = async (deps, team, verifyProvenance) => {
  const signed = asArray(team?.mergedFrom)
    .filter((entry) => entry && typeof entry.mergedFingerprint === 'string' && verifyProvenance?.(team.id, entry));
  if (signed.length === 0) return { changed: false };
  const latest = newestFirst(signed)[0];
  const { team: effective } = await loadEffectiveTeam(deps, team);
  const now = fingerprintTeamContent(effective);
  if (now === latest.mergedFingerprint) return { changed: false, fingerprint: now };
  const changes = describeContentChanges(effective, latest.mergedParts);
  if (changes.length === 0) return { changed: false, fingerprint: now };
  return { changed: true, fingerprint: now, changes };
};

export { SessionReadError, assessMergedTeamChanges, assessSourceChanges, loadEffectiveTeam, mergeAncestors };
