import { releaseAllTeamNameKeys } from './teamNameIndex.js';
import { changedSinceMerge } from './mergeSources.js';

/**
 * Deleting a team — the one implementation behind both `/api/team/:teamId/delete`
 * (a team deleting itself) and `/api/super-admin/delete-team` (the super admin
 * removing a team, typically a merge source once the merged team is checked).
 * Written once so the two routes cannot drift: AGENTS.md invariant 15 and the
 * feedback-preservation rules below are subtle enough that a second copy would
 * lose one of them.
 *
 * Steps, in an order that is load-bearing:
 *   0. for a merge source, refuse if it changed since the merge — what was
 *      written there since is in no other team;
 *   1. preserve the team's feedbacks — *moved* into the merged team when the team
 *      is a merge source, orphaned into `retro-meta` otherwise;
 *   2. release every index key mapping to the team;
 *   3. delete the record.
 */

const asArray = (value) => (Array.isArray(value) ? value : []);

/** The source changed after its merge; deleting it would lose that work. */
class SourceChangedSinceMergeError extends Error {
  constructor(mergeTarget) {
    super('this team changed after it was merged');
    this.name = 'SourceChangedSinceMergeError';
    this.mergeTarget = mergeTarget;
  }
}

/**
 * The merged team still exists and lists this source, yet its feedbacks could
 * not be written into it (a lost compare-and-swap, a database error). The
 * deletion stops before anything is removed, so a retry can still move them:
 * orphaning them now would strand them under a deleted team id for good.
 */
class FeedbackMoveError extends Error {
  constructor(cause) {
    super('could not move the feedbacks into the merged team');
    this.name = 'FeedbackMoveError';
    this.cause = cause;
  }
}

/**
 * The merged team a merge recorded this team as a source of, if one still
 * exists. Read from the summaries projection (`mergedFrom` only, never the full
 * records), and the most recent merge wins if the super admin merged the same
 * team twice.
 *
 * `mergedFrom` is written by the merge alone: `/api/team/:teamId/update` strips
 * it, because a team that could point it at another team would receive that
 * team's feedbacks the day it is deleted.
 */
const findMergeTarget = async (dataStore, teamId) => {
  // Not knowing is safe: the feedbacks are then orphaned, which preserves them
  // exactly as a deletion always has. A deletion must not fail because a
  // read-only lookup did.
  let summaries;
  try {
    summaries = await dataStore.loadTeamSummaries();
  } catch (err) {
    console.warn('[Server] Could not look for a merged team; feedbacks will be orphaned', err);
    return null;
  }
  let target = null;
  for (const summary of summaries) {
    if (!summary || summary.id === teamId) continue;
    const entry = asArray(summary.mergedFrom).find((item) => item && item.teamId === teamId);
    if (!entry) continue;
    if (!target || String(entry.mergedAt ?? '') > String(target.entry.mergedAt ?? '')) {
      target = { id: summary.id, name: summary.name, entry };
    }
  }
  return target;
};

/**
 * Upsert by feedback id, not append: deletion is several store writes with no
 * transaction around them, so any failure after this point leaves the client to
 * retry. An unconditional push preserved every feedback twice per retry —
 * `/api/feedbacks/all` concatenates team feedbacks with orphaned ones, so the
 * duplicates show on the board, and every writer resolves an orphan by first
 * match, so only one copy of the pair would ever be updated again.
 *
 * *Replacing* rather than skipping matters just as much (Codex, PR #407):
 * between a failed attempt and the retry the team is still live, and every
 * feedback writer — the comment routes and the super-admin
 * status/comment/delete routes — looks in the team record first and only falls
 * back to `orphanedFeedbacks`. So any change in that window lands on the *live*
 * copy, and skipping an already-preserved id would freeze the stale snapshot
 * taken by the first attempt and lose those changes when the record goes.
 */
const upsertById = (existing, incoming) => {
  const liveById = new Map(incoming.map((feedback) => [feedback.id, feedback]));
  const merged = asArray(existing).map((entry) => {
    const live = entry && liveById.get(entry.id);
    if (!live) return entry;
    liveById.delete(entry.id);
    return live;
  });
  merged.push(...liveById.values());
  return merged;
};

const orphanFeedbacks = async (dataStore, team) => {
  const feedbacksToPreserve = team.teamFeedbacks.map((feedback) => ({
    ...feedback,
    teamId: feedback.teamId || team.id,
    teamName: feedback.teamName || team.name
  }));
  await dataStore.atomicMetaUpdate((meta) => {
    if (!Array.isArray(meta.orphanedFeedbacks)) {
      meta.orphanedFeedbacks = [];
    }
    meta.orphanedFeedbacks = upsertById(meta.orphanedFeedbacks, feedbacksToPreserve);
    return meta;
  });
};

/**
 * A merge source's feedbacks belong to the merged team, so they become its own:
 * the owner fields name the merged team (so its facilitator sees them as theirs
 * and may delete them, `feedbackRoutes.js`), and so do the comments either
 * source of the merge wrote on them — once the sources are gone, a comment
 * owned by one of them could never be deleted again. Comments by the super
 * admin or by another team keep their author.
 *
 * Unlike the orphan upsert, a feedback the merged team already holds is never
 * replaced: the moved copy is live the moment it lands, so on a retry after a
 * failed deletion the merged team's copy is the one people have been writing
 * to. It is kept, and only the comments it lacks are added from the source.
 *
 * Answers `false` when there is nowhere to move them — the merged team is gone,
 * or no longer lists this source (a restore from before the merge) — so the
 * caller orphans them instead. Any other failure throws `FeedbackMoveError`.
 */
