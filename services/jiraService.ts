import type {
  JiraIssueResult,
  JiraIssueType,
  JiraLink,
  JiraParentLink,
  JiraParentResult,
  JiraStatus,
  JiraStopCode,
  JiraTarget
} from '../types';
import type { Language } from '../i18n/languages';
import {
  JIRA_MAX_ACTIONS_PER_REQUEST,
  isJiraIssueKey,
  isJiraLinked,
  isJiraParentScope,
  isJiraUncertain
} from '../utils/jira.js';
import { dataService } from './dataService';

/**
 * The browser's side of the Jira routes (`/api/team/:teamId/jira/*`).
 *
 * The browser never talks to Jira: the CSP allows `connect-src 'self'` only,
 * and the team's token never leaves the server. Every call here is a plain
 * `fetch` to this deployment.
 *
 * ## The credential is read when the call runs
 *
 * Each call reads the team credential from `dataService` inside its own async
 * body, never when a component renders (finding T-49): a component that read
 * it while rendering would capture a token a re-login has since replaced, and a
 * throw there would blank the screen. Reading it inside the async body also
 * makes any failure to read it a rejected promise the caller already handles.
 *
 * ## When a request may be sent again (finding A-2)
 *
 * Creating an issue is not idempotent. An answer that is lost — a gateway's
 * 502 or 504 page, a 408, a pod killed mid-request, a dropped connection —
 * says nothing about what the server did, and it may have created issues; a
 * second request would create them again. So the one answer that is retried is
 * the one that proves nothing ran: a 404 whose body is not JSON, which is what
 * a pod from before this feature answers during a rolling update for a route
 * it does not know (the same rule as `postAcrossRollout` in dataService.ts).
 * For a creation, every other answer without a route's own JSON error ends the
 * batch as `outcome_unknown`, and so does any 5xx or 408 even with one: the
 * route may have failed after creating issues. Nothing is sent again. Instead
 * the team is read once, and each action the record shows linked comes back
 * with its key (`settleUnknown`): only what the record cannot explain is left
 * for the facilitator to check in Jira.
 *
 * The other routes create nothing, so a route's own code passes through
 * whatever its status: a `503 jira_secret_unavailable` or a
 * `502 jira_unreachable` reads as its own sentence, not "Something went
 * wrong". A status read is idempotent, so it also retries a 429 from the read
 * limiter.
 */

// The rolling-update window, as in dataService.ts: 0.5 + 1 + 2 + 4 seconds,
// long enough for the old pods to drain, short enough to report a server that
// really does not serve the route.
const ROLLOUT_RETRIES = 4;
const rolloutDelayMs = (attempt: number) => 500 * 2 ** attempt;

// A request answered with no result and nothing done, twice in a row, ends the
// batch rather than looping: the server always attempts at least one action
// unless something holds it up, and the facilitator can simply try again.
// A request that created only a parent issue (`sessionParent` mode) is
// progress, not an idle round.
const MAX_IDLE_ROUNDS = 2;

/** An error a Jira call rejects with. `message` is the code, translated at display (i18n/errorMessages.ts). */
export class JiraServiceError extends Error {
  readonly code: string;
  /** For `createIssues` only: the results that landed before the refusal. */
  readonly results: JiraIssueResult[];
  /** For `createIssues` only: the actions the refused request and the ones after it held. */
  readonly notSent: string[];
  /** For `createIssues` only: what became of the parent issues before the refusal. */
  readonly parents: JiraParentResult[];

  constructor(code: string, partial: { results?: JiraIssueResult[]; notSent?: string[]; parents?: JiraParentResult[] } = {}) {
    super(code);
    this.name = 'JiraServiceError';
    this.code = code;
    this.results = partial.results ?? [];
    this.notSent = partial.notSent ?? [];
    this.parents = partial.parents ?? [];
  }
}

