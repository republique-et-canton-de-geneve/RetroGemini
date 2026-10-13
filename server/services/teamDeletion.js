import { randomBytes } from 'crypto';
import { releaseAllTeamNameKeys } from './teamNameIndex.js';

/**
 * Deleting a team — the one implementation behind both `/api/team/:teamId/delete`
 * (a team deleting itself) and `/api/super-admin/delete-team` (the super admin
 * removing a team, typically a merge source once the merged team is checked).
 * Written once so the two routes cannot drift: AGENTS.md invariant 15 and the
 * feedback-preservation rules below are subtle enough that a second copy would
 * lose one of them.
 *
 * Three steps, in an order that is load-bearing:
 *   1. preserve the team's feedbacks — *moved* into a merged team when the
 *      super admin confirmed one and the merge's signature checks out, orphaned
 *      into `retro-meta` otherwise (always, for a team deleting itself);
 *   2. release every index key mapping to the team;
 *   3. delete the record.
 *
 * Whether deleting a merge source would lose work is the super-admin route's
 * question (`mergeSources.js`), asked before it gets here.
 */

const asArray = (value) => (Array.isArray(value) ? value : []);

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
 * Every merged team whose `mergedFrom` lists this team, with the entry. Read
 * from the summaries projection, never the full records.
 *
 * Signed or not: these feed the *protective* checks — "this source changed
 * since its merge", "the console says Merged into X" — where the worst a
 * planted entry can do is make the super admin read a warning. The one
 * consequential use, moving feedbacks, needs the admin's confirmation of a
 * target *and* the merge's signature (`moveFeedbacksIntoMergedTeam`).
 *
 * @returns {Promise<Array<{ id: string, name: string, entry: object }>>}
 */
const findMergeTargets = async (dataStore, teamId) => {
  // Not knowing is safe: the feedbacks are then orphaned, which preserves them
  // exactly as a deletion always has, and the checks that would have warned
  // are the super admin's to repeat.
  let summaries;
  try {
    summaries = await dataStore.loadTeamSummaries({ withMergeProvenance: true });
  } catch (err) {
    console.warn('[Server] Could not look for a merged team; feedbacks will be orphaned', err);
    return [];
  }
  const targets = [];
  for (const summary of summaries) {
    if (!summary || summary.id === teamId) continue;
    const entry = asArray(summary.mergedFrom).find((item) => item && item.teamId === teamId);
    if (entry) targets.push({ id: summary.id, name: summary.name, entry });
  }
  return targets;
};

/** The signed entries of a merged team's provenance; anything else is ignored. */
const verifiedMergeSources = (team, verifyProvenance) =>
  asArray(team?.mergedFrom).filter((entry) => entry && verifyProvenance?.(team.id, entry));

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
const moveFeedbacksIntoMergedTeam = async (dataStore, team, target, verifyProvenance) => {
  let applied = false;
  let result;
  try {
    result = await dataStore.atomicTeamUpdate(target.id, (merged) => {
      // Assigned on every invocation: the store replays the updater on a lost
      // compare-and-swap, and only the last attempt decides.
      applied = false;
      // Re-checked under the lock, signatures included: the summaries read
      // happened before, and the record is what this write trusts.
      const sources = new Set(verifiedMergeSources(merged, verifyProvenance).map((entry) => entry.teamId));
      if (!sources.has(team.id)) return null;
      const adopt = (comment) =>
        comment && sources.has(comment.teamId) ? { ...comment, teamId: merged.id, teamName: merged.name } : comment;

      const held = new Map(asArray(merged.teamFeedbacks).map((feedback) => [feedback?.id, feedback]));
      const additions = [];
      for (const feedback of team.teamFeedbacks) {
        const comments = asArray(feedback.comments).map(adopt);
        const existing = held.get(feedback.id);
        // The same id is the same feedback only when it is the copy an earlier
        // attempt of this very deletion moved (`movedFromTeamId`). Anything else
        // is another feedback that happens to share the id — kept, and this one
        // added under a new id rather than poured into it.
        if (existing && existing.movedFromTeamId === team.id) {
          const knownComments = new Set(asArray(existing.comments).map((comment) => comment?.id));
          const missing = comments.filter((comment) => comment && !knownComments.has(comment.id));
          if (missing.length > 0) existing.comments = [...asArray(existing.comments), ...missing];
          continue;
        }
        const id = existing ? `feedback_${randomBytes(5).toString('hex')}` : feedback.id;
        additions.push({
          ...feedback,
          id,
          teamId: merged.id,
          teamName: merged.name,
          movedFromTeamId: team.id,
          ...(Array.isArray(feedback.comments)
            ? { comments: comments.map((comment) => (comment && id !== feedback.id ? { ...comment, feedbackId: id } : comment)) }
            : {})
        });
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
 * @param {object} params.team the record being deleted, as just loaded
 * @param {{ id: string }|null} params.mergeTarget the merged team the super admin confirmed, if any
 * @param {(mergedTeamId: string, entry: object) => boolean} [params.verifyProvenance] `tokenService.verifyMergeProvenance`
 * @returns {Promise<{ movedFeedbacks: number, orphanedFeedbacks: number, mergedInto: string|null }>}
 */
const deleteTeamAndPreserveFeedbacks = async ({ dataStore, team, mergeTarget = null, verifyProvenance }) => {
  const feedbacks = asArray(team.teamFeedbacks);
  let movedFeedbacks = 0;
  let orphanedFeedbacks = 0;
  let mergedInto = null;

  if (feedbacks.length > 0) {
    const sourceTeam = { ...team, teamFeedbacks: feedbacks };
    if (mergeTarget && (await moveFeedbacksIntoMergedTeam(dataStore, sourceTeam, mergeTarget, verifyProvenance))) {
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
  findMergeTargets,
  verifiedMergeSources,
  FeedbackMoveError
};
