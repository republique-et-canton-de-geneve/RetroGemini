/**
 * The impact rating on a closed action — the scale, the vote validator, and the
 * one merge rule that keeps concurrent writers from erasing each other.
 *
 * ## Why this module exists, and why it is in `utils/`
 *
 * `impactRatings` is the first piece of *per-user* data stored on the team
 * record. Everything else there has a single writer: `done`, `assigneeId` and
 * `text` are facilitator-only, and per-user session data (votes, ROTI,
 * happiness) lives in the session blob behind the `_rev` compare-and-swap.
 * Ratings have one writer per participant, all at once, on a record whose main
 * write path (`POST /api/team/:teamId/action`) *replaces the whole action*
 * (`server/routes/teamRoutes.js`). A client holding a copy fetched before its
 * neighbour voted would silently drop that vote.
 *
 * So the rule below has to hold identically on both sides of the wire — the
 * Express routes (ESM JavaScript) and `services/dataService.ts` (TypeScript,
 * bundled by Vite) — which is exactly why it is a plain-JS module in `utils/`
 * rather than in `server/services/`. `utils/passwordPolicy.js` and
 * `utils/inviteLink.js` are the existing precedent, and `vitest.config.ts`
 * already covers `utils/**\/*.{ts,js}`, so this file is measured.
 *
 * The narrow route `POST /api/team/:teamId/action/impact` is the *primary*
 * defence: it writes one `impactRatings[userId]` key inside `atomicTeamUpdate`,
 * so two voters never contend for the same key. This merge is the second: it
 * makes every *other* write path additive, so a whole-action write that knows
 * nothing about ratings cannot undo them.
 *
 * ## Why `closedAt` is merged here too
 *
 * `closedAt` decides which actions a rating round asks about. If a stale write
 * could clear it, an action would silently leave the round — or, worse, an
 * invented stamp would drag the entire pre-feature backlog into it. Its rules
 * live beside the ratings because both are "fields no single client owns".
 */

/** The three things a participant can say about a closed action. */
export const ACTION_IMPACT_SCORES = [1, 2, 3];

/**
 * "Not concerned" — a cast vote that stays out of every average.
 *
 * It is deliberately not a fourth score and deliberately not the absence of a
 * vote: it completes a participant's round (so the panel can show them as
 * done) while keeping "this action was not about me" from landing as a middle
 * value and dragging every average toward 2.
 */
export const ACTION_IMPACT_ABSTAIN = 'abstain';

/**
 * Keys that are not data on a plain object.
 *
 * `impactRatings` is a map keyed by a *caller-supplied* user id, so a request
 * naming `__proto__` would change the object's prototype instead of storing a
 * vote, and `constructor` / `prototype` shadow machinery the rest of the code
 * assumes is intact (CodeQL js/remote-property-injection). None of the three is
 * ever a real participant id.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * The shape a participant id has to have before it is used as a map key.
 *
 * Same conservative charset as the `X-Request-Id` guard in
 * `server/services/logContext.js`, and for the same second reason: the value is
 * caller-controlled, so it needs a bound as well as a shape — nothing should be
 * able to persist a megabyte key into a team record. Real ids are 9 base36
 * characters from `utils/randomId.ts`; the allowance is wider so a member id
 * minted by some other path is not rejected retroactively.
 */
const VALID_RATER_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * True when `userId` may be used as a key in `impactRatings`.
 *
 * The charset test alone is not enough: `__proto__` matches it. Both halves are
 * load-bearing.
 *
 * @param {unknown} userId
 * @returns {boolean}
 */
export const isValidRaterId = (userId) =>
  typeof userId === 'string' && VALID_RATER_ID.test(userId) && !UNSAFE_KEYS.has(userId);