// What the client can tell about one answer.
//  - ok: a success with a JSON object body;
//  - refused: the route's own JSON error, `{ error: code }`, whatever the
//    status, from a pod that serves it. `createIssues` alone reads a 5xx or a
//    408 as an unknown outcome even then (see the module comment);
//  - older-pod: a 404 that is not JSON, so no route ran;
//  - unknown: anything else, a dropped connection included.
type Answer =
  | { kind: 'ok'; status: number; data: Record<string, unknown> }
  | { kind: 'refused'; status: number; code: string }
  | { kind: 'older-pod'; status: number }
  | { kind: 'unknown'; status: number };

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const readAnswer = async (res: Response): Promise<Answer> => {
  let body: unknown;
  let isJson = true;
  try {
    body = await res.json();
  } catch {
    isJson = false;
  }
  const status = res.status;
  if (res.ok) return isJson && isObject(body) ? { kind: 'ok', status, data: body } : { kind: 'unknown', status };
  if (!isJson) return status === 404 ? { kind: 'older-pod', status } : { kind: 'unknown', status };
  if (isObject(body) && typeof body.error === 'string' && body.error) {
    return { kind: 'refused', status, code: body.error };
  }
  return { kind: 'unknown', status };
};

// One POST, with the team credential as it stands now: the password when this
// login holds one, and the session token. JSON drops the undefined ones, as
// `apiCall` in dataService.ts does; the server accepts either.
const post = async (endpoint: string, payload: Record<string, unknown>): Promise<Answer> => {
  const credential = {
    password: dataService.getAuthenticatedPassword() ?? undefined,
    sessionToken: dataService.getSessionToken() ?? undefined
  };
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...credential, ...payload })
    });
  } catch {
    return { kind: 'unknown', status: 0 };
  }
  return readAnswer(res);
};

const isOlderPod = (answer: Answer) => answer.kind === 'older-pod';

// The same request, sent again while `retryable` says nothing ran, within the
// rolling-update window. The credential is read again for every attempt.
const postAcrossRollout = async (
  endpoint: string,
  payload: Record<string, unknown>,
  retryable: (answer: Answer) => boolean = isOlderPod
): Promise<Answer> => {
  for (let attempt = 0; ; attempt += 1) {
    const answer = await post(endpoint, payload);
    if (!retryable(answer) || attempt >= ROLLOUT_RETRIES) return answer;
    await new Promise(resolve => setTimeout(resolve, rolloutDelayMs(attempt)));
  }
};

// The data of a successful answer, or the code to reject with.
const dataOrThrow = (answer: Answer): Record<string, unknown> => {
  if (answer.kind === 'ok') return answer.data;
  throw new JiraServiceError(answer.kind === 'refused' ? answer.code : 'unknown_error');
};

const isStatus = (data: Record<string, unknown>): boolean =>
  typeof data.enabled === 'boolean' && isObject(data.token);

const statusOrThrow = (answer: Answer): JiraStatus => {
  const data = dataOrThrow(answer);
  if (!isStatus(data)) throw new JiraServiceError('unknown_error');
  return data as unknown as JiraStatus;
};

const teamRoute = (teamId: string, path: string) => `/api/team/${encodeURIComponent(teamId)}/jira/${path}`;

export interface CreateIssuesOptions {
  /** A one-time target for this creation; the team's stored one otherwise. */
  target?: JiraTarget;
  /** The live session the batch was started from, so the server patches its row too. */
  sessionId?: string;
  /** Who clicked, named in the issue's description. */
  requestedBy: string;
  /** The clicker's interface language, the last fallback of the issue's content language. */
  language: Language;
  /** Create the actions marked uncertain anyway, once the facilitator has checked Jira. */
  force?: boolean;
  /**
   * `sessionParent` mode, with a parent issue named for this send (sent as a
   * one-time `parent`-mode `target`): it becomes the parent issue of every
   * retrospective or health check of the send that has none, once Jira has
   * created a sub-task of it there.
   */
  adoptParent?: boolean;
  /** With `adoptParent`: it replaces the parent issue those already have too. */
  replaceParents?: boolean;
  /**
   * The parent issues the dialog showed in doubt and the facilitator, having
   * checked Jira, confirmed: created anyway, each for its own retrospective,
   * health check or the team dashboard, with the actions the dialog listed
   * under it. Each request carries the scopes of its own actions only, and
   * none the server has since answered in doubt: that doubt was found during
   * the send, never shown (review F2-1).
   */
  forceParents?: { scope: string; actionIds: string[] }[];
  /** Called after each request with every result so far. */
  onProgress?: (results: JiraIssueResult[]) => void;
}

