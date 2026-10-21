/**
 * Creating Jira issues from actions — the batch behind `/jira/issues`.
 *
 * The route authenticates, checks the body, the connection, the team's token
 * and the target, then hands this module a request of one to ten action ids.
 * It answers `{ results, remaining, stopped?, retryAfterSeconds? }`: one result
 * per id attempted, in order, and the ids it did not attempt, which the client
 * sends again in its next request (`types.ts` → `JiraIssuesResponse`).
 *
 * ## Never twice
 *
 * RetroGemini must never create the same action twice, and a click is not the
 * only way it could: two tabs, two pods, a retry after a lost answer. So an
 * action is *claimed* before Jira is called, inside `atomicTeamUpdate` — one
 * transaction holding the team's row, so the claim is exclusive across pods —
 * in `team.jiraClaims[actionId] = { at, requestId }`, a server-only field
 * (stripped from every response, ignored by `/update`). Under that lock:
 *
 *  - an action that has a key is `already_linked`, one marked uncertain is
 *    skipped unless the facilitator confirmed (`force`), and one claimed less
 *    than `claimTtlMs` ago is `in_progress`;
 *  - an older claim means the request that made it died mid-creation, and the
 *    issue may exist: the action is marked uncertain, never created on a guess
 *    (`force` does not change that: it only lifts the uncertain skip);
 *  - an action with no text is `refused` with `reason: 'no_text'` and no
 *    message: Jira would refuse an issue with no summary, so nothing is
 *    claimed and nothing is sent. The reason is what tells it from a refusal
 *    Jira gave without words (a gateway's page, an empty `errors` object),
 *    which is answered `refused` with no message and no reason.
 *
 * Jira's answer then decides. A 201 writes the key on every copy of the action
 * and drops the claim — unless another request linked the action meanwhile,
 * in which case the key already there stays on every copy, the action is
 * answered `already_linked` with it, and the duplicate is logged for an
 * administrator to delete (`writeLink`). A definite refusal (a 4xx, or a
 * request that never left) drops the claim, so the action can be tried again.
 * A 400 belongs to its action and the batch goes on — unless Jira named a
 * field the *target* sets (`TARGET_FIELDS`: labels a create screen lacks, an
 * issue type or a parent the project refuses), which every action would be
 * refused for in turn: the batch then stops (`jira_target_refused`) after that
 * one refusal, the rest left for when the target is fixed. An answer that was
 * lost — a 5xx, a timeout after the request was sent, a connection cut — marks
 * every copy `jira: { uncertainSince }`: the facilitator checks Jira and then
 * creates it anyway or not — unless another request linked the action
 * meanwhile, and then its key wins there too, as for a 201.
 *
 * Writing the key is retried (`linkWriteRetries`) because the issue exists by
 * then: a key that cannot be saved is answered `created_not_saved` with the key
 * and stops the batch (`link_not_saved`), and the claim it leaves behind turns
 * into an uncertain mark once it expires, so even then nothing is re-created.
 *
 * The key of one action is written by the same write that claims the next, so
 * a batch costs one team write per action plus one at the end.
 *
 * ## A request is short
 *
 * An OpenShift route gives up on a request after 30 s by default, and the user
 * would then see an error while the server went on creating. So no new
 * creation starts after `timeBudgetMs` (the first always does, or a slow Jira
 * would answer every request with nothing done and the client would loop), and
 * none starts once the caller has gone (`client_gone`) or the pod is draining
 * (`server_restarting`). What was not attempted is `remaining`.
 *
 * ## The live session
 *
 * Every participant must see the keys, and the previous actions a retro shows
 * live only in its session row (`historyActionsSnapshot`). After the loop, each
 * session that holds an affected action — and the one the request names, when
 * it is the team's — is patched once, through the session compare-and-swap.
 * Once and not once per issue: each patch moves the session's revision, and a
 * facilitator typing the review summary meanwhile has every keystroke built on
 * the previous revision refused (finding A-4). A parent issue is never put on a
 * session row, so a request that created only a parent patches nothing.
 *
 * ## One parent per session (`sessionParent` mode)
 *
 * In `sessionParent` mode each action is a sub-task of its session's parent
 * issue: one per retrospective, one per health check, and one for the team
 * dashboard's actions (`jiraParentScope`: `retro:<id>`, `healthcheck:<id>`,
 * `backlog`). The parent is created the first time one of its actions is sent
 * and its key is stored on the team record, in `team.jiraParents[scope]` —
 * with the sub-task type to use under it, so a parent in another project than
 * the target's keeps a type valid there — and every later send of that scope's
 * actions reuses it: the Review batch, one action sent alone, the Dashboard.
 *
 * A parent is claimed exactly like an action, and for the same reason: never
 * twice. Under the row lock, in `team.jiraParentClaims[scope]` (server-only,
 * a map of its own so an action id cannot collide with a scope):
 *
 *  - a parent is only ever claimed for an action that is about to be sent —
 *    every reason to skip or refuse the action is decided first;
 *  - a live claim of another request answers the action `parent_in_progress`;
 *    an expired one marks the *scope* `{ uncertainSince }`, dated by the
 *    claim, and the action `parent_uncertain`: nothing was sent for it;
 *  - a scope marked uncertain is skipped unless the facilitator confirmed
 *    (`forceParent`, which lifts that skip and nothing else, as `force` lifts
 *    an action's). A forced parent keeps the mark until its key lands, so a
 *    lost answer keeps the earlier date and a refusal the earlier doubt.
 *
 * Each claim spans exactly one Jira call. The parent's 201 is written by one
 * write that stores its key, drops the parent claim and claims the action
 * under that key; a key another request stored meanwhile wins (`kept`), and
 * this request's parent is logged as a duplicate. A lost answer marks the
 * scope, never the action, and stops the batch; a refusal stops it too
 * (`jira_parent_refused`), since the same type, project and labels go on every
 * parent. A parent counts as one creation for the time budget, and nothing
 * new starts after its write once the caller has gone or the pod drains.
 *
 * ## Naming the parent at send time
 *
 * A `parent`-mode one-time target names the parent this send goes under. With
 * `adoptParent`, it also becomes the stored parent of each scope the send
 * touches that has no key (or only a mark, or only an expired claim; with
 * `replaceParents`, even one with a key) — but only in the write that stores
 * the key of a sub-task Jira created under it (`adoptParent`). A parent Jira
 * refuses sub-tasks under, a lost answer, a key that cannot be saved: none of
 * them changes any scope.
 */

