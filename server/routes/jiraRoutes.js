import { isDeepStrictEqual } from 'util';
import rateLimit from 'express-rate-limit';
import {
  isJiraIssueKey,
  isJiraParentScope,
  isJiraProjectKey,
  JIRA_MAX_ACTIONS_PER_REQUEST,
  parseJiraBaseUrl,
  validateJiraTarget
} from '../../utils/jira.js';
import { INVALID_EMAIL_ERROR, parseEmailInput } from '../../utils/emailAddress.js';
import {
  cannotHoldSubtasks,
  createJiraClient,
  isJiraCredential,
  JiraError,
  logUnreachable,
  truncate,
  unreachableCause
} from '../services/jiraClient.js';
import { createJiraCredentials, jiraStatusOf, readJiraConnection } from '../services/jiraCredentials.js';
import { createJiraIssues } from '../services/jiraIssues.js';
import { NO_OP_LIVE_SESSION_PATCH } from '../services/liveSessionRename.js';
import { NO_OP_SECURITY_EVENTS, SECURITY_ACTIONS } from '../services/securityEvents.js';

/**
 * The Jira routes: a team's status, token, target, issue types and issue
 * creation (`registerJiraTeamRoutes`; the creation itself is `jiraIssues.js`),
 * and the super admin's connection settings (`registerJiraAdminRoutes`).
 *
 * Neither is registered from `server.js`. The team routes are registered from
 * inside `registerTeamRoutes` and the console routes from inside
 * `registerSuperAdminRoutes`, so they receive those registrars' wiring — the
 * audit recorder, the live-session patch and the pod's shutdown state above
 * all, whose `server.js` source checks would not notice a new top-level
 * registrar forgetting them —
 * and the console routes fall under the super-admin route inventory that posts
 * a forged credential to every route it finds.
 *
 * Every handler authenticates first. A caller that fails it gets the same 401
 * as on every other team route, and costs no Jira call, no secret read and no
 * audit row (`__tests__/jiraRouteAuth.test.ts` derives the paths from the
 * router and checks all three).
 *
 * The browser never talks to Jira (the CSP's `connect-src 'self'` forbids it,
 * and Data Center sends no CORS headers): these routes do, through
 * `jiraClient.js`, to the configured address only.
 */

// A pasted personal access token is about 44 characters and a Cloud API token
// about 200. Far beyond either, a value is not a token, and sealing it would
// only grow the row.
const JIRA_TOKEN_MAX_LENGTH = 4096;
// Ids are the client's short random strings; the bound keeps a hostile body
// from making the batch route scan the team for megabyte keys.
const ID_MAX_LENGTH = 128;
// The requester's name is cut, never refused: a member's name has no length
// limit anywhere, and the issue keeps only 80 characters of it
// (`issueFields`). The cut only bounds what the request carries along.
const REQUESTED_BY_MAX_LENGTH = 256;
const CONTENT_LANGUAGES = new Set(['en', 'fr']);

/**
 * The answer for a Jira failure on a team route. A Jira 401 is answered 400:
 * on these routes 401 means *our* credential was refused, and a client that
 * read it that way would sign the facilitator out because Jira refused the
 * team's token. Anything Jira answered that these routes do not expect — a
 * redirect, a 4xx with no meaning here, a 5xx, an unreadable body — reads as
 * Jira being unavailable.
 *
 * @param {JiraError} err
 * @returns {{ status: number, body: { error: string, retryAfterSeconds?: number } }}
 */
const jiraErrorAnswer = (err) => {
  switch (err.code) {
    case 'jira_auth_failed':
      return { status: 400, body: { error: 'jira_auth_failed' } };
    case 'jira_forbidden':
      return { status: 400, body: { error: 'jira_forbidden' } };
    case 'jira_not_found':
      return { status: 404, body: { error: 'jira_not_found' } };
    case 'jira_rate_limited':
      return {
        status: 429,
        body: {
          error: 'jira_rate_limited',
          ...(err.retryAfterSeconds === null ? {} : { retryAfterSeconds: err.retryAfterSeconds })
        }
      };
    case 'jira_unreachable':
      return { status: 502, body: { error: 'jira_unreachable' } };
    default:
      return { status: 502, body: { error: 'jira_unavailable' } };
  }
};