export interface CreateIssuesOutcome {
  /** One entry per action the server attempted, in order. */
  results: JiraIssueResult[];
  /** Actions never attempted: after a stop, or never sent at all. Sending them again is safe. */
  notSent: string[];
  /**
   * Actions sent in a request whose answer was lost, or that the server's
   * answer did not mention, and that the team record, read once afterwards,
   * does not show linked: they may or may not be in Jira (a mark, no link, or
   * a creation the server is still finishing). Never sent again
   * automatically; the screen asks to check Jira.
   */
  unknown: string[];
  stopped?: JiraStopCode | 'outcome_unknown';
  retryAfterSeconds?: number;
  /**
   * What became of the parent issues (`sessionParent` mode): one entry per
   * retrospective, health check or the team dashboard the server reported,
   * with the last status it reported across the requests. Empty in the other
   * modes, and from a pod of an older release.
   */
  parents: JiraParentResult[];
}

const stringsOf = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;

// One parent entry of an answer, as this client may show and cache it: a
// scope the server can hold, a status, and a key only when it is one. Anything
// else in the entry is dropped; an entry that is not one is dropped whole.
const parentResultOf = (entry: unknown): JiraParentResult | null => {
  if (!isObject(entry) || !isJiraParentScope(entry.scope) || typeof entry.status !== 'string' || !entry.status) return null;
  if (entry.key !== undefined && !isJiraIssueKey(entry.key)) return null;
  const result: JiraParentResult = { scope: entry.scope as string, status: entry.status as JiraParentResult['status'] };
  if (isJiraIssueKey(entry.key)) result.key = entry.key as string;
  if (typeof entry.uncertainSince === 'string' && entry.uncertainSince) result.uncertainSince = entry.uncertainSince;
  const jiraMessages = stringsOf(entry.jiraMessages);
  if (jiraMessages) result.jiraMessages = jiraMessages;
  const jiraFields = stringsOf(entry.jiraFields);
  if (jiraFields) result.jiraFields = jiraFields;
  return result;
};

// The parts of a `/jira/issues` answer that concern the actions this request
// sent; `null` when the body is not such an answer at all.
const readIssuesAnswer = (data: Record<string, unknown>, sent: string[]) => {
  if (!Array.isArray(data.results) || !Array.isArray(data.remaining)) return null;
  const inRequest = new Set(sent);
  const results = data.results.filter((r): r is JiraIssueResult =>
    isObject(r) && typeof r.actionId === 'string' && inRequest.has(r.actionId) && typeof r.status === 'string');
  const attempted = new Set(results.map(r => r.actionId));
  const leftForLater = new Set<unknown>(data.remaining);
  const remaining = sent.filter(id => !attempted.has(id) && leftForLater.has(id));
  const answered = new Set([...attempted, ...remaining]);
  return {
    results,
    remaining,
    parents: (Array.isArray(data.parents) ? data.parents : [])
      .map(parentResultOf)
      .filter((entry): entry is JiraParentResult => entry !== null),
    // Sent, and neither attempted nor left for later: nothing says what became of it.
    unaccounted: sent.filter(id => !answered.has(id)),
    stopped: typeof data.stopped === 'string' && data.stopped ? (data.stopped as JiraStopCode) : undefined,
    retryAfterSeconds: typeof data.retryAfterSeconds === 'number' && Number.isFinite(data.retryAfterSeconds)
      ? data.retryAfterSeconds
      : undefined
  };
};

// The links a request's results put on the cached actions: every valid key,
// and a marker for every uncertain outcome. The server already stored them;
// this only stops the screens offering "Create in Jira" for them (finding A-6).
const linksOf = (results: JiraIssueResult[]): { actionId: string; jira: JiraLink }[] => {
  const now = new Date().toISOString();
  return results.flatMap((result): { actionId: string; jira: JiraLink }[] => {
    if (isJiraIssueKey(result.key)) return [{ actionId: result.actionId, jira: { key: result.key as string, createdAt: now } }];
    if (result.status === 'uncertain') return [{ actionId: result.actionId, jira: { uncertainSince: now } }];
    return [];
  });
};

// The parent links a request's parent entries put in the cache: the key a
// scope now holds (created, or adopted from the parent named for the send),
// and the mark of a parent that may exist. A key the server could not store
// (`not_saved`) is not cached: the server reads that scope as uncertain once
// the claim expires, and the dialog names the key. A mark without its date
// was not stored either.
const parentLinksOf = (parents: JiraParentResult[]): { scope: string; jira: JiraParentLink }[] => {
  const now = new Date().toISOString();
  return parents.flatMap((entry): { scope: string; jira: JiraParentLink }[] => {
    if ((entry.status === 'created' || entry.status === 'adopted') && isJiraIssueKey(entry.key)) {
      return [{ scope: entry.scope, jira: { key: entry.key as string, createdAt: now } }];
    }
    if (entry.status === 'uncertain' && typeof entry.uncertainSince === 'string') {
      return [{ scope: entry.scope, jira: { uncertainSince: entry.uncertainSince } }];
    }
    return [];
  });
};