import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { isJiraIssueTypeId, isJiraLinked, isJiraUncertain, jiraProjectKeyOf, JIRA_CLAIM_TTL_MS } from '../../utils/jira.js';
import { issueFields, issueSource, jiraParentScope, parentIssueFields } from '../../utils/jiraIssueContent.js';
import { cannotHoldSubtasks, JiraError, logUnreachable } from './jiraClient.js';
import { NO_OP_LIVE_SESSION_PATCH } from './liveSessionRename.js';

/** The session lists that can show an action, all of them stamped by the patch. */
export const SESSION_ACTION_LISTS = ['actions', 'openActionsSnapshot', 'historyActionsSnapshot'];

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const arrayOf = (value) => (Array.isArray(value) ? value : []);

/**
 * Every copy of one action on a team record, with the session that holds it
 * (`null` for the backlog). One id can live in several homes at once —
 * deleting a session copies its actions into the backlog, and the whole-action
 * route adds a backlog copy of an action only a session held — and every copy
 * is the same action. A proposal is not an action yet and is not a copy.
 */
const actionCopies = (team, actionId) => {
  const copies = [];
  const visit = (actions, kind, home) => {
    for (const action of arrayOf(actions)) {
      if (isPlainObject(action) && action.id === actionId && action.type !== 'proposal') copies.push({ action, kind, home });
    }
  };
  visit(team.globalActions, 'backlog', null);
  for (const retro of arrayOf(team.retrospectives)) if (isPlainObject(retro)) visit(retro.actions, 'retro', retro);
  for (const check of arrayOf(team.healthChecks)) if (isPlainObject(check)) visit(check.actions, 'healthcheck', check);
  return copies;
};

const homeSessionIds = (copies) => copies.filter(({ home }) => typeof home?.id === 'string').map(({ home }) => home.id);

// The claims of a record, in an object with no prototype: the keys are action
// ids a client chose, and `__proto__` must be a key here like any other.
// Written back as a plain object (spread defines own properties), and removed
// when empty.
const claimsOf = (team) => Object.assign(Object.create(null), isPlainObject(team.jiraClaims) ? team.jiraClaims : {});
const storeClaims = (team, claims) => {
  if (Object.keys(claims).length === 0) delete team.jiraClaims;
  else team.jiraClaims = { ...claims };
};

// A claim is authoritative for `ttl` after it was made. One dated far in the
// future (another pod's clock, a hand edit) is not, or it would block its
// action until that date; one that cannot be read at all is not either.
const isLiveClaim = (claim, nowMs, ttl) => {
  const at = Date.parse(claim?.at);
  if (!Number.isFinite(at)) return false;
  const age = nowMs - at;
  return age < ttl && age > -ttl;
};

// The mark an expired claim leaves: dated by the claim, never by a date that
// is unreadable or to come.
const markOfExpiredClaim = (claim, nowMs, nowIso) => {
  const claimedAt = typeof claim?.at === 'string' ? Date.parse(claim.at) : NaN;
  return { uncertainSince: Number.isFinite(claimedAt) && claimedAt <= nowMs ? claim.at : nowIso };
};

// The parents of a record (`sessionParent` mode) and the claims on parents
// being created, each like `claimsOf`: keyed by scope (`retro:<id>`,
// `healthcheck:<id>`, `backlog`), with no prototype, written back as a plain
// object and removed when empty. The claims are a map of their own: an action
// id is a client's string, and one could be called `retro:x`.
const parentsOf = (team) => Object.assign(Object.create(null), isPlainObject(team.jiraParents) ? team.jiraParents : {});
const storeParents = (team, parents) => {
  if (Object.keys(parents).length === 0) delete team.jiraParents;
  else team.jiraParents = { ...parents };
};
const parentClaimsOf = (team) => Object.assign(Object.create(null), isPlainObject(team.jiraParentClaims) ? team.jiraParentClaims : {});
const storeParentClaims = (team, claims) => {
  if (Object.keys(claims).length === 0) delete team.jiraParentClaims;
  else team.jiraParentClaims = { ...claims };
};

// Drops the claim on a scope's parent if this request made it.
const releaseOwnParentClaim = (team, scope, requestId) => {
  const claims = parentClaimsOf(team);
  if (claims[scope]?.requestId !== requestId) return false;
  delete claims[scope];
  storeParentClaims(team, claims);
  return true;
};

/**
 * Writes a created parent's key for its scope and drops this request's claim
 * on it. A key already there wins, as for an action (`writeLink`): `kept`
 * names it, and the caller logs the parent this request created as a
 * duplicate to delete in Jira. A key replaces a mark. Idempotent: a retried
 * write that finds its own key changes nothing.
 *
 * @returns {{ changed: boolean, kept: { key: string, createdAt: string } | null }}
 */
const writeParentLink = (team, scope, link, requestId) => {
  const parents = parentsOf(team);
  const held = parents[scope];
  let kept = null;
  let stored = false;
  if (isJiraLinked({ jira: held })) {
    if (held.key !== link.key) kept = { ...held };
  } else {
    parents[scope] = { ...link };
    storeParents(team, parents);
    stored = true;
  }
  const released = releaseOwnParentClaim(team, scope, requestId);
  return { changed: stored || released, kept };
};

