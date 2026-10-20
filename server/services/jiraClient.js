/**
 * Jira client — the only code that talks to Jira.
 *
 * Every call goes to the Jira the super admin configured: the URL is the base
 * URL plus one of five fixed REST paths (`jiraApiUrl`, which keeps a context
 * path such as `/jira`), and a project key or an issue key is validated before
 * it becomes part of a path. A client of this module therefore cannot make the
 * server call any other address, whatever a request body holds.
 *
 * It speaks REST API v2, which Data Center and Cloud both serve. The two differ
 * in how a team authenticates, and the credential says which applies: an email
 * beside the token means Cloud's Basic `email:api-token`, a token alone means a
 * Data Center personal access token sent as `Bearer`.
 *
 * ## Errors
 *
 * Every failure is a `JiraError`. Its `outcome` is what the caller decides on
 * when the call was a creation:
 *
 *  - `'refused'`: Jira answered, and did not create anything (a 3xx or a 4xx);
 *  - `'not_sent'`: Jira never received the request (no connection, no TLS);
 *  - `'unknown'`: the issue may exist — a 5xx, a request sent whose answer was
 *    lost, or a 2xx without a usable key. Such an action is never created again
 *    automatically.
 *
 * `jiraMessages` carries what Jira wrote (`errorMessages` and the values of
 * `errors`), bounded, so a refusal can be shown to the facilitator in Jira's
 * own words. Nothing in an error carries the token or the request URL.
 */

import {
  isJiraIssueKey,
  isJiraIssueTypeId,
  isJiraProjectKey,
  jiraApiUrl,
  parseJiraBaseUrl
} from '../../utils/jira.js';
import { OutboundHttpError, request as outboundRequest } from './outboundHttp.js';

/** No Jira answer this client reads is anywhere near this size. */
export const JIRA_RESPONSE_MAX_BYTES = 1024 * 1024;

// The issue-type list is paged; ten pages of a hundred is far beyond any real
// project, and stops a server that never says it is done.
const ISSUE_TYPE_PAGE_SIZE = 100;
const ISSUE_TYPE_MAX_PAGES = 10;

// Jira's refusal is shown to the facilitator as written, within these bounds.
const JIRA_MESSAGES_MAX = 20;
const JIRA_MESSAGE_MAX_LENGTH = 500;

// A rate limit's Retry-After is honoured as whole seconds only (an HTTP date
// would need a trustworthy clock on both sides), and never beyond two minutes.
const RETRY_AFTER_MAX_SECONDS = 120;

const LOCATION_MAX_LENGTH = 2048;
const TEXT_MAX_LENGTH = 255;

/**
 * @typedef {'refused' | 'not_sent' | 'unknown'} JiraOutcome
 */

export class JiraError extends Error {
  /**
   * @param {object} details
   * @param {string} details.code `jira_refused`, `jira_auth_failed`, `jira_forbidden`, `jira_not_found`,
   *   `jira_rate_limited`, `jira_redirect`, `jira_unavailable` or `jira_unreachable`.
   * @param {JiraOutcome} details.outcome
   * @param {number | null} [details.status] Jira's HTTP status; `null` when no answer came back.
   * @param {string[]} [details.jiraMessages]
   * @param {number | null} [details.retryAfterSeconds] Only for `jira_rate_limited`.
   * @param {string | null} [details.location] Only for `jira_redirect`.
   * @param {{ cause?: unknown }} [options]
   */
  constructor({ code, outcome, status = null, jiraMessages = [], retryAfterSeconds = null, location = null }, options) {
    super(status === null ? `Jira request failed: ${code}` : `Jira answered ${status}: ${code}`, options);
    this.name = 'JiraError';
    this.code = code;
    this.status = status;
    this.jiraMessages = jiraMessages;
    this.retryAfterSeconds = retryAfterSeconds;
    this.outcome = outcome;
    this.location = location;
  }
}

// A Bearer token travels in the header as typed, so it must be visible ASCII
// with no space. Personal access tokens and Cloud API tokens all are.
const HEADER_TOKEN_PATTERN = /^[\x21-\x7e]+$/;
const hasControlCharacter = (text) => [...text].some((char) => {
  const code = char.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
});

