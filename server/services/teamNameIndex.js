/**
 * Ownership-safe writes to the `team-index` record.
 *
 * The index maps a lowercased team name to a team id, and it lives in a
 * different store record from `team:{id}` with no transaction spanning the two.
 * Every handler that writes both must therefore be able to answer "what does a
 * failure on the second write leave behind, and can a retry reach it?" — see
 * `HARDENING_STATUS.md` invariant 15.
 *
 * The rule these helpers exist to enforce is the one Codex found on PR #407 and
 * that the rename path then broke on its own account: **an index write never
 * takes a name away from another team, and never adds a mapping to a record it
 * cannot vouch for.** Concretely, a compensating write may only remove a
 * mapping *it added itself*, which is why every helper here is keyed on the
 * caller's team id rather than on the name alone.
 */

/**
 * Claim `nameKey` for `teamId`, leaving every other mapping — including the
 * team's current one — untouched.
 *
 * Claiming *before* the record write is what makes the failure paths safe: the
 * team keeps its old name throughout, so a lost record write needs no rollback
 * that widens the index, only the release of the claim just made.
 *
 * @returns `true` when the name is now the team's, `false` when another team
 *          holds it (in which case nothing was written).
 */
const claimTeamNameKey = async (dataStore, teamId, nameKey) => {
  let conflict = false;

  await dataStore.atomicTeamIndexUpdate((index) => {
    const holder = index.get(nameKey);
    // Assigned on every invocation, never merely set, because the store replays
    // its updater on a lost compare-and-swap and only the last attempt decided
    // the outcome — the same rule the feedback routes' updaters follow. Left as
    // a one-way flag, a conflict seen on a retried attempt would outlive the
    // state that caused it and refuse a name that is free.
    conflict = holder !== undefined && holder !== teamId;
    // Nothing to write when the name is already ours, so a retry costs no
    // store write either.
    if (conflict || holder === teamId) return null;
    index.set(nameKey, teamId);
    return index;
  });

  return !conflict;
};

/**
 * Drop `nameKey`, but only while it still points at `teamId`.
 *
 * Used both to release a claim whose record write failed and to free the old
 * name once a rename has landed. The ownership check is what stops it from
 * evicting a team that legitimately took the name in between.
 */
const releaseTeamNameKey = async (dataStore, teamId, nameKey) => {
  await dataStore.atomicTeamIndexUpdate((index) => {
    if (index.get(nameKey) !== teamId) return null;
    index.delete(nameKey);
    return index;
  });
};

/**
 * Drop every key mapping to `teamId`.
 *
 * A team normally holds one name, but a rename in flight holds two, and a
 * rename whose final release was lost holds two for good. Clearing only the
 * first match left the other pointing at a record that deletion was about to
 * remove — a mapping to nothing, which is the one state no retry and no UI can
 * repair.
 */
const releaseAllTeamNameKeys = async (dataStore, teamId) => {
  await dataStore.atomicTeamIndexUpdate((index) => {
    let removed = false;
    for (const [key, id] of index.entries()) {
      if (id === teamId) {
        index.delete(key);
        removed = true;
      }
    }
    return removed ? index : null;
  });
};

export { claimTeamNameKey, releaseTeamNameKey, releaseAllTeamNameKeys };