// What stopped a call that got no answer is logged, never answered: the
// answer goes to a team credential (`jiraClient.js`, `logUnreachable`).
const sendJiraError = (res, err, { where, teamId }) => {
  logUnreachable(where, teamId, err);
  const { status, body } = jiraErrorAnswer(err);
  return res.status(status).json(body);
};

const isBoundedId = (value) => typeof value === 'string' && value !== '' && value.length <= ID_MAX_LENGTH;

const isOptionalBoolean = (value) => value === undefined || typeof value === 'boolean';

// The parents in doubt a request may confirm: scopes, each once, and never
// more than it has actions, since each action goes under one parent.
const isForcedScopeList = (value, actionCount) => value === undefined || (
  Array.isArray(value)
  && value.length <= actionCount
  && value.every(isJiraParentScope)
  && new Set(value).size === value.length
);

/**
 * The shape of a `/jira/issues` body, checked before anything is read: action
 * ids (one to ten, distinct), and optional target override, live session,
 * requester name, content language, `force`, and the three `sessionParent`
 * options. The target's *content* is judged later, by `validateJiraTarget`,
 * after the connection and the token; the requester's name is cut to its
 * bound, never a reason to refuse.
 *
 *  - `adoptParent`: the `parent`-mode override names the parent this send
 *    goes under, and it becomes the stored parent of every session the send
 *    touches that has none yet (only once Jira has created a sub-task of that
 *    session under it). The route requires the override (see below).
 *  - `replaceParents`: it also replaces a session's stored parent. Only with
 *    `adoptParent`: replacing is a consequence of naming a parent, never a
 *    request of its own.
 *  - `forceParentScopes`: the sessions whose parent the facilitator saw in
 *    doubt (a lost answer) and confirmed: their parent is created although
 *    one may already be in Jira. It lifts that skip only, as `force` lifts an
 *    action's, and only for those scopes — never for a doubt the server
 *    finds during the send, which no screen showed [review F2-1]. A list of
 *    `isJiraParentScope` strings, each once, at most one per action.
 *
 * @param {unknown} body
 * @returns {{ ok: true, request: object } | { ok: false }}
 */
export const parseJiraIssuesRequest = (body) => {
  const { actionIds, target, sessionId, requestedBy, language, force, adoptParent, replaceParents, forceParentScopes } = body || {};
  const refuse = { ok: false };
  if (!Array.isArray(actionIds) || actionIds.length < 1 || actionIds.length > JIRA_MAX_ACTIONS_PER_REQUEST) return refuse;
  if (!actionIds.every(isBoundedId) || new Set(actionIds).size !== actionIds.length) return refuse;
  if (target !== undefined && target !== null && (typeof target !== 'object' || Array.isArray(target))) return refuse;
  if (sessionId !== undefined && sessionId !== null && !isBoundedId(sessionId)) return refuse;
  if (requestedBy !== undefined && requestedBy !== null && typeof requestedBy !== 'string') return refuse;
  if (language !== undefined && language !== null && !CONTENT_LANGUAGES.has(language)) return refuse;
  if (force !== undefined && typeof force !== 'boolean') return refuse;
  if (!isOptionalBoolean(adoptParent) || !isOptionalBoolean(replaceParents)) return refuse;
  if (!isForcedScopeList(forceParentScopes, actionIds.length)) return refuse;
  if (replaceParents === true && adoptParent !== true) return refuse;
  return {
    ok: true,
    request: {
      actionIds: [...actionIds],
      target: target ?? null,
      sessionId: sessionId ?? null,
      requestedBy: typeof requestedBy === 'string' ? truncate(requestedBy, REQUESTED_BY_MAX_LENGTH) : '',
      language: language ?? null,
      force: force === true,
      adoptParent: adoptParent === true,
      replaceParents: replaceParents === true,
      forceParentScopes: forceParentScopes === undefined ? [] : [...forceParentScopes]
    }
  };
};

/**
 * @param {object} deps
 * @param {import('express').Express} deps.app
 * @param {object} deps.dataStore
 * @param {object} deps.tokenService `deriveKey` and `canSealSecrets` are read here.
 * @param {Function} deps.authenticateTeam
 * @param {Function} deps.atomicUpdateTeam
 * @param {{ record: Function }} [deps.securityEvents]
 * @param {Function} [deps.liveSessionPatch] Carries a created issue's key into the live session.
 * @param {object} [deps.jiraClientOptions] `timeoutMs`, `deadlineMs`, `request`: what tests inject.
 * @param {() => Date} [deps.now]
 * @param {() => boolean} [deps.isShuttingDown] True once the pod is draining: the batch starts no new creation.
 * @param {object} [deps.jiraIssuesOptions] The batch's clock, time budget, claim lifetime and link retries
 *   (`createJiraIssues`): what tests inject.
 */
