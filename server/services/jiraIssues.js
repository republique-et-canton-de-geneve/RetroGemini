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
 *  - an action with no text is `refused` with no message: Jira would refuse an
 *    issue with no summary, so nothing is claimed and nothing is sent.
 *
 * Jira's answer then decides. A 201 writes the key on every copy of the action
 * and drops the claim. A definite refusal (a 4xx, or a request that never
 * left) drops the claim, so the action can be tried again. An answer that was
 * lost — a 5xx, a timeout after the request was sent, a connection cut — marks
 * every copy `jira: { uncertainSince }`: the facilitator checks Jira and then
 * creates it anyway or not.
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
 * the previous revision refused (finding A-4).
 */

import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { isJiraLinked, isJiraUncertain, JIRA_CLAIM_TTL_MS } from '../../utils/jira.js';
import { issueFields } from '../../utils/jiraIssueContent.js';
import { JiraError } from './jiraClient.js';
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
 */
const writeLink = (team, { actionId, key, createdAt }, requestId) => {
  const stamped = stampCopies(actionCopies(team, actionId), { key, createdAt });
  const released = releaseOwnClaim(team, actionId, requestId);
  return stamped || released;
};

/**
 * What the claim step decides for one action, on the record as the row lock
 * holds it. Mutates `team` when it claims, or when it turns an expired claim
 * into an uncertain mark, and says so with `wrote`.
 */
const decideClaim = (team, { actionId, force, nowMs, nowIso, claimTtlMs, requestId, requestedBy, language }) => {
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
    const claimedAt = typeof claim?.at === 'string' ? Date.parse(claim.at) : NaN;
    const jira = { uncertainSince: Number.isFinite(claimedAt) && claimedAt <= nowMs ? claim.at : nowIso };
    stampCopies(copies, jira);
    delete claims[actionId];
    storeClaims(team, claims);
    return { wrote: true, homes, jira, result: { status: 'uncertain' } };
  }

  // The issue's content, built here because the record is at hand. With a
  // copy in the backlog and one in a session, the backlog copy wins where it
  // says something (the whole-action route edits that copy first, so its text
  // is the newest) and the session's copy fills in the rest (the card it was
  // written against); the session names where it came from.
  const backlog = copies.find(({ kind }) => kind === 'backlog');
  const home = copies.find(({ kind }) => kind !== 'backlog');
  const fields = issueFields({
    action: backlog && home ? { ...home.action, ...backlog.action } : (backlog ?? home).action,
    session: home?.home ?? null,
    kind: home?.kind ?? 'backlog',
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
    return { wrote: ownClaim, homes, result: { status: 'refused', jiraMessages: [] } };
  }

  claims[actionId] = { at: nowIso, requestId };
  storeClaims(team, claims);
  return { wrote: true, homes, claimed: true, content: { summary: fields.summary, description: fields.description } };
};