/**
 * The parent named for a send becoming a scope's parent (`adoptParent`). Run
 * only in the write that lands the key of a sub-task created under it, so a
 * scope never adopts an issue Jira has not accepted a sub-task under. It
 * writes when the scope has no key, only a mark, or only an expired parent
 * claim — or a key, with `replace` — and drops that expired claim; it writes
 * nothing beside a live parent claim, which another request is acting on.
 * Idempotent, so the retried landing write may run it twice: `holds` says the
 * scope's parent is that key afterwards, written now or before.
 *
 * @returns {{ changed: boolean, holds: boolean }}
 */
const adoptParent = (team, { scope, key, subtaskTypeId, replace }, { nowMs, nowIso, claimTtlMs }) => {
  const parents = parentsOf(team);
  const claims = parentClaimsOf(team);
  const held = parents[scope];
  const holdsKey = isJiraLinked({ jira: held }) && held.key === key;
  if (claims[scope] !== undefined && isLiveClaim(claims[scope], nowMs, claimTtlMs)) return { changed: false, holds: holdsKey };
  if (holdsKey || (isJiraLinked({ jira: held }) && !replace)) return { changed: false, holds: holdsKey };
  parents[scope] = { key, createdAt: nowIso, ...(isJiraIssueTypeId(subtaskTypeId) ? { subtaskTypeId } : {}) };
  storeParents(team, parents);
  if (claims[scope] !== undefined) {
    delete claims[scope];
    storeParentClaims(team, claims);
  }
  return { changed: true, holds: true };
};

// Puts `jira` on every copy that has no key. A key is never replaced — not by
// a mark, not by another key — and a key replaces a mark.
const stampCopies = (copies, jira) => {
  let changed = false;
  for (const { action } of copies) {
    if (isJiraLinked(action) || isDeepStrictEqual(action.jira, jira)) continue;
    action.jira = { ...jira };
    changed = true;
  }
  return changed;
};

// Drops the claim on `actionId` if this request made it. Another request's
// claim is that request's to drop.
const releaseOwnClaim = (team, actionId, requestId) => {
  const claims = claimsOf(team);
  if (claims[actionId]?.requestId !== requestId) return false;
  delete claims[actionId];
  storeClaims(team, claims);
  return true;
};

/**
 * Writes a created issue's key on every copy and drops this request's claim.
 * Idempotent: a retried write that finds the key already there changes
 * nothing. An action deleted while Jira created its issue has no copy left to
 * hold the key; the issue exists all the same.
 *
 * A key already there wins. If a copy holds another valid key — another
 * request linked the action between this one's claim and Jira's answer, which
 * takes pods whose clocks disagree by more than the claim's lifetime — that
 * key goes on every copy instead, and `kept` names it: the action is in Jira
 * twice now, and the record must still name one issue, the one everybody may
 * already have seen. The caller answers `already_linked` and logs the
 * duplicate.
 *
 * @returns {{ changed: boolean, kept: { key: string, createdAt: string } | null }}
 */
const writeLink = (team, { actionId, key, createdAt }, requestId) => {
  const copies = actionCopies(team, actionId);
  const rival = copies.find(({ action }) => isJiraLinked(action) && action.jira.key !== key);
  const kept = rival ? { ...rival.action.jira } : null;
  const stamped = stampCopies(copies, kept ?? { key, createdAt });
  const released = releaseOwnClaim(team, actionId, requestId);
  return { changed: stamped || released, kept };
};

/**
 * What the claim step decides for one action, on the record as the row lock
 * holds it. Mutates `team` when it claims, or when it turns an expired claim
 * into an uncertain mark, and says so with `wrote`.
 *
 * The order is the point: `not_found`, `closed`, `already_linked`, the
 * action's own mark (unless `force`), the action's claim, no text — and only
 * then, for an action about to be sent, its parent. So a parent is never
 * created for an action that would be refused or skipped.
 *
 *  - `adoption` (a `parent`-mode send naming its parent with `adoptParent`):
 *    the action is claimed, and `adopt` says which scope may adopt the parent
 *    once a sub-task of it has landed there. Nothing about the scope is
 *    written here.
 *  - `sessionParent` mode: under the scope's stored key (`parentLink`), the
 *    action is claimed. Otherwise the scope's parent is claimed instead
 *    (`claimedParent`, with its content) and the action is not: the write
 *    that stores the parent's key claims it. A live claim of another request
 *    answers `parent_in_progress`, an expired one marks the scope, and a
 *    marked scope is skipped unless `forceParent`; none of them sends the
 *    action (`parentStatus` says what the scope's parent is).
 */