// The parent links a team record holds, as the cache may take them.
const recordedParents = (team: Record<string, unknown>): { scope: string; jira: JiraParentLink }[] => {
  if (!isObject(team.jiraParents)) return [];
  return Object.entries(team.jiraParents).flatMap(([scope, value]): { scope: string; jira: JiraParentLink }[] => {
    if (!isJiraParentScope(scope) || !isObject(value)) return [];
    if (isJiraIssueKey(value.key)) {
      const createdAt = typeof value.createdAt === 'string' && value.createdAt ? value.createdAt : new Date().toISOString();
      return [{ scope, jira: { key: value.key as string, createdAt } }];
    }
    if (typeof value.uncertainSince === 'string' && value.uncertainSince) return [{ scope, jira: { uncertainSince: value.uncertainSince } }];
    return [];
  });
};

// Every entry a request reported, by scope: a later status replaces an
// earlier one (an `in_progress` the next request saw `created`), and the
// first report keeps its place in the list.
const mergeParents = (into: Map<string, JiraParentResult>, parents: JiraParentResult[]) => {
  for (const entry of parents) into.set(entry.scope, entry);
};

// The Jira value the team record holds for each of `actionIds`: a valid key on
// any copy (backlog, retrospectives, health checks) wins over a mark, as on
// the server; a proposal is not an action yet; an action with neither is
// absent.
const recordedLinks = (team: Record<string, unknown>, actionIds: string[]): Map<string, JiraLink> => {
  const wanted = new Set(actionIds);
  const links = new Map<string, JiraLink>();
  const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const buckets: unknown[] = [
    team.globalActions,
    ...listOf(team.retrospectives).map(session => (isObject(session) ? session.actions : null)),
    ...listOf(team.healthChecks).map(session => (isObject(session) ? session.actions : null))
  ];
  for (const bucket of buckets) {
    for (const action of listOf(bucket)) {
      if (!isObject(action) || typeof action.id !== 'string' || !wanted.has(action.id) || action.type === 'proposal') continue;
      const jira = action.jira as Record<string, unknown>;
      const held = links.get(action.id);
      if (isJiraLinked(action)) {
        if (!held || !('key' in held)) {
          const createdAt = typeof jira.createdAt === 'string' && jira.createdAt ? jira.createdAt : new Date().toISOString();
          links.set(action.id, { key: jira.key as string, createdAt });
        }
      } else if (isJiraUncertain(action) && !held) {
        links.set(action.id, { uncertainSince: jira.uncertainSince as string });
      }
    }
  }
  return links;
};

/**
 * After an answer was lost, what the team record says about the actions whose
 * outcome is unknown. The screens re-render from the cache, which a lost answer
 * left untouched: without this, an action the server created and linked would
 * still offer "Create in Jira" and read "may already be in Jira", and actions
 * the server never reached would be listed as ones to check in Jira.
 *
 * Read once, after the writes queued before it (the record is read whole, and
 * a write still queued would be missing from it), and never put in the cache
 * whole: only the links go there (`applyJiraLinks`, which never replaces a
 * key), and the parent issues of the sessions (`applyJiraParents`), so the
 * next dialog's preview says which parent the server holds — one the lost
 * request created included. An action the record shows linked becomes
 * `already_linked` with its key; a mark is cached, and the action stays
 * unknown with every other one — the server may still be finishing the call
 * it was in. A read that fails changes nothing.
 */
