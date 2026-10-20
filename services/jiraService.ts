import type {
  JiraIssueResult,
  JiraIssueType,
  JiraLink,
  JiraStatus,
  JiraStopCode,
  JiraTarget
} from '../types';
import type { Language } from '../i18n/languages';
import { JIRA_MAX_ACTIONS_PER_REQUEST, isJiraIssueKey } from '../utils/jira.js';
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
 * route may have failed after creating issues. Nothing is sent again; the
 * screen re-reads what landed and asks the facilitator to check Jira.
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
const MAX_IDLE_ROUNDS = 2;

/** An error a Jira call rejects with. `message` is the code, translated at display (i18n/errorMessages.ts). */
export class JiraServiceError extends Error {
  readonly code: string;
  /** For `createIssues` only: the results that landed before the refusal. */
  readonly results: JiraIssueResult[];
  /** For `createIssues` only: the actions the refused request and the ones after it held. */
  readonly notSent: string[];

  constructor(code: string, partial: { results?: JiraIssueResult[]; notSent?: string[] } = {}) {
    super(code);
    this.name = 'JiraServiceError';
    this.code = code;
    this.results = partial.results ?? [];
    this.notSent = partial.notSent ?? [];
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
   * answer did not mention: they may or may not be in Jira. Never sent again
   * automatically; the screen re-reads the team and asks to check Jira.
   */
  unknown: string[];
  stopped?: JiraStopCode | 'outcome_unknown';
  retryAfterSeconds?: number;
}

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

/**
 * Create issues for `actionIds`, at most `JIRA_MAX_ACTIONS_PER_REQUEST` per
 * request, until every action was attempted or the server stops.
 *
 * Waits first for every write queued before the click, so the server finds
 * the actions just typed. Each request sends what the server left for later
 * (`remaining`, its time budget: finding A-1) before the rest. After each one,
 * the keys and uncertain outcomes reach the cache (`applyJiraLinks`) and
 * `onProgress` hears every result so far.
 *
 * Resolves on a stop with its code, and with `outcome_unknown` when an answer
 * was lost or was a 5xx or a 408 (see the module comment). Rejects with a
 * `JiraServiceError` when the route refuses a request before creating anything
 * (`jira_target_missing`, `jira_token_unusable`, a lost session, the write
 * limiter's 429…), carrying what landed before it.
 */
const createIssues = async (
  teamId: string,
  actionIds: string[],
  options: CreateIssuesOptions
): Promise<CreateIssuesOutcome> => {
  const results: JiraIssueResult[] = [];
  const unknown: string[] = [];
  let toSend = [...new Set(actionIds)];
  if (toSend.length === 0) return { results, notSent: [], unknown };

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
      force: options.force ? true : undefined
    });

    // A pod without the route answered every attempt: a rollout outlasted its
    // window. Nothing ran, so all of it can be sent again later.
    if (answer.kind === 'older-pod') return { results, notSent: toSend, unknown, stopped: 'server_restarting' };
    // A 5xx or a 408 says nothing about what ran, even with the route's own
    // code: the route may have failed after creating issues (finding A-2).
    if (answer.kind !== 'ok' && (answer.status >= 500 || answer.status === 408)) {
      return { results, notSent: later, unknown: [...unknown, ...sent], stopped: 'outcome_unknown' };
    }
    if (answer.kind === 'refused') throw new JiraServiceError(answer.code, { results: [...results], notSent: toSend });
    const parsed = answer.kind === 'ok' ? readIssuesAnswer(answer.data, sent) : null;
    if (!parsed) return { results, notSent: later, unknown: [...unknown, ...sent], stopped: 'outcome_unknown' };

    results.push(...parsed.results);
    unknown.push(...parsed.unaccounted);
    const links = linksOf(parsed.results);
    if (links.length > 0) dataService.applyJiraLinks(teamId, links);
    try {
      options.onProgress?.([...results]);
    } catch (err) {
      // A screen's failure must not abandon the actions still to send.
      console.warn('[jiraService] Progress callback failed', err);
    }

    toSend = [...parsed.remaining, ...later];
    if (parsed.stopped) {
      return { results, notSent: toSend, unknown, stopped: parsed.stopped, retryAfterSeconds: parsed.retryAfterSeconds };
    }
    idleRounds = parsed.results.length === 0 ? idleRounds + 1 : 0;
    if (idleRounds >= MAX_IDLE_ROUNDS) return { results, notSent: toSend, unknown };
  }
  return { results, notSent: [], unknown };
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
   * issue's project, read from Jira with the team's token.
   */
  getIssueTypes: async (
    teamId: string,
    source: { projectKey: string } | { parentKey: string }
  ): Promise<{ issueTypes: JiraIssueType[]; projectKey: string }> => {
    const data = dataOrThrow(await postAcrossRollout(teamRoute(teamId, 'issue-types'), { ...source }));
    if (!Array.isArray(data.issueTypes)) throw new JiraServiceError('unknown_error');
    return { issueTypes: data.issueTypes as JiraIssueType[], projectKey: String(data.projectKey ?? '') };
  },

  createIssues
};
