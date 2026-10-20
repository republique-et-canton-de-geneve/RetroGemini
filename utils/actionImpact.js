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
 *
 * ## Why the Jira link is guarded here too
 *
 * `jira` (`{ key, createdAt }`, or `{ uncertainSince }` when a creation's answer
 * was lost) is written by the Jira route alone, on the team record. It is the
 * one thing that stops a second click from creating the same issue twice, so a
 * stale write that drops it costs a duplicate in Jira, and a participant's
 * write that plants one hides the action's "Create in Jira" button. The stored
 * link therefore wins on every write path, the server keeps the stored value
 * or none and never the caller's (`withoutUnstoredJiraLinks` for the session
 * persists and the merge, `withRecordedJiraLink` for the whole-action route),
 * and the restores carry the current links onto an older archive
 * (`carryJiraLinks`).
 */

import { isJiraLinked, isJiraUncertain } from './jira.js';

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

// Whether an action carries a Jira value at all. A *stored* value wins whatever
// its shape: only the Jira route writes one and the restores carry only real
// links, so judging its shape here would merely let a stale write erase it.
const hasJiraValue = (action) => action?.jira !== undefined && action?.jira !== null;

// A copy, so a result never shares the stored link object with the store.
const copyJiraValue = (jira) => (jira && typeof jira === 'object' ? { ...jira } : jira);

// The same fields with the same values, in any key order (PostgreSQL's jsonb
// reorders keys, so a stored link and the client's copy of it rarely match
// byte for byte).
const sameJiraValue = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key]);
};

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
 * The Jira link rides the same guard, whatever either side's type: a stored
 * one is put back, and wins over whatever the blob holds — a proposal
 * included, since a blob that turns a linked action back into one would
 * otherwise drop the link or bring its own. An incoming link the store does
 * not have is left alone here, because the client runs this against a cache
 * that may simply be older than the link; the server drops it with
 * `withoutUnstoredJiraLinks`.
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
    if (!incoming || typeof incoming !== 'object') return incoming;
    const stored = storedById.get(incoming.id);
    if (!stored) return incoming;

    const guarded = { ...incoming };
    let touched = false;

    // A proposal is not an action yet: it has no closed state, votes or
    // deferral of its own, so these guards leave it to the blob.
    if (incoming.type !== 'proposal' && stored.type !== 'proposal') {
      if (stored.done && !incoming.done) {
        guarded.done = true;
        touched = true;
      }
      // Votes are owned by /action/impact alone; a session blob never carries
      // a legitimate change to them.
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
    }
    // Written by the Jira route alone, which advances no session `_rev`
    // either: the blob may predate the link, and never carries a change to it.
    // Checked whatever the type, so flipping an action to a proposal is not a
    // way around it.
    if (hasJiraValue(stored) && !sameJiraValue(guarded.jira, stored.jira)) {
      guarded.jira = copyJiraValue(stored.jira);
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
 * The Jira link follows the same "stored wins" rule as the ratings, with one
 * difference: when the store has none, the caller's is left as it is. The
 * client folds its cache through here (`dataService.updateGlobalAction`), and
 * that cache can hold a link its own copy of the store predates. The server
 * then takes the link from the team record (`withRecordedJiraLink`).
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

  if (hasJiraValue(stored)) merged.jira = copyJiraValue(stored.jira);

  if (!merged.done) {
    delete merged.closedAt;
  } else if (!merged.closedAt) {
    if (stored?.closedAt) merged.closedAt = stored.closedAt;
    else if (!stored || !stored.done) merged.closedAt = now();
  }

  return merged;
};

/**
 * Give every action of a session blob the Jira value its stored copy holds, or
 * none at all — server only.
 *
 * `actions` is not a protected session field (`server/services/sessionGuard.js`):
 * any participant's socket write can put anything on an action, and a full
 * persist would carry it into the team record. A planted link hides the
 * action's "Create in Jira" button for good; a dropped or emptied one makes
 * the next click create the issue a second time. Only the Jira route writes a
 * link, on the team record first, so a link the store does not hold was not
 * written by it — and that includes every link on an action the store does
 * not hold yet, which is how a new action would otherwise smuggle one in.
 *
 * `reconcileStoredActions` already puts a stored link back, but this is the
 * server's last word on what reaches the team record, so it does not rely on
 * that: whatever the blob says about an action — its link, its absence, or
 * its type — the result carries the stored value or nothing. Not used by the
 * client: its cache may be older than a link the server sent, and dropping it
 * there would show the button again.
 *
 * @param {unknown[]|undefined} storedActions the session's actions as stored (none for a new session)
 * @param {unknown[]|undefined} incomingActions
 * @returns {{ actions: unknown[]|undefined, changed: boolean }}
 */