/**
 * True when `credential` can be sent to Jira: `{ token }` for Data Center or
 * `{ token, email }` for Cloud. An email is refused when it holds a colon,
 * which would move the boundary between email and token in a Basic header.
 *
 * @param {unknown} credential
 * @returns {boolean}
 */
export const isJiraCredential = (credential) => {
  if (!credential || typeof credential !== 'object') return false;
  const { token, email } = /** @type {Record<string, unknown>} */ (credential);
  if (typeof token !== 'string' || !HEADER_TOKEN_PATTERN.test(token)) return false;
  if (email === undefined || email === null) return true;
  return typeof email === 'string' && email !== '' && !email.includes(':') && !hasControlCharacter(email);
};

const authorizationFor = (credential) => {
  if (credential === null || credential === undefined) return null;
  if (!isJiraCredential(credential)) throw new TypeError('createJiraClient: the credential cannot be sent to Jira');
  const { token, email } = credential;
  if (typeof email === 'string') return `Basic ${Buffer.from(`${email}:${token}`, 'utf8').toString('base64')}`;
  return `Bearer ${token}`;
};

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Cut at `max` UTF-16 units, one less when the cut would halve an emoji.
 *
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export const truncate = (text, max) => {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
};

const boundedText = (value) => (typeof value === 'string' && value !== '' ? truncate(value, TEXT_MAX_LENGTH) : null);

/** Jira's own words: `errorMessages`, then the values of `errors`. */
const jiraMessagesOf = (body) => {
  const data = parseJson(body);
  if (!isObject(data)) return [];
  const messages = [
    ...(Array.isArray(data.errorMessages) ? data.errorMessages : []),
    ...(isObject(data.errors) ? Object.values(data.errors) : [])
  ];
  return messages
    .filter((message) => typeof message === 'string' && message.trim() !== '')
    .slice(0, JIRA_MESSAGES_MAX)
    .map((message) => truncate(message, JIRA_MESSAGE_MAX_LENGTH));
};

const headerValue = (headers, name) => {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
};

const retryAfterOf = (headers) => {
  const value = headerValue(headers, 'retry-after');
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  return Math.min(Number.parseInt(value.trim(), 10), RETRY_AFTER_MAX_SECONDS);
};

/** The error a non-2xx answer stands for. */
const errorForAnswer = ({ status, headers, body }) => {
  const details = { status, jiraMessages: jiraMessagesOf(body) };
  if (status >= 300 && status < 400) {
    const location = headerValue(headers, 'location');
    return new JiraError({
      ...details,
      code: 'jira_redirect',
      outcome: 'refused',
      location: typeof location === 'string' ? truncate(location, LOCATION_MAX_LENGTH) : null
    });
  }
  if (status === 400) return new JiraError({ ...details, code: 'jira_refused', outcome: 'refused' });
  if (status === 401) return new JiraError({ ...details, code: 'jira_auth_failed', outcome: 'refused' });
  if (status === 403) return new JiraError({ ...details, code: 'jira_forbidden', outcome: 'refused' });
  if (status === 404) return new JiraError({ ...details, code: 'jira_not_found', outcome: 'refused' });
  if (status === 429) {
    return new JiraError({ ...details, code: 'jira_rate_limited', outcome: 'refused', retryAfterSeconds: retryAfterOf(headers) });
  }
  // A 408 can come from a proxy that already passed the request on, so it is
  // not proof that nothing was created; every other 4xx is a refusal.
  if (status >= 400 && status < 500 && status !== 408) {
    return new JiraError({ ...details, code: 'jira_refused', outcome: 'refused' });
  }
  return new JiraError({ ...details, code: 'jira_unavailable', outcome: 'unknown' });
};

// A 2xx this client cannot read: it is not Jira answering as documented, and
// for a creation nothing proves the issue was not made.
const unreadable = (status) => new JiraError({ code: 'jira_unavailable', outcome: 'unknown', status });