const registerJiraTeamRoutes = ({
  app,
  dataStore,
  tokenService,
  authenticateTeam,
  atomicUpdateTeam,
  securityEvents = NO_OP_SECURITY_EVENTS,
  liveSessionPatch = NO_OP_LIVE_SESSION_PATCH,
  jiraClientOptions = {},
  now = () => new Date(),
  isShuttingDown = () => false,
  jiraIssuesOptions = {},
  statusLimiterMax = 120,
  writeLimiterMax = 60,
  issuesLimiterMax = 60
}) => {
  // The status is read by every participant's screen on Review entry and on
  // every reconnect, so it has a read budget of its own; the writes and the
  // issue-type lookups share one; the batch creation has its own, so a burst
  // of settings edits behind one office address cannot block it.
  const limiter = (max) => rateLimit({
    windowMs: 60 * 1000,
    max,
    message: { error: 'too_many_requests', retryAfter: '1 minute' },
    standardHeaders: true,
    legacyHeaders: false
  });
  const statusLimiter = limiter(statusLimiterMax);
  const writeLimiter = limiter(writeLimiterMax);
  const issuesLimiter = limiter(issuesLimiterMax);

  const credentials = createJiraCredentials({ dataStore, tokenService, now });
  const clientFor = (connection, credential) => createJiraClient({
    ...jiraClientOptions,
    baseUrl: connection.baseUrl,
    allowSelfSignedCerts: connection.allowSelfSignedCerts,
    credential
  });

  // The record is never loaded for the target: the status is read far more
  // often than anything else here, and a team's history can weigh megabytes.
  // The summary cache holds the target and parses nothing on a warm read.
  const statusFor = async (teamId) => {
    const connection = await readJiraConnection(dataStore);
    const summary = await dataStore.loadTeamSummary(teamId, { withJiraTarget: true });
    const secret = await credentials.read(teamId, connection.baseUrl);
    return jiraStatusOf({ connection, target: summary?.jiraTarget, secret });
  };

  // The connection and a team credential the connection can use, or the 409
  // that refuses them. Shared by every route that calls Jira with the token.
  const teamAccess = async (teamId) => {
    const connection = await readJiraConnection(dataStore);
    if (!connection.enabled) return { error: 'jira_not_configured' };
    const secret = await credentials.read(teamId, connection.baseUrl);
    if (!secret.configured) return { error: 'jira_token_missing' };
    if (!secret.credential) return { error: 'jira_token_unusable' };
    return { connection, secret, client: clientFor(connection, secret.credential) };
  };

  // Every route here: authenticated before the body is read, with the answer
  // every other team route gives a refused credential.
  const authenticated = async (req, res) => {
    const { teamId } = req.params;
    const { password, sessionToken } = req.body || {};
    const { error, via } = await authenticateTeam(teamId, password, sessionToken, { needsTeam: false });
    if (error) {
      res.status(401).json({ error });
      return null;
    }
    return { teamId, via };
  };

  app.post('/api/team/:teamId/jira/status', statusLimiter, async (req, res) => {
    try {
      const caller = await authenticated(req, res);
      if (!caller) return;
      res.json(await statusFor(caller.teamId));
    } catch (err) {
      console.error('[Server] Failed to read the Jira status', err);
      res.status(500).json({ error: 'failed_to_load' });
    }
  });

  /**
   * Sets or replaces the team's Jira token. Any team credential may (D1): the
   * spec gives the token to "whoever manages the team", and an invite-link
   * holder can already change the recovery address or delete the team. The
   * audit row records it, with the credential that authenticated.
   *
   * The token is checked against Jira before it is stored — `serverInfo` then
   * `myself`, both authenticated — so a token that is stored is one Jira
   * accepted, and the settings can say who it belongs to.
   */
  app.post('/api/team/:teamId/jira/token', writeLimiter, async (req, res) => {
    try {
      const caller = await authenticated(req, res);
      if (!caller) return;
      const { teamId, via } = caller;
      const { token, email } = req.body || {};

      const connection = await readJiraConnection(dataStore);
      if (!connection.enabled) return res.status(409).json({ error: 'jira_not_configured' });
      // A key derived from the per-process fallback secret dies with the pod
      // and differs on every replica: a token sealed with it could not be read
      // after the next restart, or by the next request on another pod. One
      // derived from the templates' example secret is public: a dump would
      // hand the token over (`canSealSecrets`).
      if (!tokenService.canSealSecrets) return res.status(503).json({ error: 'jira_secret_unavailable' });

      const typed = typeof token === 'string' ? token.trim() : '';
      if (!typed) return res.status(400).json({ error: 'jira_token_missing' });
      // An email means Jira Cloud (Basic `email:api-token`); none, a Data
      // Center personal access token (Bearer). The shared rule cleans what a
      // paste leaves around it, and a blank one reads as none.
      const parsedEmail = parseEmailInput(email);
      if (!parsedEmail.ok) return res.status(400).json({ error: INVALID_EMAIL_ERROR });
      const credential = parsedEmail.email ? { token: typed, email: parsedEmail.email } : { token: typed };
      // A value no Jira accepts — a space inside it, a character a header
      // cannot carry — is answered as Jira would answer it, without the call.
      if (typed.length > JIRA_TOKEN_MAX_LENGTH || !isJiraCredential(credential)) {
        return res.status(400).json({ error: 'jira_auth_failed' });
      }

      const client = clientFor(connection, credential);
      let serverInfo = null;
      let identity;
      try {
        serverInfo = await client.serverInfo();
        identity = await client.myself();
      } catch (err) {
        if (!(err instanceof JiraError)) throw err;
        if (err.code !== 'jira_auth_failed') return sendJiraError(res, err, { where: 'checking a token', teamId });
        // Jira answers 401 to a refused credential on every resource, so the
        // authenticated `serverInfo` may never have answered: an anonymous one
        // says whether this is Cloud, where the usual cause is a scoped or
        // expired API token (J-7). A hint only; its failure changes nothing.
        let deploymentType = serverInfo?.deploymentType ?? null;
        if (!deploymentType) {
          deploymentType = await clientFor(connection, null).serverInfo()
            .then((info) => info.deploymentType, () => null);
        }
        return res.status(400).json({ error: deploymentType === 'Cloud' ? 'jira_auth_failed_cloud' : 'jira_auth_failed' });
      }

      await credentials.save(teamId, {
        baseUrl: connection.baseUrl,
        credential,
        // A display name, else the account's name or id — never its email,
        // which is half of a Cloud credential and goes to every member's screen.
        connectedAs: identity.displayName ?? identity.name ?? identity.accountId,
        serverInfo
      });
      // The team may have been deleted while Jira answered. Its deletion
      // removed its secret first, so this one would outlive it until the next
      // startup sweep: take it back, and answer as for any deleted team.
      if (!(await dataStore.teamExists(teamId))) {
        await credentials.remove(teamId);
        return res.status(401).json({ error: 'team_not_found' });
      }

      await securityEvents.record(req, {
        action: SECURITY_ACTIONS.TEAM_JIRA_TOKEN_CHANGE,
        actor: `team:${teamId}`,
        outcome: 'success',
        target: teamId,
        detail: { cleared: false, via }
      });
      res.json(await statusFor(teamId));
    } catch (err) {
      console.error('[Server] Failed to save the team Jira token', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post('/api/team/:teamId/jira/token/delete', writeLimiter, async (req, res) => {
    try {
      const caller = await authenticated(req, res);
      if (!caller) return;
      const { teamId, via } = caller;

      // Recorded only when a token was there: a row saying "cleared" for a
      // team that had none would show a removal that never happened.
      const hadToken = (await dataStore.loadTeamSecret(teamId)) !== null;
      await credentials.remove(teamId);
      if (hadToken) {
        await securityEvents.record(req, {
          action: SECURITY_ACTIONS.TEAM_JIRA_TOKEN_CHANGE,
          actor: `team:${teamId}`,
          outcome: 'success',
          target: teamId,
          detail: { cleared: true, via }
        });
      }
      res.json(await statusFor(teamId));
    } catch (err) {
      console.error('[Server] Failed to remove the team Jira token', err);
      res.status(500).json({ error: 'failed_to_delete' });
    }
  });

  /**
   * Stores the team's Jira target (`null` removes it). Validated by the rule
   * the screens apply (`validateJiraTarget`), and written here only: `/update`
   * ignores `jiraTarget`, so a stale tab cannot put an old target back.
   */
  app.post('/api/team/:teamId/jira/target', writeLimiter, async (req, res) => {
    try {
      const caller = await authenticated(req, res);
      if (!caller) return;
      const { teamId } = caller;
      const { target } = req.body || {};

      let next = null;
      if (target !== null) {
        const validation = validateJiraTarget(target);
        if (!validation.ok) return res.status(400).json({ error: validation.error });
        next = validation.target;
      }

      const result = await atomicUpdateTeam(teamId, (currentTeam) => {
        if (next === null) {
          if (!Object.prototype.hasOwnProperty.call(currentTeam, 'jiraTarget')) return null;
          delete currentTeam.jiraTarget;
          return currentTeam;
        }
        // Saving the form unchanged writes nothing.
        if (isDeepStrictEqual(currentTeam.jiraTarget, next)) return null;
        currentTeam.jiraTarget = next;
        return currentTeam;
      });
      if (!result.success) return res.status(500).json({ error: result.error });

      res.json(await statusFor(teamId));
    } catch (err) {
      console.error('[Server] Failed to save the team Jira target', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  /**
   * The issue types the target form offers, read from Jira with the team's
   * token (createmeta, every page). For a project, every type an issue can be
   * created with, sub-task types included, each with its `subtask` flag (and
   * Jira Cloud's `hierarchyLevel`): the `sessionParent` form needs the
   * standard types for the parent and the sub-task types for the actions from
   * one read, and every form filters the list by its mode. `subtasksIncluded`
   * says so, since a pod of an older release answered standard types only.
   * For a parent issue, the sub-task types of the parent's project — a
   * sub-task is created there — and a parent that cannot hold sub-tasks (a
   * sub-task, or an epic on Cloud) is refused, because Jira refuses it as a
   * parent (J-3).
   */
  app.post('/api/team/:teamId/jira/issue-types', writeLimiter, async (req, res) => {
    try {
      const caller = await authenticated(req, res);
      if (!caller) return;
      const { teamId } = caller;
      const { projectKey, parentKey } = req.body || {};

      const byProject = projectKey !== undefined && projectKey !== null;
      const byParent = parentKey !== undefined && parentKey !== null;
      if (byProject === byParent || (byProject && !isJiraProjectKey(projectKey)) || (byParent && !isJiraIssueKey(parentKey))) {
        return res.status(400).json({ error: 'invalid_jira_target' });
      }

      const access = await teamAccess(teamId);
      if (access.error) return res.status(409).json({ error: access.error });

      try {
        if (byProject) {
          const types = await access.client.issueTypes(projectKey);
          return res.json({ issueTypes: types, projectKey, subtasksIncluded: true });
        }
        const parent = await access.client.parentIssue(parentKey);
        if (cannotHoldSubtasks(parent)) return res.status(400).json({ error: 'jira_parent_invalid' });
        const types = await access.client.issueTypes(parent.projectKey);
        return res.json({ issueTypes: types.filter((type) => type.subtask), projectKey: parent.projectKey });
      } catch (err) {
        if (!(err instanceof JiraError)) throw err;
        // The settings say the token was refused until someone replaces it
        // (U-1) — this token, not one saved while this call was in flight.
        if (err.code === 'jira_auth_failed') await credentials.markRefused(teamId, access.secret.envelope);
        return sendJiraError(res, err, { where: 'reading the issue types', teamId });
      }
    } catch (err) {
      console.error('[Server] Failed to read the Jira issue types', err);
      res.status(500).json({ error: 'failed_to_load' });
    }
  });

  const createIssues = createJiraIssues({
    atomicUpdateTeam,
    markRefused: credentials.markRefused,
    liveSessionPatch,
    isShuttingDown,
    now,
    ...jiraIssuesOptions
  });
  registerJiraIssuesRoute({ app, limiter: issuesLimiter, authenticated, teamAccess, dataStore, createIssues });
};

/**
 * The target a batch creates in: the one-time override the dialog sent, judged
 * by the rule the form applies, or the team's stored target. A stored target
 * that no longer passes that rule reads as none, as the status reads it.
 *
 * @returns {Promise<{ ok: true, target: object } | { ok: false, error: string }>}
 */
const resolveJiraTarget = async (dataStore, teamId, override) => {
  if (override !== null) return validateJiraTarget(override);
  // The summary cache holds the target: the record, megabytes of history, is
  // read by the claims, under the row lock, and only there.
  const summary = await dataStore.loadTeamSummary(teamId, { withJiraTarget: true });
  const stored = summary?.jiraTarget ? validateJiraTarget(summary.jiraTarget) : null;
  return stored?.ok ? stored : { ok: false, error: 'jira_target_missing' };
};

/**
 * Creating issues (`/jira/issues`): one to ten actions per request, created in
 * order by `createJiraIssues` (`jiraIssues.js`, which says how an action is
 * never created twice). Checked first, in this order: the credential, the
 * body's shape, the connection and the team's token (409), the target (400),
 * and that `adoptParent` comes with a `parent`-mode override (400).
 * Every answer past those checks is a `JiraIssuesResponse`, whatever Jira
 * said: a refusal or an outage is a result or a stop, never an error status,
 * so the client always learns which actions were created.
 */
const registerJiraIssuesRoute = ({ app, limiter, authenticated, teamAccess, dataStore, createIssues }) => {
  app.post('/api/team/:teamId/jira/issues', limiter, async (req, res) => {
    // Watched from the first line: a caller that gave up (a closed tab, a
    // proxy's timeout) must not have issues created on its behalf that it
    // will never hear about. `close` before the answer is written is the
    // caller going away; after it, the ordinary end of the response.
    let clientGone = false;
    res.on('close', () => {
      if (!res.writableFinished) clientGone = true;
    });
    const isClientGone = () => clientGone || req.socket?.destroyed === true;

    try {
      const caller = await authenticated(req, res);
      if (!caller) return;
      const { teamId } = caller;
      const parsed = parseJiraIssuesRequest(req.body);
      if (!parsed.ok) return res.status(400).json({ error: 'invalid_request' });

      const access = await teamAccess(teamId);
      if (access.error) return res.status(409).json({ error: access.error });

      const target = await resolveJiraTarget(dataStore, teamId, parsed.request.target);
      if (!target.ok) return res.status(400).json({ error: target.error });
      // A parent is adopted only when one is named for this send: the
      // `parent`-mode override. Without it there is nothing to adopt, and a
      // stored `parent` target is the team's, not this send's choice.
      if (parsed.request.adoptParent && (parsed.request.target === null || target.target.mode !== 'parent')) {
        return res.status(400).json({ error: 'invalid_request' });
      }

      res.json(await createIssues({
        teamId,
        request: parsed.request,
        target: target.target,
        client: access.client,
        envelope: access.secret.envelope,
        isClientGone
      }));
    } catch (err) {
      console.error('[Server] Failed to create issues in Jira', err);
      res.status(500).json({ error: 'failed_to_create' });
    }
  });
};

// What the console reads and saves. An address is stored canonical or empty.
const adminSettingsOf = (settings) => ({
  enabled: settings?.enabled === true,
  baseUrl: parseJiraBaseUrl(settings?.baseUrl) ?? '',
  allowSelfSignedCerts: settings?.allowSelfSignedCerts === true
});

/**
 * The super admin's Jira connection: one Jira for the deployment, beside the
 * AI settings in the console. Registered from inside `registerSuperAdminRoutes`.
 *
 * @param {object} deps
 * @param {import('express').Express} deps.app
 * @param {object} deps.dataStore
 * @param {{ validateSuperAdminAuth: Function }} deps.tokenService
 * @param {{ addServerLog: Function }} deps.logService
 * @param {{ record: Function }} [deps.securityEvents]
 * @param {() => boolean} [deps.skipRateLimit] The console limiters' own rule.
 * @param {object} [deps.jiraClientOptions]
 */
const registerJiraAdminRoutes = ({
  app,
  dataStore,
  tokenService,
  logService,
  securityEvents = NO_OP_SECURITY_EVENTS,
  skipRateLimit = () => false,
  jiraClientOptions = {}
}) => {
  // The console's read and action settings, built here like the merge and
  // restore routes build theirs.
  const readLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { error: 'too_many_requests', retryAfter: '1 minute' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipRateLimit,
    skipSuccessfulRequests: true
  });
  const actionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: { error: 'too_many_attempts', retryAfter: '15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipRateLimit
  });
  const unauthorized = (res) => res.status(401).json({ error: 'unauthorized' });

  app.post('/api/super-admin/jira-settings', readLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) return unauthorized(res);
    try {
      res.json(adminSettingsOf(await dataStore.loadJiraSettings()));
    } catch (err) {
      console.error('[Server] Failed to load the Jira settings', err);
      res.status(500).json({ error: 'failed_to_load' });
    }
  });

  /**
   * Saves the connection. The address is stored in its canonical form, so a
   * re-save with another spelling of the same Jira keeps every team's token
   * readable (it is bound to that form); a different address voids them all,
   * which the console warns about before saving. Empty is allowed only with
   * the connection off.
   */
  app.post('/api/super-admin/update-jira-settings', actionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) return unauthorized(res);
    try {
      const { enabled, baseUrl, allowSelfSignedCerts } = req.body || {};
      const settings = { enabled: enabled === true, baseUrl: '', allowSelfSignedCerts: allowSelfSignedCerts === true };
      const blank = baseUrl === undefined || baseUrl === null || (typeof baseUrl === 'string' && baseUrl.trim() === '');
      if (!blank) {
        settings.baseUrl = parseJiraBaseUrl(baseUrl);
        if (!settings.baseUrl) return res.status(400).json({ error: 'invalid_jira_base_url' });
      } else if (settings.enabled) {
        return res.status(400).json({ error: 'invalid_jira_base_url' });
      }

      try {
        await dataStore.saveJiraSettings(settings);
      } catch (err) {
        console.error('[Server] Failed to save the Jira settings', err);
        return res.status(500).json({ error: 'failed_to_save' });
      }
      logService.addServerLog('info', 'server', `Jira settings updated (enabled: ${settings.enabled})`);
      // Where every team's token is now sent, and whether certificates are
      // checked on the way: neither is a secret, both are what an audit needs.
      await securityEvents.record(req, {
        action: SECURITY_ACTIONS.JIRA_SETTINGS_UPDATE,
        actor: 'super-admin',
        outcome: 'success',
        detail: { ...settings }
      });
      res.json(settings);
    } catch (err) {
      console.error('[Server] Failed to update the Jira settings', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  /**
   * Tests an address before it is saved: an anonymous `serverInfo`, nothing
   * stored. It answers what was learnt — the version and whether it is Cloud,
   * or the failure with Jira's status, a redirect's target and the messages
   * Jira wrote, or what stopped a call that got no answer (`transport`: tls,
   * network, timeout…, and its system or OpenSSL code) — and never the raw
   * answer, which on a misconfigured address can be any page at all, nor the
   * transport's message, which names the host and its port. The transport is
   * answered here only: the route is the super admin's, like `test-ai`, while
   * the team routes log it (`sendJiraError`).
   */
  app.post('/api/super-admin/test-jira', actionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) return unauthorized(res);
    try {
      const { baseUrl, allowSelfSignedCerts } = req.body || {};
      const base = parseJiraBaseUrl(baseUrl);
      if (!base) return res.status(400).json({ error: 'invalid_jira_base_url' });

      try {
        // The one outbound call to an address taken from a request body, on
        // purpose: the console must test an address before saving it. It is
        // reachable with the super-admin credential only — the same holder can
        // save that address and have the server call it anyway — the address
        // is parsed first (https, or http on loopback; no userinfo, query or
        // fragment), no credential is sent, redirects are not followed, and
        // only parsed fields come back. CodeQL's js/request-forgery alert on
        // this line is expected; its dismissal rationale is in
        // HARDENING_STATUS.md.
        const info = await createJiraClient({
          ...jiraClientOptions,
          baseUrl: base,
          allowSelfSignedCerts: allowSelfSignedCerts === true,
          credential: null
        }).serverInfo();
        res.json({ ok: true, version: info.version, deploymentType: info.deploymentType });
      } catch (err) {
        if (!(err instanceof JiraError)) throw err;
        const cause = unreachableCause(err);
        const detail = err.status !== null ? ` (${err.status})` : cause ? ` (${cause})` : '';
        console.warn(`[Server] Jira connection test failed: ${err.code}${detail}`);
        res.json({
          ok: false,
          error: err.code,
          ...(err.status === null ? {} : { status: err.status }),
          ...(err.location ? { location: err.location } : {}),
          ...(err.jiraMessages.length > 0 ? { messages: err.jiraMessages } : {}),
          ...(err.transport ? { transport: err.transport } : {}),
          ...(err.transportCode ? { transportCode: err.transportCode } : {})
        });
      }
    } catch (err) {
      console.error('[Server] Jira connection test failed', err);
      res.status(500).json({ error: 'jira_test_failed' });
    }
  });
};

export { registerJiraAdminRoutes, registerJiraTeamRoutes };