export const withoutUnstoredJiraLinks = (storedActions, incomingActions) => {
  if (!Array.isArray(incomingActions)) return { actions: incomingActions, changed: false };

  // By id, the last copy winning as in `reconcileStoredActions`. Only an
  // action with an id can have been linked: the Jira route addresses it by id.
  const storedJira = new Map();
  for (const stored of Array.isArray(storedActions) ? storedActions : []) {
    if (hasJiraValue(stored) && typeof stored.id === 'string') storedJira.set(stored.id, stored.jira);
  }
  let changed = false;

  const actions = incomingActions.map((incoming) => {
    if (!incoming || typeof incoming !== 'object') return incoming;
    if (storedJira.has(incoming.id)) {
      const jira = storedJira.get(incoming.id);
      if (sameJiraValue(incoming.jira, jira)) return incoming;
      changed = true;
      return { ...incoming, jira: copyJiraValue(jira) };
    }
    if (incoming.jira === undefined) return incoming;
    changed = true;
    const { jira: _unstored, ...rest } = incoming;
    return rest;
  });

  return { actions: changed ? actions : incomingActions, changed };
};

// The homes of an action on a team record. One id can live in several at once
// (deleting a session copies its actions into the backlog), and the Jira route
// writes the link on every copy.
const forEachActionList = (team, visit) => {
  visit(team?.globalActions);
  for (const list of ['retrospectives', 'healthChecks']) {
    if (!Array.isArray(team?.[list])) continue;
    for (const entry of team[list]) visit(entry?.actions);
  }
};

// Every Jira link and uncertain marker a team record holds, by action id,
// across every home. A key beats a marker when the copies disagree. A value
// that is neither (anything the Jira route did not write) is not indexed, so
// it never spreads to another copy.
const indexJiraLinks = (team) => {
  const links = new Map();
  forEachActionList(team, (actions) => {
    if (!Array.isArray(actions)) return;
    for (const action of actions) {
      if (!action || typeof action.id !== 'string') continue;
      const linked = isJiraLinked(action);
      if (!linked && !isJiraUncertain(action)) continue;
      const known = links.get(action.id);
      if (known && (known.linked || !linked)) continue;
      links.set(action.id, { jira: action.jira, linked });
    }
  });
  return links;
};

/**
 * A whole-action write with its Jira value taken from the team record, never
 * from the caller — server only (`/api/team/:teamId/action`).
 *
 * `mergeActionImpactState` leaves the caller's link when the stored copy has
 * none, because the client folds its cache through it. On the server that
 * would let any team session write a link straight onto the team record, where
 * the Jira route decides "already linked": the action's "Create in Jira"
 * button would be gone for good, and both restores would carry the planted
 * link (`carryJiraLinks`).
 *
 * The stored copy's value stays, whatever its shape, for the reason
 * `mergeActionImpactState` keeps it. Without one, the link or marker another
 * home of the same id holds is the action's — the route adds a backlog copy of
 * an action only a session held so far, and that action may be in Jira.
 * Otherwise the result has no `jira` at all.
 *
 * Pure: returns a new object and mutates no argument.
 *
 * @param {object} team the team record the write lands on, before it lands
 * @param {object|undefined} stored the copy being written, as stored (none for a new copy)
 * @param {object} merged the action about to be written
 * @returns {object}
 */
export const withRecordedJiraLink = (team, stored, merged) => {
  const result = { ...merged };
  const recorded = hasJiraValue(stored) ? stored.jira : indexJiraLinks(team).get(merged?.id)?.jira;
  if (recorded === undefined) delete result.jira;
  else result.jira = copyJiraValue(recorded);
  return result;
};

/**
 * The archived team with the current team's Jira links carried onto it — for
 * the whole-store and the single-team restore alike.
 *
 * A restore puts back an archive taken before some issues were created. The
 * issues exist in Jira and the team's token stays (a restore never rolls a
 * credential back), so without this the restored actions read as unlinked and
 * the next click creates every one of them a second time.
 *
 * Every link and uncertain marker of the current record is indexed by action
 * id, across every home, and set on every archived copy of that id that has no
 * Jira value of its own. A key beats an uncertain marker when the current
 * copies disagree. An archived value is never overwritten, and a current value
 * that is neither a link nor a marker (anything the Jira route did not write)
 * is not carried.
 *
 * Pure: returns a new team object and mutates neither argument.
 *
 * @param {object} archivedTeam the team as the archive holds it
 * @param {object|null|undefined} currentTeam the live record, or nothing when there is none
 * @returns {object}
 */
export const carryJiraLinks = (archivedTeam, currentTeam) => {
  const links = indexJiraLinks(currentTeam);

  const team = { ...archivedTeam };
  if (links.size === 0) return team;

  const carry = (actions) => actions.map((action) => {
    if (!action || typeof action !== 'object' || hasJiraValue(action)) return action;
    const link = links.get(action.id);
    return link ? { ...action, jira: copyJiraValue(link.jira) } : action;
  });

  if (Array.isArray(team.globalActions)) team.globalActions = carry(team.globalActions);
  for (const list of ['retrospectives', 'healthChecks']) {
    if (!Array.isArray(team[list])) continue;
    team[list] = team[list].map((entry) =>
      entry && typeof entry === 'object' && Array.isArray(entry.actions) ? { ...entry, actions: carry(entry.actions) } : entry
    );
  }
  return team;
};