const decideClaim = (team, {
  actionId,
  force,
  forceParent,
  target,
  adoption,
  nowMs,
  nowIso,
  claimTtlMs,
  requestId,
  requestedBy,
  language,
  sessionId
}) => {
  const copies = actionCopies(team, actionId);
  if (copies.length === 0) return { wrote: false, result: { status: 'not_found' } };

  const homes = homeSessionIds(copies);
  if (copies.some(({ action }) => action.done === true)) return { wrote: false, homes, result: { status: 'closed' } };

  const linked = copies.find(({ action }) => isJiraLinked(action));
  if (linked) {
    return { wrote: false, homes, jira: { ...linked.action.jira }, result: { status: 'already_linked', key: linked.action.jira.key } };
  }

  const marked = copies.find(({ action }) => isJiraUncertain(action));
  if (marked && !force) return { wrote: false, homes, jira: { ...marked.action.jira }, result: { status: 'uncertain' } };

  const claims = claimsOf(team);
  const claim = claims[actionId];
  // This request's own claim, from an attempt of this very write that landed
  // although it was reported as failed (a connection lost on COMMIT): ids are
  // unique in a request, so it is the claim to proceed with, not a rival.
  const ownClaim = claim?.requestId === requestId;
  if (claim !== undefined && !ownClaim) {
    if (isLiveClaim(claim, nowMs, claimTtlMs)) return { wrote: false, homes, result: { status: 'in_progress' } };
    // The request that made it never finished: its issue may exist. The mark
    // is dated by the claim, never by a date that is unreadable or to come.
    const jira = markOfExpiredClaim(claim, nowMs, nowIso);
    stampCopies(copies, jira);
    delete claims[actionId];
    storeClaims(team, claims);
    return { wrote: true, homes, jira, result: { status: 'uncertain' } };
  }

  // The issue's content, built here because the record is at hand, by the
  // rule the dialog's preview follows (`issueSource`): the request's own
  // session when it holds the action, else the first retro, then the first
  // health check; the session's copy overlaid by the backlog copy.
  const source = issueSource({ team, actionId, preferredSessionId: sessionId });
  const fields = issueFields({
    action: source.action,
    session: source.session,
    kind: source.kind,
    team,
    requestedBy,
    language
  });
  // An action with no text would reach Jira as an issue with no summary,
  // sent with the team's token only to be refused. The builder leaves that
  // refusal to its caller: refused here, with nothing claimed — and this
  // request's own claim, if a lost answer left one, dropped.
  if (fields.summary === '') {
    if (ownClaim) {
      delete claims[actionId];
      storeClaims(team, claims);
    }
    return { wrote: ownClaim, homes, result: { status: 'refused', reason: 'no_text', jiraMessages: [] } };
  }

  const content = { summary: fields.summary, description: fields.description };
  const claimAction = (extra) => {
    claims[actionId] = { at: nowIso, requestId };
    storeClaims(team, claims);
    return { wrote: true, homes, claimed: true, content, ...extra };
  };
  if (adoption) {
    const scope = jiraParentScope(source).key;
    return claimAction({ adopt: { scope, key: adoption.key, subtaskTypeId: adoption.subtaskTypeId, replace: adoption.replace === true } });
  }
  if (target?.mode !== 'sessionParent') return claimAction({});

  // The parent the action goes under, from the very `issueSource` its
  // content was written from: an earlier action sent from a later retro's
  // Review goes under its own retro's parent.
  const scope = jiraParentScope(source);
  const parents = parentsOf(team);
  const held = parents[scope.key];
  if (isJiraLinked({ jira: held })) return claimAction({ scope: scope.key, parentLink: { ...held } });

  // Not sent in this write: this request's own claim on the action, if a
  // lost answer left one, is dropped, as for an action with no text.
  const notSent = (decision) => {
    if (ownClaim) {
      delete claims[actionId];
      storeClaims(team, claims);
    }
    return { ...decision, wrote: decision.wrote === true || ownClaim, homes, scope: scope.key };
  };

  const parentClaims = parentClaimsOf(team);
  const parentClaim = parentClaims[scope.key];
  // This request's own claim, from an attempt of this very write that landed
  // although it was reported as failed: the claim to proceed with.
  const ownParentClaim = parentClaim?.requestId === requestId;
  if (parentClaim !== undefined && !ownParentClaim) {
    if (isLiveClaim(parentClaim, nowMs, claimTtlMs)) {
      return notSent({ result: { status: 'parent_in_progress' }, parentStatus: { status: 'in_progress' } });
    }
    // The request that claimed it died mid-creation: the parent may exist.
    // An earlier mark is kept, since it dates when the doubt began.
    const mark = isJiraUncertain({ jira: held }) ? { ...held } : markOfExpiredClaim(parentClaim, nowMs, nowIso);
    parents[scope.key] = mark;
    storeParents(team, parents);
    delete parentClaims[scope.key];
    storeParentClaims(team, parentClaims);
    return notSent({ wrote: true, result: { status: 'parent_uncertain' }, parentStatus: { status: 'uncertain', uncertainSince: mark.uncertainSince } });
  }
  if (isJiraUncertain({ jira: held }) && !forceParent && !ownParentClaim) {
    return notSent({ result: { status: 'parent_uncertain' }, parentStatus: { status: 'uncertain', uncertainSince: held.uncertainSince } });
  }
  if (!ownParentClaim) {
    parentClaims[scope.key] = { at: nowIso, requestId };
    storeParentClaims(team, parentClaims);
  }
  return notSent({
    wrote: !ownParentClaim,
    claimedParent: true,
    parentContent: parentIssueFields({ scope, team, requestedBy, language })
  });
};

/**
 * The entries of a live session that show an affected action, given the Jira
 * value the team record now holds; `null` when every entry already has it.
 * A key the session shows is never replaced by a mark, as on the record
 * (`stampCopies`): the row can be ahead of the record, patched by another
 * request with the key it created.
 */
const stampSession = (session, links) => {
  let changed = false;
  const next = { ...session };
  for (const field of SESSION_ACTION_LISTS) {
    if (!Array.isArray(session[field])) continue;
    let listChanged = false;
    const list = session[field].map((entry) => {
      if (!isPlainObject(entry) || !links.has(entry.id)) return entry;
      const jira = links.get(entry.id);
      if (isDeepStrictEqual(entry.jira, jira)) return entry;
      if (isJiraLinked(entry) && !isJiraLinked({ jira })) return entry;
      listChanged = true;
      return { ...entry, jira: { ...jira } };
    });
    if (listChanged) {
      next[field] = list;
      changed = true;
    }
  }
  return changed ? next : null;
};

// The stop a failed parent lookup ends the request with. Nothing was created:
// it is a read.
const parentStop = (err) => {
  switch (err.code) {
    case 'jira_not_found': return 'jira_parent_invalid';
    case 'jira_auth_failed': return 'token_refused';
    case 'jira_forbidden': return 'jira_forbidden';
    case 'jira_rate_limited': return 'jira_rate_limited';
    case 'jira_unreachable': return 'jira_unreachable';
    default: return 'jira_unavailable';
  }
};

// The fields of an issue the target sets, the same for every action of a
// batch: Jira refusing one of them refuses every action the same way. The
// summary and the description are the action's own, and a custom field Jira
// requires is reported per action, as the plan has it (Jira's own words).
const TARGET_FIELDS = new Set(['project', 'issuetype', 'parent', 'labels']);
const refusesTheTarget = (err) => err.jiraFields.some((field) => TARGET_FIELDS.has(field));