const settleUnknown = async (teamId: string, outcome: CreateIssuesOutcome): Promise<CreateIssuesOutcome> => {
  if (outcome.unknown.length === 0) return outcome;
  let team: Record<string, unknown> | null = null;
  try {
    await dataService.whenPersisted();
    const answer = await post(`/api/team/${encodeURIComponent(teamId)}`, {});
    if (answer.kind === 'ok' && isObject(answer.data.team)) team = answer.data.team;
  } catch (err) {
    console.warn('[jiraService] Could not read the team after a lost answer', err);
  }
  if (!team) return outcome;

  const parentLinks = recordedParents(team);
  if (parentLinks.length > 0) dataService.applyJiraParents(teamId, parentLinks);

  const links = recordedLinks(team, outcome.unknown);
  if (links.size === 0) return outcome;
  dataService.applyJiraLinks(teamId, outcome.unknown.flatMap(actionId => {
    const jira = links.get(actionId);
    return jira ? [{ actionId, jira }] : [];
  }));
  const linked: JiraIssueResult[] = [];
  const unknown: string[] = [];
  for (const actionId of outcome.unknown) {
    const jira = links.get(actionId);
    if (jira && 'key' in jira) linked.push({ actionId, status: 'already_linked', key: jira.key });
    else unknown.push(actionId);
  }
  return { ...outcome, results: [...outcome.results, ...linked], unknown };
};

/**
 * Create issues for `actionIds`, at most `JIRA_MAX_ACTIONS_PER_REQUEST` per
 * request, until every action was attempted or the server stops.
 *
 * Waits first for every write queued before the click, so the server finds
 * the actions just typed. Each request sends what the server left for later
 * (`remaining`, its time budget: finding A-1) before the rest, with the same
 * target and flags. After each one, the keys and uncertain outcomes reach the
 * cache (`applyJiraLinks`, and `applyJiraParents` for the parent issues of
 * `sessionParent` mode) and `onProgress` hears every result so far. A request
 * that only created a parent issue made progress: the action it was for
 * follows in the next one.
 *
 * Resolves on a stop with its code, and with `outcome_unknown` when an answer
 * was lost or was a 5xx or a 408 (see the module comment); whenever some
 * outcome is unknown, the team is read once first (`settleUnknown`). Rejects with a
 * `JiraServiceError` when the route refuses a request before creating anything
 * (`jira_target_missing`, `jira_token_unusable`, a lost session, the write
 * limiter's 429…), carrying what landed before it.
 */
const createIssues = async (
  teamId: string,
  actionIds: string[],
  options: CreateIssuesOptions
): Promise<CreateIssuesOutcome> => settleUnknown(teamId, await sendIssues(teamId, actionIds, options));

const sendIssues = async (
  teamId: string,
  actionIds: string[],
  options: CreateIssuesOptions
): Promise<CreateIssuesOutcome> => {
  const results: JiraIssueResult[] = [];
  const unknown: string[] = [];
  const parentsByScope = new Map<string, JiraParentResult>();
  const parents = () => [...parentsByScope.values()];
  let toSend = [...new Set(actionIds)];
  if (toSend.length === 0) return { results, notSent: [], unknown, parents: [] };

  // The confirmed parents in doubt, and the scopes an answer reported in
  // doubt since: a confirmation is for the doubt the dialog showed.
  const confirmed = (options.forceParents ?? []).filter(entry =>
    entry && isJiraParentScope(entry.scope) && Array.isArray(entry.actionIds));
  const doubtedSince = new Set<string>();
  const confirmedFor = (sent: string[]): string[] | undefined => {
    const inRequest = new Set(sent);
    const scopes = [...new Set(confirmed
      .filter(entry => !doubtedSince.has(entry.scope) && entry.actionIds.some(id => inRequest.has(id)))
      .map(entry => entry.scope))];
    return scopes.length > 0 ? scopes : undefined;
  };

  await dataService.whenPersisted();

  const endpoint = teamRoute(teamId, 'issues');
  let idleRounds = 0;
  while (toSend.length > 0) {
    const sent = toSend.slice(0, JIRA_MAX_ACTIONS_PER_REQUEST);
    const later = toSend.slice(JIRA_MAX_ACTIONS_PER_REQUEST);
    const answer = await postAcrossRollout(endpoint, {
      actionIds: sent,
      target: options.target,
      sessionId: options.sessionId,
      requestedBy: options.requestedBy,
      language: options.language,
      force: options.force ? true : undefined,
      adoptParent: options.adoptParent ? true : undefined,
      replaceParents: options.replaceParents ? true : undefined,
      forceParentScopes: confirmedFor(sent)
    });

    // A pod without the route answered every attempt: a rollout outlasted its
    // window. Nothing ran, so all of it can be sent again later.
    if (answer.kind === 'older-pod') return { results, notSent: toSend, unknown, parents: parents(), stopped: 'server_restarting' };
    // A 5xx or a 408 says nothing about what ran, even with the route's own
    // code: the route may have failed after creating issues (finding A-2).
    if (answer.kind !== 'ok' && (answer.status >= 500 || answer.status === 408)) {
      return { results, notSent: later, unknown: [...unknown, ...sent], parents: parents(), stopped: 'outcome_unknown' };
    }
    if (answer.kind === 'refused') {
      throw new JiraServiceError(answer.code, { results: [...results], notSent: toSend, parents: parents() });
    }
    const parsed = answer.kind === 'ok' ? readIssuesAnswer(answer.data, sent) : null;
    if (!parsed) return { results, notSent: later, unknown: [...unknown, ...sent], parents: parents(), stopped: 'outcome_unknown' };

    results.push(...parsed.results);
    unknown.push(...parsed.unaccounted);
    mergeParents(parentsByScope, parsed.parents);
    for (const entry of parsed.parents) if (entry.status === 'uncertain') doubtedSince.add(entry.scope);
    const links = linksOf(parsed.results);
    if (links.length > 0) dataService.applyJiraLinks(teamId, links);
    const parentLinks = parentLinksOf(parsed.parents);
    if (parentLinks.length > 0) dataService.applyJiraParents(teamId, parentLinks);
    try {
      options.onProgress?.([...results]);
    } catch (err) {
      // A screen's failure must not abandon the actions still to send.
      console.warn('[jiraService] Progress callback failed', err);
    }

    toSend = [...parsed.remaining, ...later];
    if (parsed.stopped) {
      return { results, notSent: toSend, unknown, parents: parents(), stopped: parsed.stopped, retryAfterSeconds: parsed.retryAfterSeconds };
    }
    idleRounds = parsed.results.length === 0 && parsed.parents.length === 0 ? idleRounds + 1 : 0;
    if (idleRounds >= MAX_IDLE_ROUNDS) return { results, notSent: toSend, unknown, parents: parents() };
  }
  return { results, notSent: [], unknown, parents: parents() };
};