/**
 * The entries of a live session that show an affected action, given the Jira
 * value the team record now holds; `null` when every entry already has it.
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

// The stop a definite refusal of a creation ends the batch with. A 400 is not
// one: it belongs to its action, and the batch goes on.
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
   * @param {{ actionIds: string[], sessionId: string | null, requestedBy: string, language: string | null, force: boolean }} input.request
   * @param {{ mode: 'project' | 'parent', projectKey?: string, parentKey?: string, issueTypeId: string, labels: string[] }} input.target
   * @param {object} input.client The Jira client, built with the team's token.
   * @param {object} input.envelope The stored token envelope the client was built from.
   * @param {() => boolean} [input.isClientGone]
   * @returns {Promise<{ results: object[], remaining: string[], stopped?: string, retryAfterSeconds?: number }>}
   */
  const createIssues = async ({ teamId, request, target, client, envelope, isClientGone = () => false }) => {
    const { actionIds, sessionId, requestedBy, language, force } = request;
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
        try {
          const result = await atomicUpdateTeam(teamId, (team) => {
            const linked = pending ? writeLink(team, pending, requestId) : false;
            decision = decideClaim(team, {
              actionId,
              force,
              nowMs: nowDate.getTime(),
              nowIso: nowDate.toISOString(),
              claimTtlMs,
              requestId,
              requestedBy,
              language
            });
            return linked || decision.wrote ? team : null;
          });
          // The team is gone: nothing of it can be claimed, nor hold a key.
          if (!result.success) return pending ? { linkFailed: true, error: result.error } : { decision: { result: { status: 'not_found' } } };
          return { decision };
        } catch (err) {
          if (!pending) throw err;
          lastError = err;
        }
      }
      return { linkFailed: true, error: lastError };
    };

    // The last created key, written by the claim of the next action or by
    // `flush` at the end: one team write per action.
    let pending = null;
    const created = ({ actionId, key, createdAt, homes }) => {
      results.push({ actionId, status: 'created', key });
      touch(actionId, { key, createdAt }, homes);
    };
    // The issue exists and the team record does not say so: the one outcome
    // an operator may have to repair by hand, so the line names all three.
    const notSaved = ({ actionId, key }, cause) => {
      console.error(
        `[Server] Jira issue ${key} was created for action ${JSON.stringify(actionId)} of team ${JSON.stringify(teamId)}, `
          + 'but its key could not be saved',
        cause
      );
      results.push({ actionId, status: 'created_not_saved', key });
      stopped = 'link_not_saved';
    };
    const flush = async () => {
      if (!pending) return;
      const landing = pending;
      pending = null;
      let cause;
      for (let attempt = 0; attempt <= linkWriteRetries; attempt += 1) {
        try {
          const result = await atomicUpdateTeam(teamId, (team) => (writeLink(team, landing, requestId) ? team : null));
          if (result.success) {
            created(landing);
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
          if (parent.subtask) stopped = 'jira_parent_invalid';
        } catch (err) {
          if (!(err instanceof JiraError)) throw err;
          stopped = parentStop(err);
          if (err.code === 'jira_auth_failed') await markRefused(teamId, envelope);
          if (err.code === 'jira_rate_limited' && err.retryAfterSeconds !== null) retryAfterSeconds = err.retryAfterSeconds;
        }
        if (stopped) return { results, remaining: [...actionIds], stopped, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) };
      }

      const destination = parent
        ? { project: { id: parent.projectId }, parent: { key: parent.key } }
        : { project: { key: target.projectKey } };

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
          created(pending);
          pending = null;
        }

        const { decision } = claim;
        if (!decision.claimed) {
          results.push({ actionId, ...decision.result });
          if (decision.jira) touch(actionId, decision.jira, decision.homes);
          next += 1;
          continue;
        }

        const fields = {
          ...destination,
          issuetype: { id: target.issueTypeId },
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
          if (err.outcome === 'unknown') {
            // The issue may exist. Marked, never re-created on a guess.
            const marker = { uncertainSince: now().toISOString() };
            const marked = await bestEffortWrite((team) => {
              const changed = stampCopies(actionCopies(team, actionId), marker);
              return releaseOwnClaim(team, actionId, requestId) || changed ? team : null;
            }, `mark action ${JSON.stringify(actionId)} uncertain`);
            if (marked) touch(actionId, marker, decision.homes);
            results.push({ actionId, status: 'uncertain' });
            next += 1;
            stopped = err.code === 'jira_unreachable' ? 'jira_unreachable' : 'jira_unavailable';
            break;
          }

          // Jira refused, or never received the request: nothing was created.
          await releaseClaim(actionId);
          if (err.code === 'jira_refused') {
            results.push({ actionId, status: 'refused', jiraMessages: [...err.jiraMessages] });
            next += 1;
            continue;
          }
          stopped = refusalStop(err);
          // The settings say the token was refused until someone replaces it
          // (U-1) — this token, not one saved while the batch ran.
          if (err.code === 'jira_auth_failed') await markRefused(teamId, envelope);
          if (err.code === 'jira_rate_limited' && err.retryAfterSeconds !== null) retryAfterSeconds = err.retryAfterSeconds;
          break;
        }

        pending = { actionId, key: issue.key, createdAt: now().toISOString(), homes: decision.homes };
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
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
    };
  };

  return createIssues;
};