const moveFeedbacksIntoMergedTeam = async (dataStore, team, target) => {
  let applied = false;
  let result;
  try {
    result = await dataStore.atomicTeamUpdate(target.id, (merged) => {
      // Assigned on every invocation: the store replays the updater on a lost
      // compare-and-swap, and only the last attempt decides.
      applied = false;
      const sources = new Set(asArray(merged.mergedFrom).map((entry) => entry?.teamId).filter(Boolean));
      if (!sources.has(team.id)) return null;
      const adopt = (comment) =>
        comment && sources.has(comment.teamId) ? { ...comment, teamId: merged.id, teamName: merged.name } : comment;

      const held = new Map(asArray(merged.teamFeedbacks).map((feedback) => [feedback?.id, feedback]));
      const additions = [];
      for (const feedback of team.teamFeedbacks) {
        const comments = asArray(feedback.comments).map(adopt);
        const existing = held.get(feedback.id);
        if (!existing) {
          additions.push({
            ...feedback,
            teamId: merged.id,
            teamName: merged.name,
            ...(Array.isArray(feedback.comments) ? { comments } : {})
          });
          continue;
        }
        const knownComments = new Set(asArray(existing.comments).map((comment) => comment?.id));
        const missing = comments.filter((comment) => comment && !knownComments.has(comment.id));
        if (missing.length > 0) existing.comments = [...asArray(existing.comments), ...missing];
      }
      merged.teamFeedbacks = [...asArray(merged.teamFeedbacks), ...additions].map((feedback) =>
        feedback && Array.isArray(feedback.comments) ? { ...feedback, comments: feedback.comments.map(adopt) } : feedback
      );
      applied = true;
      return merged;
    });
  } catch (err) {
    throw new FeedbackMoveError(err);
  }
  if (result?.success && applied) return true;
  if (result?.success || result?.error === 'team_not_found') return false;
  throw new FeedbackMoveError(new Error(result?.error || 'unknown'));
};

/**
 * @param {object} params
 * @param {object} params.dataStore
 * @param {object} [params.sessionCache] this pod's live-session cache, if the caller has one
 * @param {object} params.team the record being deleted, as just loaded
 * @param {{ id: string, name: string, entry: object }|null} params.mergeTarget from `findMergeTarget`
 * @param {boolean} [params.force] delete a merge source even though it changed since the merge
 * @returns {Promise<{ movedFeedbacks: number, orphanedFeedbacks: number, mergedInto: string|null }>}
 */
const deleteTeamAndPreserveFeedbacks = async ({ dataStore, sessionCache, team, mergeTarget = null, force = false }) => {
  if (mergeTarget && !force && (await changedSinceMerge({ dataStore, sessionCache }, team, mergeTarget))) {
    throw new SourceChangedSinceMergeError(mergeTarget);
  }

  const feedbacks = asArray(team.teamFeedbacks);
  let movedFeedbacks = 0;
  let orphanedFeedbacks = 0;
  let mergedInto = null;

  if (feedbacks.length > 0) {
    const sourceTeam = { ...team, teamFeedbacks: feedbacks };
    if (mergeTarget && (await moveFeedbacksIntoMergedTeam(dataStore, sourceTeam, mergeTarget))) {
      movedFeedbacks = feedbacks.length;
      mergedInto = mergeTarget.id;
    } else {
      await orphanFeedbacks(dataStore, sourceTeam);
      orphanedFeedbacks = feedbacks.length;
    }
  } else if (mergeTarget) {
    mergedInto = mergeTarget.id;
  }

  // Index entry first, record second — and on this path the index is only
  // ever *narrowed*, never widened. Both halves of that are load-bearing.
  //
  // Order: the reverse — record first — left the name resolving to nothing
  // when the index write failed: unusable for creation (409 straight from
  // the index), unusable for login (401 once the record lookup fails), and
  // beyond the reach of a retry, which can no longer authenticate against
  // the team it is deleting. This order leaves the record intact, so a
  // retry authenticates and completes, and the name is free either way.
  //
  // No rollback: restoring the entry when `deleteTeamRecord` fails looks
  // tidier and reintroduces exactly the state above (Codex, PR #407). Two
  // overlapping deletions are enough — A clears the entry and its record
  // delete fails; B sees no entry, deletes the record, succeeds; A then
  // restores a mapping to a record that no longer exists, and the name is
  // bricked for good. No re-check closes it, because the record can vanish
  // between the check and the write. So the rule is structural rather than
  // conditional: a deletion never adds a mapping. The cost is that an
  // un-retried failure leaves a record with no index entry — visible in
  // `/api/team/list`, not reachable by login — which is repairable by
  // retrying, unlike the state the rollback could produce.
  //
  // Every key, not the first match: a rename in flight holds two keys for
  // one team, and one whose final release was lost holds two for good.
  // Stopping at the first left the other pointing at the record this is
  // about to delete.
  await releaseAllTeamNameKeys(dataStore, team.id);

  await dataStore.deleteTeamRecord(team.id);

  return { movedFeedbacks, orphanedFeedbacks, mergedInto };
};

export {
  deleteTeamAndPreserveFeedbacks,
  findMergeTarget,
  FeedbackMoveError,
  SourceChangedSinceMergeError
};