export const jiraService = {
  /**
   * The deployment's Jira, the team's target and its token's state. Never
   * calls Jira. Rejects on any failure, after retrying a pod without the route
   * and the read limiter across the rollout window.
   */
  getStatus: async (teamId: string): Promise<JiraStatus> =>
    statusOrThrow(await postAcrossRollout(
      teamRoute(teamId, 'status'),
      {},
      answer => answer.kind === 'older-pod' || answer.status === 429
    )),

  /**
   * Check a token with Jira and store it as the team's. `email` is for Jira
   * Cloud (email + API token); without one the token is a Data Center
   * personal access token. Both are trimmed: a pasted token often carries a
   * line break, which Jira would refuse.
   */
  saveToken: async (teamId: string, token: string, email?: string): Promise<JiraStatus> => {
    const cloudEmail = email?.trim();
    return statusOrThrow(await postAcrossRollout(teamRoute(teamId, 'token'), {
      token: token.trim(),
      email: cloudEmail || undefined
    }));
  },

  /** Remove the team's token. */
  removeToken: async (teamId: string): Promise<JiraStatus> =>
    statusOrThrow(await postAcrossRollout(teamRoute(teamId, 'token/delete'), {})),

  /** Store where the team's issues go; `null` clears it. */
  saveTarget: async (teamId: string, target: JiraTarget | null): Promise<JiraStatus> =>
    statusOrThrow(await postAcrossRollout(teamRoute(teamId, 'target'), { target })),

  /**
   * The issue types a project offers, or the sub-task types of a parent
   * issue's project, read from Jira with the team's token. For a project, a
   * pod of this release answers every type, sub-task types included, and says
   * so (`subtasksIncluded`); a pod of an older release answers the standard
   * types only, so the screens filter by mode and treat a missing flag as "no
   * sub-task list yet".
   */
  getIssueTypes: async (
    teamId: string,
    source: { projectKey: string } | { parentKey: string }
  ): Promise<{ issueTypes: JiraIssueType[]; projectKey: string; subtasksIncluded: boolean }> => {
    const data = dataOrThrow(await postAcrossRollout(teamRoute(teamId, 'issue-types'), { ...source }));
    if (!Array.isArray(data.issueTypes)) throw new JiraServiceError('unknown_error');
    return {
      issueTypes: data.issueTypes as JiraIssueType[],
      projectKey: String(data.projectKey ?? ''),
      subtasksIncluded: data.subtasksIncluded === true
    };
  },

  createIssues
};
