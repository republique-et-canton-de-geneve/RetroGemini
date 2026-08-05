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
 * @returns `{ claimed, added, previousKeys }` —
 *  - `claimed`: the name is the team's (`false` means another team holds it and
 *    nothing was written);
 *  - `added`: this call is what put it there, so this call may take it back. A
 *    retry that finds the name already its own must **not** release it on
 *    failure: that mapping predates the request, and dropping it would remove
 *    something this request never added;
 *  - `previousKeys`: every *other* key the team held at claim time — its current
 *    name, plus any alias a previously lost release left behind. This is the set
 *    the caller sweeps once the record write lands, and it is deliberately the
 *    set observed **before** the claim: a key claimed by a concurrent rename of
 *    the same team is not in it, so the two requests cannot delete each other's
 *    claim and leave the team with no name at all (Codex, PR #413).
 */
const claimTeamNameKey = async (dataStore, teamId, nameKey) => {
  let conflict = false;
  let alreadyOurs = false;
  let previousKeys = [];

  await dataStore.atomicTeamIndexUpdate((index) => {
    const holder = index.get(nameKey);
    // Assigned on every invocation, never merely accumulated, because the store
    // replays its updater on a lost compare-and-swap and only the last attempt
    // decided the outcome — the same rule the feedback routes' updaters follow.
    // Left as a one-way flag, a conflict seen on a retried attempt would outlive
    // the state that caused it and refuse a name that is free.
    conflict = holder !== undefined && holder !== teamId;
    alreadyOurs = holder === teamId;
    previousKeys = [...index.entries()]
      .filter(([key, id]) => id === teamId && key !== nameKey)
      .map(([key]) => key);
    // Nothing to write when the name is already ours, so a retry costs no
    // store write either.
    if (conflict || alreadyOurs) return null;
    index.set(nameKey, teamId);
    return index;
  });

  return { claimed: !conflict, added: !conflict && !alreadyOurs, previousKeys };
};

/**
 * Drop each of `nameKeys`, but only while it still points at `teamId`.
 *
 * Used both to release a claim whose record write failed and to sweep the names
 * a landed rename leaves behind. The ownership check is what stops it from
 * evicting a team that legitimately took one of those names in between.
 */
const releaseTeamNameKeys = async (dataStore, teamId, nameKeys) => {
  if (nameKeys.length === 0) return;

  await dataStore.atomicTeamIndexUpdate((index) => {
    let removed = false;
    for (const nameKey of nameKeys) {
      if (index.get(nameKey) !== teamId) continue;
      index.delete(nameKey);
      removed = true;
    }
    return removed ? index : null;
  });
};

/** Single-key `releaseTeamNameKeys`, for the failure path that releases a claim. */
const releaseTeamNameKey = async (dataStore, teamId, nameKey) => {
  await releaseTeamNameKeys(dataStore, teamId, [nameKey]);
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

export {
  claimTeamNameKey,
  releaseTeamNameKey,
  releaseTeamNameKeys,
  releaseAllTeamNameKeys
};