// The stop a definite refusal of a creation ends the batch with. A 400 is not
// one: it belongs to its action, and the batch goes on (unless it refuses the
// target, `refusesTheTarget`).
const refusalStop = (err) => {
  switch (err.code) {
    case 'jira_auth_failed': return 'token_refused';
    case 'jira_forbidden': return 'jira_forbidden';
    case 'jira_not_found': return 'jira_not_found';
    case 'jira_rate_limited': return 'jira_rate_limited';
    case 'jira_unreachable': return 'jira_unreachable';
    // A redirect: whatever answers at that address is not Jira's REST API.
    default: return 'jira_unavailable';
  }
};

/**
 * @param {object} deps
 * @param {(teamId: string, updater: Function) => Promise<{ success: boolean, team?: object, error?: string }>} deps.atomicUpdateTeam
 * @param {(teamId: string, envelope: object) => Promise<boolean>} deps.markRefused Records a Jira 401 against the token used.
 * @param {Function} [deps.liveSessionPatch]
 * @param {() => boolean} [deps.isShuttingDown]
 * @param {() => Date} [deps.now] Dates the claims, links and marks, and measures the time budget.
 * @param {number} [deps.timeBudgetMs] No creation starts after this long, the first excepted.
 * @param {number} [deps.claimTtlMs]
 * @param {number} [deps.linkWriteRetries] Further attempts at writing a created issue's key.
 * @param {() => string} [deps.createRequestId]
 */