/**
 * Set or clear one participant's vote on a ratings map, returning a new map.
 *
 * ## Why there is no `next[userId] = vote` here
 *
 * A computed property write with a caller-supplied key is the whole bug:
 * `obj['__proto__'] = x` does not store anything, it replaces the object's
 * prototype (CodeQL js/remote-property-injection). Building the result through
 * a `Map` and `Object.fromEntries` removes that write entirely — a `Map` key is
 * data rather than a property name, and `Object.fromEntries` defines *own*
 * properties (CreateDataProperty), so even `__proto__` lands as an ordinary
 * entry and the prototype is never touched. Verified rather than assumed.
 *
 * The id is validated here too, not only at the route. This module is exported
 * to both sides of the wire, so "the caller already checked" is true exactly
 * until the next call site — and a guard that lives in the same function as the
 * write is the one a reader (and an analyser) can actually see.
 *
 * @param {Record<string, unknown>|undefined} ratings
 * @param {string} userId
 * @param {unknown} vote `null`/`undefined` clears the entry
 * @returns {Record<string, unknown>}
 * @throws {TypeError} when `userId` is not a usable participant id
 */
export const withRaterVote = (ratings, userId, vote) => {
  if (!isValidRaterId(userId)) {
    throw new TypeError('withRaterVote: invalid rater id');
  }

  const entries = new Map(Object.entries(ratings || {}));
  if (vote === null || vote === undefined) entries.delete(userId);
  else entries.set(userId, vote);

  return Object.fromEntries(entries);
};

/**
 * True when `vote` is something a participant may store.
 *
 * `null` is included because clearing your own vote is a legitimate write — the
 * route maps it to deleting the key rather than storing a value. Everything
 * else is refused with `400` rather than coerced: a `'2'` stored as a string
 * would silently vanish from `actionImpactScore`, which is the kind of bug that
 * shows up as a wrong average months later.
 *
 * @param {unknown} vote
 * @returns {boolean}
 */
export const isValidImpactVote = (vote) =>
  vote === null || vote === ACTION_IMPACT_ABSTAIN || ACTION_IMPACT_SCORES.includes(vote);

/**
 * The team's verdict on one action: the mean of its numeric votes, or `null`
 * when nobody has given one.
 *
 * Abstentions are excluded from both the sum and the divisor, so an action
 * rated `3` by one person and abstained by four scores 3, not 0.6. `null`
 * rather than `0` for "no numeric vote": zero is off the 1-3 scale and would
 * read as a terrible score, when the truth is that there is no score.
 *
 * @param {{ impactRatings?: Record<string, number|string> }} action
 * @returns {number|null}
 */
export const actionImpactScore = (action) => {
  const votes = Object.values(action?.impactRatings ?? {});
  const scores = votes.filter((vote) => ACTION_IMPACT_SCORES.includes(vote));
  if (scores.length === 0) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
};

/**
 * How many participants have answered at all, abstentions included.
 *
 * This is the number the round shows *before* the facilitator reveals: it says
 * how many people have spoken without saying what any of them said.
 *
 * @param {{ impactRatings?: Record<string, number|string> }} action
 * @returns {number}
 */
export const actionImpactVoteCount = (action) =>
  Object.keys(action?.impactRatings ?? {}).length;

/**
 * Apply the closed-action guard to a whole session blob's action list.
 *
 * Closing an action, rating it and deferring it all go through the granular
 * routes, none of which advance a session `_rev`. A full-session persist built
 * before any of that therefore clears every one of those fields while passing
 * the revision check — so the stored values win over the incoming blob's
 * silence. Only the one-way transitions are guarded: `assigneeId`, `text` and
 * proposal state stay entirely the blob's, because several session-only flows
 * legitimately set them without touching a granular route.
 *
 * Shared rather than copied because it has three call sites — the retrospective
 * handler, the health-check handler and `dataService` — and the health-check one
 * had no guard at all, so a stale blob there could erase a rating.
 *
 * @param {unknown[]|undefined} storedActions
 * @param {unknown[]|undefined} incomingActions
 * @returns {{ actions: unknown[]|undefined, changed: boolean }}
 */