// Jira's ids (issue types, projects, issues) are digit strings, which some
// versions send as numbers. They are kept as the string Jira expects back; an
// issue-type id and any other Jira id share that shape.
const numericId = (value) => {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return isJiraIssueTypeId(id) ? id : null;
};

const issueTypeOf = (entry) => {
  const id = isObject(entry) ? numericId(entry.id) : null;
  if (!id) return null;
  return { id, name: boundedText(entry.name) ?? id, subtask: entry.subtask === true };
};

/**
 * @param {object} options
 * @param {string} options.baseUrl The configured Jira, as `parseJiraBaseUrl` accepts it.
 * @param {boolean} [options.allowSelfSignedCerts=false]
 * @param {{ token: string, email?: string } | null} [options.credential=null] `null` calls Jira anonymously.
 * @param {number} [options.timeoutMs=15000] Socket idle timeout of each call.
 * @param {number} [options.deadlineMs=15000] Wall-clock limit of each call.
 * @param {typeof outboundRequest} [options.request] The transport; tests inject one.
 */
export const createJiraClient = ({
  baseUrl,
  allowSelfSignedCerts = false,
  credential = null,
  timeoutMs = 15000,
  deadlineMs = 15000,
  request = outboundRequest
}) => {
  const base = parseJiraBaseUrl(baseUrl);
  if (!base) throw new TypeError('createJiraClient: the base is not a Jira base URL');

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'RetroGemini'
  };
  const authorization = authorizationFor(credential);
  if (authorization) headers.Authorization = authorization;

  /**
   * Sends one call; resolves with a 2xx answer, throws a JiraError for anything else.
   * `ownConnection`: never on a pooled connection (see `createIssue`).
   */
  const send = async (method, path, payload, { ownConnection = false } = {}) => {
    let answer;
    try {
      answer = await request({
        url: jiraApiUrl(base, path),
        method,
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
        timeoutMs,
        deadlineMs,
        maxBytes: JIRA_RESPONSE_MAX_BYTES,
        rejectUnauthorized: allowSelfSignedCerts === true ? false : undefined,
        ...(ownConnection ? { keepAlive: false } : {})
      });
    } catch (err) {
      if (!(err instanceof OutboundHttpError)) throw err;
      throw new JiraError(
        { code: 'jira_unreachable', outcome: err.phase === 'not_sent' ? 'not_sent' : 'unknown' },
        { cause: err }
      );
    }
    if (answer.status < 200 || answer.status >= 300) throw errorForAnswer(answer);
    return answer;
  };

  const getJson = async (path) => {
    const answer = await send('GET', path);
    const data = parseJson(answer.body);
    if (!isObject(data)) throw unreadable(answer.status);
    return { data, status: answer.status };
  };

  /**
   * The Jira's version and kind. Callable anonymously: the super admin's
   * connection test uses it before any team has a token.
   *
   * @returns {Promise<{ version: string, versionNumbers: number[], deploymentType: 'Cloud' | 'Server' }>}
   */
  const serverInfo = async () => {
    const { data, status } = await getJson('/rest/api/2/serverInfo');
    if (typeof data.version !== 'string' || data.version === '') throw unreadable(status);
    return {
      version: truncate(data.version, TEXT_MAX_LENGTH),
      versionNumbers: Array.isArray(data.versionNumbers)
        ? data.versionNumbers.filter((part) => Number.isSafeInteger(part)).slice(0, 4)
        : [],
      // Only Cloud says so; Data Center and Server answer "Server", and an
      // old Server says nothing.
      deploymentType: data.deploymentType === 'Cloud' ? 'Cloud' : 'Server'
    };
  };

  /**
   * Who the credential belongs to. Data Center names a user by `name`, Cloud
   * by `accountId`; both carry a `displayName`.
   *
   * @returns {Promise<{ displayName: string | null, name: string | null, accountId: string | null, emailAddress: string | null }>}
   */
  const myself = async () => {
    const { data, status } = await getJson('/rest/api/2/myself');
    const identity = {
      displayName: boundedText(data.displayName),
      name: boundedText(data.name),
      accountId: boundedText(data.accountId),
      emailAddress: boundedText(data.emailAddress)
    };
    if (!identity.displayName && !identity.name && !identity.accountId) throw unreadable(status);
    return identity;
  };

  /**
   * The issue types a project accepts for creation, every page of them. Data
   * Center answers `{ values, isLast }`, Cloud `{ issueTypes }`; both carry
   * `startAt` and `total`. The next page starts after the types actually
   * returned, since a server may answer fewer than `maxResults`.
   *
   * @param {string} projectKey
   * @returns {Promise<Array<{ id: string, name: string, subtask: boolean }>>}
   */
  const issueTypes = async (projectKey) => {
    if (!isJiraProjectKey(projectKey)) throw new TypeError('jiraClient.issueTypes: not a project key');
    const types = [];
    const seen = new Set();
    let startAt = 0;
    for (let page = 0; page < ISSUE_TYPE_MAX_PAGES; page += 1) {
      const { data, status } = await getJson(
        `/rest/api/2/issue/createmeta/${projectKey}/issuetypes?startAt=${startAt}&maxResults=${ISSUE_TYPE_PAGE_SIZE}`
      );
      const values = Array.isArray(data.values) ? data.values : Array.isArray(data.issueTypes) ? data.issueTypes : null;
      if (!values) throw unreadable(status);
      if (values.length === 0) break;

      let added = 0;
      for (const entry of values) {
        const type = issueTypeOf(entry);
        if (!type || seen.has(type.id)) continue;
        seen.add(type.id);
        types.push(type);
        added += 1;
      }

      startAt += values.length;
      if (data.isLast === true) break;
      if (typeof data.total === 'number' && startAt >= data.total) break;
      // A server that ignores `startAt` answers its first page again.
      if (added === 0) break;
    }
    return types;
  };

  /**
   * What a sub-task needs to know about its parent: its project (a sub-task is
   * created in the parent's project) and whether it is a sub-task itself,
   * which Jira refuses as a parent. The key is Jira's current one, which
   * differs from the one asked for when the issue was moved.
   *
   * @param {string} key
   * @returns {Promise<{ key: string, projectId: string, projectKey: string, subtask: boolean }>}
   */
  const parentIssue = async (key) => {
    if (!isJiraIssueKey(key)) throw new TypeError('jiraClient.parentIssue: not an issue key');
    const { data, status } = await getJson(`/rest/api/2/issue/${key}?fields=project,issuetype`);
    const project = isObject(data.fields) && isObject(data.fields.project) ? data.fields.project : null;
    const issueType = isObject(data.fields) && isObject(data.fields.issuetype) ? data.fields.issuetype : null;
    const projectId = numericId(project?.id);
    if (!isJiraIssueKey(data.key) || !projectId || !isJiraProjectKey(project?.key)) throw unreadable(status);
    return { key: data.key, projectId, projectKey: project.key, subtask: issueType?.subtask === true };
  };

  /**
   * Creates one issue from Jira's `fields` object, which the caller builds.
   *
   * Sent on a connection of its own, never on a pooled one. Jira's Tomcat
   * closes an idle connection after a while; a pooled one closed at the moment
   * it is reused fails after the body was written, which is read as "sent,
   * answer lost" — and the action is marked "may already be in Jira" for an
   * issue that was never created. The reads keep the pool: a read that fails
   * so is simply not answered.
   *
   * @param {Record<string, unknown>} fields
   * @returns {Promise<{ key: string, id: string | null }>}
   */
  const createIssue = async (fields) => {
    if (!isObject(fields)) throw new TypeError('jiraClient.createIssue: fields must be an object');
    const answer = await send('POST', '/rest/api/2/issue', { fields }, { ownConnection: true });
    const data = parseJson(answer.body);
    if (!isObject(data) || !isJiraIssueKey(data.key)) throw unreadable(answer.status);
    return { key: data.key, id: numericId(data.id) };
  };

  return { serverInfo, myself, issueTypes, parentIssue, createIssue };
};