export const createJiraIssues = ({
  atomicUpdateTeam,
  markRefused,
  liveSessionPatch = NO_OP_LIVE_SESSION_PATCH,
  isShuttingDown = () => false,
  now = () => new Date(),
  timeBudgetMs = 10000,
  claimTtlMs = JIRA_CLAIM_TTL_MS,
  linkWriteRetries = 2,
  createRequestId = randomUUID
}) => {
  /**
   * @param {object} input
   * @param {string} input.teamId
   * @param {{
   *   actionIds: string[], sessionId: string | null, requestedBy: string, language: string | null, force: boolean,
   *   adoptParent?: boolean, replaceParents?: boolean, forceParent?: boolean
   * }} input.request
   * @param {{
   *   mode: 'project' | 'parent' | 'sessionParent', projectKey?: string, parentKey?: string,
   *   parentIssueTypeId?: string, issueTypeId: string, labels: string[]
   * }} input.target
   * @param {object} input.client The Jira client, built with the team's token.
   * @param {object} input.envelope The stored token envelope the client was built from.
   * @param {() => boolean} [input.isClientGone]
   * @returns {Promise<{ results: object[], remaining: string[], stopped?: string, retryAfterSeconds?: number, parents?: object[] }>}
   */
  const createIssues = async ({ teamId, request, target, client, envelope, isClientGone = () => false }) => {
    const { actionIds, sessionId, requestedBy, language, force } = request;
    const forceParent = request.forceParent === true;
    const requestId = createRequestId();
    const startedAt = now().getTime();

    const results = [];
    let next = 0;
    let stopped;
    let retryAfterSeconds;
    // The Jira value the record now holds for each action this request
    // touched, and the sessions to carry it into.
    const links = new Map();
    const sessions = new Set(sessionId ? [sessionId] : []);
    const touch = (actionId, jira, homes) => {
      links.set(actionId, jira);
      for (const id of homes) sessions.add(id);
    };
    // What became of each scope's parent, one entry per scope met: the first
    // status wins, except that a parent created or adopted after another
    // request's was seen in progress is what the scope has now.
    const parentResults = new Map();
    const noteParent = (entry) => {
      const known = parentResults.get(entry.scope);
      if (!known || (known.status === 'in_progress' && (entry.status === 'created' || entry.status === 'adopted'))) {
        parentResults.set(entry.scope, entry);
      }
    };
    // Set once the parent of a `parent`-mode send is read: what a scope may
    // adopt when `adoptParent` asks for it.
    let adoption = null;

    const decide = (team, actionId, nowDate) => decideClaim(team, {
      actionId,
      force,
      forceParent,
      target,
      adoption,
      nowMs: nowDate.getTime(),
      nowIso: nowDate.toISOString(),
      claimTtlMs,
      requestId,
      requestedBy,
      language,
      sessionId
    });

    // A write after Jira answered (dropping a claim, marking an action) that
    // fails is logged, never fatal: the claim it leaves expires into an
    // uncertain mark, which is the safe way to be wrong.
    const bestEffortWrite = async (updater, what) => {
      try {
        const result = await atomicUpdateTeam(teamId, updater);
        return result.success === true;
      } catch (err) {
        console.error(`[Server] Jira: could not ${what} for team ${JSON.stringify(teamId)}`, err);
        return false;
      }
    };
    const releaseClaim = (actionId) => bestEffortWrite(
      (team) => (releaseOwnClaim(team, actionId, requestId) ? team : null),
      `release the claim on action ${JSON.stringify(actionId)}`
    );
    const releaseParentClaim = (scope) => bestEffortWrite(
      (team) => (releaseOwnParentClaim(team, scope, requestId) ? team : null),
      `release the claim on the parent issue of ${JSON.stringify(scope)}`
    );

    /**
     * Lands a created key in the write under way (`writeLink`), and adopts its
     * parent when the send named one with `adoptParent` (`adoptParent`): the
     * same write, so a scope adopts a parent exactly when a sub-task of it
     * under that parent is stored. A retried write cannot tell its own landed
     * adoption from one made before; it reports the scope as adopted when the
     * scope holds that key.
     */
    const landPending = (team, landing, nowDate, attempt) => {
      const link = writeLink(team, landing, requestId);
      const adopted = landing.adopt
        ? adoptParent(team, landing.adopt, { nowMs: nowDate.getTime(), nowIso: nowDate.toISOString(), claimTtlMs })
        : null;
      return {
        changed: link.changed || adopted?.changed === true,
        kept: link.kept,
        adopted: adopted !== null && (adopted.changed || (attempt > 0 && adopted.holds))
      };
    };

    /**
     * The claim step for `actionId`, carrying the key of the action created
     * just before (`pending`). With a key on board the write is retried, since
     * that issue exists; `{ linkFailed: true }` when it never lands.
     */
    const claimWrite = async (actionId, pending) => {
      const attempts = pending ? linkWriteRetries + 1 : 1;
      let lastError;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const nowDate = now();
        let decision = null;
        let landing = null;
        try {
          const result = await atomicUpdateTeam(teamId, (team) => {
            landing = pending ? landPending(team, pending, nowDate, attempt) : null;
            decision = decide(team, actionId, nowDate);
            return landing?.changed || decision.wrote ? team : null;
          });
          // The team is gone: nothing of it can be claimed, nor hold a key.
          if (!result.success) return pending ? { linkFailed: true, error: result.error } : { decision: { result: { status: 'not_found' } } };
          return { decision, kept: landing?.kept ?? null, adopted: landing?.adopted === true };
        } catch (err) {
          if (!pending) throw err;
          lastError = err;
        }
      }
      return { linkFailed: true, error: lastError };
    };

    /**
     * Stores a created parent's key (`writeParentLink`), and — while a new
     * creation may still start (`mayContinue`) — claims the action under the
     * key the scope now holds, in the same write: the parent's claim and the
     * action's never overlap, and each spans one Jira call. Retried, since the
     * parent exists; `{ failed: true }` when it never lands.
     */
    const parentWrite = async (scope, link, actionId, mayContinue) => {
      let cause;
      for (let attempt = 0; attempt <= linkWriteRetries; attempt += 1) {
        const nowDate = now();
        let written = null;
        let decision = null;
        try {
          const result = await atomicUpdateTeam(teamId, (team) => {
            written = writeParentLink(team, scope, link, requestId);
            decision = mayContinue ? decide(team, actionId, nowDate) : null;
            return written.changed || decision?.wrote ? team : null;
          });
          // The team is gone; retrying cannot bring it back.
          if (!result.success) return { failed: true, cause: result.error };
          return { kept: written.kept, decision };
        } catch (err) {
          cause = err;
        }
      }
      return { failed: true, cause };
    };

    // The last created key, written by the claim of the next action or by
    // `flush` at the end: one team write per action.
    let pending = null;
    // `kept`: the key another request had written meanwhile, which the record
    // keeps (see `writeLink`). The issue this request created is a duplicate
    // nothing points to, so the line names everything needed to delete it.
    const landed = (landing, kept, adopted) => {
      const { actionId, key, createdAt, homes, parentKey } = landing;
      if (adopted) noteParent({ scope: landing.adopt.scope, status: 'adopted', key: landing.adopt.key });
      if (kept) {
        console.error(
          `[Server] Jira issue ${key} was created for action ${JSON.stringify(actionId)} of team ${JSON.stringify(teamId)}, `
            + `which another request had linked to ${kept.key} meanwhile: the action keeps ${kept.key}, `
            + `and ${key} is a duplicate to delete in Jira`
        );
        results.push({ actionId, status: 'already_linked', key: kept.key });
        touch(actionId, kept, homes);
        return;
      }
      results.push({ actionId, status: 'created', key, ...(parentKey ? { parentKey } : {}) });
      touch(actionId, { key, createdAt }, homes);
    };
    // The issue exists and the team record does not say so: the one outcome
    // an operator may have to repair by hand, so the line names all three.
    const notSaved = ({ actionId, key, parentKey }, cause) => {
      console.error(
        `[Server] Jira issue ${key} was created for action ${JSON.stringify(actionId)} of team ${JSON.stringify(teamId)}, `
          + 'but its key could not be saved',
        cause
      );
      results.push({ actionId, status: 'created_not_saved', key, ...(parentKey ? { parentKey } : {}) });
      stopped = 'link_not_saved';
    };
    const flush = async () => {
      if (!pending) return;
      const landing = pending;
      pending = null;
      let cause;
      for (let attempt = 0; attempt <= linkWriteRetries; attempt += 1) {
        try {
          let written = null;
          const nowDate = now();
          const result = await atomicUpdateTeam(teamId, (team) => {
            written = landPending(team, landing, nowDate, attempt);
            return written.changed ? team : null;
          });
          if (result.success) {
            landed(landing, written?.kept ?? null, written?.adopted === true);
            return;
          }
          // The team is gone; retrying cannot bring it back.
          cause = result.error;
          break;
        } catch (err) {
          cause = err;
        }
      }
      notSaved(landing, cause);
    };

    /**
     * Creates the parent issue `decision` claimed for its scope, then stores
     * its key and claims the action under it. Answers `{ halt: true }` when
     * the request ends here (the stop, the results and `next` already set),
     * or `{ decision }`: the action decided again under the key now stored.
     */
    const createParent = async (actionId, decision) => {
      const { scope } = decision;
      const fields = {
        project: { key: target.projectKey },
        issuetype: { id: target.parentIssueTypeId },
        summary: decision.parentContent.summary,
        description: decision.parentContent.description,
        // On the parent too, so a label filter in Jira finds a session's
        // parent and its sub-tasks together.
        ...(target.labels.length > 0 ? { labels: [...target.labels] } : {})
      };

      let issue;
      try {
        issue = await client.createIssue(fields);
      } catch (err) {
        if (!(err instanceof JiraError)) throw err;
        logUnreachable('creating a parent issue', teamId, err);
        if (err.outcome === 'unknown') {
          // The parent may exist: the scope is marked, never the action,
          // which was not sent. A key already there wins, and an earlier
          // mark is kept: it dates when the doubt began.
          const markedAt = now().toISOString();
          let held = null;
          const marked = await bestEffortWrite((team) => {
            const parents = parentsOf(team);
            const current = parents[scope];
            let changed = false;
            if (isJiraLinked({ jira: current }) || isJiraUncertain({ jira: current })) {
              held = { ...current };
            } else {
              held = { uncertainSince: markedAt };
              parents[scope] = held;
              storeParents(team, parents);
              changed = true;
            }
            return releaseOwnParentClaim(team, scope, requestId) || changed ? team : null;
          }, `mark the parent issue of ${JSON.stringify(scope)} uncertain`);
          stopped = err.code === 'jira_unreachable' ? 'jira_unreachable' : 'jira_unavailable';
          if (marked && isJiraLinked({ jira: held })) {
            console.error(
              `[Server] Jira did not answer the creation of a parent issue for ${JSON.stringify(scope)} of team ${JSON.stringify(teamId)}, `
                + `which another request had created as ${held.key} meanwhile: the scope keeps ${held.key}, `
                + 'and a duplicate parent issue may exist in Jira'
            );
            noteParent({ scope, status: 'created', key: held.key });
            // The action was not sent: it goes under that key next time.
            return { halt: true };
          }
          noteParent({ scope, status: 'uncertain', ...(marked ? { uncertainSince: held.uncertainSince } : {}) });
          results.push({ actionId, status: 'parent_uncertain' });
          next += 1;
          return { halt: true };
        }

        // Jira refused, or never received the request: nothing was created.
        await releaseParentClaim(scope);
        if (err.code === 'jira_refused') {
          // The same type, project and labels go on every parent: every other
          // scope's parent would be refused the same way (Data Center's Epic
          // Name, a required field the integration never sets).
          const words = { jiraMessages: [...err.jiraMessages], ...(err.jiraFields.length > 0 ? { jiraFields: [...err.jiraFields] } : {}) };
          noteParent({ scope, status: 'refused', ...words });
          results.push({ actionId, status: 'parent_refused', ...words });
          next += 1;
          stopped = 'jira_parent_refused';
          return { halt: true };
        }
        stopped = refusalStop(err);
        if (err.code === 'jira_auth_failed') await markRefused(teamId, envelope);
        if (err.code === 'jira_rate_limited' && err.retryAfterSeconds !== null) retryAfterSeconds = err.retryAfterSeconds;
        return { halt: true };
      }

      // Read before the write, as the top of the loop reads them before a
      // claim: what may still start once the parent's key is stored.
      const mayContinue = !isClientGone() && !isShuttingDown() && now().getTime() - startedAt < timeBudgetMs;
      const link = { key: issue.key, createdAt: now().toISOString(), subtaskTypeId: target.issueTypeId };
      const written = await parentWrite(scope, link, actionId, mayContinue);
      if (written.failed) {
        // The parent exists and the record does not say so. Its claim stays
        // and expires into an uncertain parent, so nothing is created twice;
        // the key is answered, for the facilitator to name it next time.
        console.error(
          `[Server] Jira parent issue ${issue.key} was created for ${JSON.stringify(scope)} of team ${JSON.stringify(teamId)}, `
            + 'but its key could not be saved',
          written.cause
        );
        noteParent({ scope, status: 'not_saved', key: issue.key });
        stopped = 'link_not_saved';
        return { halt: true };
      }
      if (written.kept) {
        console.error(
          `[Server] Jira parent issue ${issue.key} was created for ${JSON.stringify(scope)} of team ${JSON.stringify(teamId)}, `
            + `which another request had created as ${written.kept.key} meanwhile: the scope keeps ${written.kept.key}, `
            + `and ${issue.key} is a duplicate to delete in Jira`
        );
        noteParent({ scope, status: 'created', key: written.kept.key });
      } else {
        noteParent({ scope, status: 'created', key: issue.key });
      }
      if (!mayContinue) {
        // The parent is saved and the action waits in `remaining`: the next
        // request finds the key. The time budget alone is no stop.
        if (isClientGone()) stopped = 'client_gone';
        else if (isShuttingDown()) stopped = 'server_restarting';
        return { halt: true };
      }
      return { decision: written.decision };
    };

    const patchSessions = async () => {
      if (links.size === 0) return;
      for (const id of sessions) {
        await liveSessionPatch({ teamId, sessionId: id, purpose: 'Jira link', mutate: (current) => stampSession(current, links) });
      }
    };

    try {
      // A sub-task is created in its parent's project, and Jira refuses a
      // sub-task as a parent (J-3): read once, before anything is claimed.
      let parent = null;
      if (target.mode === 'parent') {
        try {
          parent = await client.parentIssue(target.parentKey);
          // A sub-task, or an epic on Cloud: refused once, before anything is
          // claimed, rather than once per action [R1].
          if (cannotHoldSubtasks(parent)) stopped = 'jira_parent_invalid';
        } catch (err) {
          if (!(err instanceof JiraError)) throw err;
          logUnreachable('reading the parent issue', teamId, err);
          stopped = parentStop(err);
          if (err.code === 'jira_auth_failed') await markRefused(teamId, envelope);
          if (err.code === 'jira_rate_limited' && err.retryAfterSeconds !== null) retryAfterSeconds = err.retryAfterSeconds;
        }
        if (stopped) return { results, remaining: [...actionIds], stopped, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) };
        // The key Jira answered with is the parent's current one, even for an
        // issue moved since: that is the key a scope adopts.
        if (request.adoptParent === true) {
          adoption = { key: parent.key, subtaskTypeId: target.issueTypeId, replace: request.replaceParents === true };
        }
      }

      // Where an action's issue goes, and the parent it is created under.
      const destinationOf = (decision) => {
        if (decision.parentLink) {
          // Under a session's parent, in the parent's project. A parent in the
          // target's project takes the type the settings say now; one in
          // another project (adopted from it, or the target moved since) the
          // type recorded with it, valid in its own project.
          const parentKey = decision.parentLink.key;
          const parentProject = jiraProjectKeyOf(parentKey);
          const recorded = decision.parentLink.subtaskTypeId;
          const subtaskType = parentProject !== target.projectKey && isJiraIssueTypeId(recorded) ? recorded : target.issueTypeId;
          return { fields: { project: { key: parentProject }, parent: { key: parentKey }, issuetype: { id: subtaskType } }, parentKey };
        }
        if (parent) {
          return { fields: { project: { id: parent.projectId }, parent: { key: parent.key }, issuetype: { id: target.issueTypeId } }, parentKey: parent.key };
        }
        return { fields: { project: { key: target.projectKey }, issuetype: { id: target.issueTypeId } }, parentKey: null };
      };

      while (next < actionIds.length) {
        if (isClientGone()) {
          stopped = 'client_gone';
          break;
        }
        if (isShuttingDown()) {
          stopped = 'server_restarting';
          break;
        }
        if (next > 0 && now().getTime() - startedAt >= timeBudgetMs) break;

        const actionId = actionIds[next];
        const claim = await claimWrite(actionId, pending);
        if (claim.linkFailed) {
          notSaved(pending, claim.error);
          pending = null;
          break;
        }
        if (pending) {
          landed(pending, claim.kept, claim.adopted);
          pending = null;
        }

        let { decision } = claim;
        let halted = false;
        // A parent to create first. Once its key is stored the action is
        // decided again under it; the loop only goes round twice for an
        // action whose home changed between those two writes.
        while (decision.claimedParent) {
          const step = await createParent(actionId, decision);
          if (step.halt) {
            halted = true;
            break;
          }
          decision = step.decision;
          // [R6] `mayContinue` was read before the parent's write: a caller
          // gone or a SIGTERM during that write must not start a Jira call.
          // The claim just made is released: kept, it would expire into a
          // mark saying "may already be in Jira" for something never sent.
          if ((decision.claimed || decision.claimedParent) && (isClientGone() || isShuttingDown())) {
            if (decision.claimed) await releaseClaim(actionId);
            else await releaseParentClaim(decision.scope);
            stopped = isClientGone() ? 'client_gone' : 'server_restarting';
            halted = true;
            break;
          }
        }
        if (halted) break;

        if (!decision.claimed) {
          results.push({ actionId, ...decision.result });
          if (decision.parentStatus) noteParent({ scope: decision.scope, ...decision.parentStatus });
          if (decision.jira) touch(actionId, decision.jira, decision.homes);
          next += 1;
          continue;
        }

        const destination = destinationOf(decision);
        const fields = {
          ...destination.fields,
          summary: decision.content.summary,
          description: decision.content.description,
          // Optional, and refused by a project whose create screen lacks
          // the field (J-5): sent only when the target names some.
          ...(target.labels.length > 0 ? { labels: [...target.labels] } : {})
        };

        let issue;
        try {
          issue = await client.createIssue(fields);
        } catch (err) {
          if (!(err instanceof JiraError)) throw err;
          logUnreachable('creating an issue', teamId, err);
          if (err.outcome === 'unknown') {
            // The issue may exist. Marked, never re-created on a guess —
            // unless another request linked the action meanwhile: as in
            // `writeLink`, the key already there goes on every copy instead
            // of the mark, the action is answered with it, and the possible
            // duplicate is logged.
            const marker = { uncertainSince: now().toISOString() };
            let kept = null;
            const marked = await bestEffortWrite((team) => {
              const copies = actionCopies(team, actionId);
              const rival = copies.find(({ action }) => isJiraLinked(action));
              kept = rival ? { ...rival.action.jira } : null;
              const changed = stampCopies(copies, kept ?? marker);
              return releaseOwnClaim(team, actionId, requestId) || changed ? team : null;
            }, `mark action ${JSON.stringify(actionId)} uncertain`);
            if (kept) {
              console.error(
                `[Server] Jira did not answer the creation of an issue for action ${JSON.stringify(actionId)} `
                  + `of team ${JSON.stringify(teamId)}, which another request had linked to ${kept.key} meanwhile: `
                  + `the action keeps ${kept.key}, and a duplicate issue may exist in Jira`
              );
              if (marked) touch(actionId, kept, decision.homes);
              results.push({ actionId, status: 'already_linked', key: kept.key });
            } else {
              if (marked) touch(actionId, marker, decision.homes);
              results.push({ actionId, status: 'uncertain' });
            }
            next += 1;
            stopped = err.code === 'jira_unreachable' ? 'jira_unreachable' : 'jira_unavailable';
            break;
          }

          // Jira refused, or never received the request: nothing was created.
          await releaseClaim(actionId);
          if (err.code === 'jira_refused') {
            results.push({
              actionId,
              status: 'refused',
              jiraMessages: [...err.jiraMessages],
              ...(err.jiraFields.length > 0 ? { jiraFields: [...err.jiraFields] } : {})
            });
            next += 1;
            // A refusal naming `parent` is one too: a stored parent deleted
            // in Jira refuses every action of its scope.
            if (refusesTheTarget(err)) {
              stopped = 'jira_target_refused';
              break;
            }
            continue;
          }
          stopped = refusalStop(err);
          // The settings say the token was refused until someone replaces it
          // (U-1) — this token, not one saved while the batch ran.
          if (err.code === 'jira_auth_failed') await markRefused(teamId, envelope);
          if (err.code === 'jira_rate_limited' && err.retryAfterSeconds !== null) retryAfterSeconds = err.retryAfterSeconds;
          break;
        }

        pending = {
          actionId,
          key: issue.key,
          createdAt: now().toISOString(),
          homes: decision.homes,
          ...(destination.parentKey ? { parentKey: destination.parentKey } : {}),
          ...(decision.adopt ? { adopt: decision.adopt } : {})
        };
        next += 1;
      }

      // The last key, whatever ended the loop: that issue exists.
      await flush();
    } finally {
      await patchSessions();
    }

    return {
      results,
      remaining: actionIds.slice(next),
      ...(stopped ? { stopped } : {}),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      ...(parentResults.size > 0 ? { parents: [...parentResults.values()] } : {})
    };
  };

  return createIssues;
};