export const reconcileStoredActions = (storedActions, incomingActions) => {
  if (!Array.isArray(storedActions) || !Array.isArray(incomingActions)) {
    return { actions: incomingActions, changed: false };
  }

  const storedById = new Map(storedActions.filter(Boolean).map((a) => [a.id, a]));
  let changed = false;

  const actions = incomingActions.map((incoming) => {
    if (!incoming || incoming.type === 'proposal') return incoming;
    const stored = storedById.get(incoming.id);
    if (!stored || stored.type === 'proposal') return incoming;

    const guarded = { ...incoming };
    let touched = false;

    if (stored.done && !incoming.done) {
      guarded.done = true;
      touched = true;
    }
    // Votes are owned by /action/impact alone; a session blob never carries a
    // legitimate change to them.
    if (stored.impactRatings && Object.keys(stored.impactRatings).length > 0) {
      guarded.impactRatings = { ...stored.impactRatings };
      touched = true;
    }
    if (guarded.impactDeferredBy === undefined && stored.impactDeferredBy !== undefined) {
      guarded.impactDeferredBy = stored.impactDeferredBy;
      touched = true;
    }
    if (guarded.done && !guarded.closedAt && stored.closedAt) {
      guarded.closedAt = stored.closedAt;
      touched = true;
    }

    if (!touched) return incoming;
    changed = true;
    return guarded;
  });

  return { actions: changed ? actions : incomingActions, changed };
};

/**
 * Fold a caller-supplied action onto the stored one so the fields no single
 * client owns survive a whole-object write.
 *
 * Three rules, each guarding a different way the round could silently break:
 *
 * 1. **Ratings union, never replace.** A vote is only ever added by the person
 *    who cast it, so an entry present in the store and absent from the incoming
 *    copy always means "this writer never saw it", never "this writer removed
 *    it". Clearing your own vote goes through the narrow impact route, which
 *    deletes the key directly and never travels this path.
 * 2. **`impactDeferredBy` survives omission.** A facilitator's "Rate later" is
 *    the only thing that brings an action back, so a client that never read it
 *    must not drop it.
 * 3. **`closedAt` follows `done`, and is never invented for a legacy action.**
 *    An action that arrives open has no closing moment, so the stamp goes. An
 *    action that *becomes* closed here gets stamped — which is what keeps the
 *    feature correct through a rolling update, where an older pod may close an
 *    action without stamping it. But an action already stored as closed with no
 *    stamp keeps having none: those are the pre-feature closures, and inventing
 *    a date for them would drag the entire historical backlog into the next
 *    rating round.
 *
 * Pure: returns a new object and mutates neither argument.
 *
 * @param {object|undefined} stored the action as the store currently holds it
 * @param {object} incoming the action the caller wants written
 * @param {() => string} [now] injectable clock, for deterministic tests
 * @returns {object}
 */
export const mergeActionImpactState = (
  stored,
  incoming,
  now = () => new Date().toISOString()
) => {
  const merged = { ...incoming };

  // Ratings are owned by `/api/team/:teamId/action/impact` alone, so a
  // whole-action write never contributes one. Unioning the two sides looked
  // safer and was not: clearing your own vote goes through the narrow route,
  // and any client still holding the pre-clear copy would then re-add the
  // withdrawn vote on its next unrelated write. The clear has to stick, so the
  // stored map wins outright and the caller's copy is ignored.
  if (stored?.impactRatings && Object.keys(stored.impactRatings).length > 0) {
    merged.impactRatings = { ...stored.impactRatings };
  } else {
    delete merged.impactRatings;
  }

  if (merged.impactDeferredBy === undefined && stored?.impactDeferredBy !== undefined) {
    merged.impactDeferredBy = stored.impactDeferredBy;
  }

  if (!merged.done) {
    delete merged.closedAt;
  } else if (!merged.closedAt) {
    if (stored?.closedAt) merged.closedAt = stored.closedAt;
    else if (!stored || !stored.done) merged.closedAt = now();
  }

  return merged;
};
