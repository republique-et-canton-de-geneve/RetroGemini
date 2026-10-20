/**
 * What a Jira key, a Jira address and a Jira target are, written once for the
 * server and the screens.
 *
 * ## Why this module exists
 *
 * The Jira integration is checked on both sides of the wire: the routes refuse
 * what they must not store or call, and the screens refuse it before a request
 * is sent, so a form never accepts a value the route then answers 400 to. The
 * two sides have different toolchains — the Express routes (ESM JavaScript) and
 * the React screens (TypeScript, bundled by Vite) — so the rules live here, in
 * `utils/` like `passwordPolicy.js` and `emailAddress.js`. `vitest.config.ts`
 * measures `utils/**` on both extensions, so this file sits inside the coverage
 * gate.
 *
 * ## A link is a key, never a URL
 *
 * An action created in Jira carries `jira: { key, createdAt }`, and every
 * screen builds the href itself, from the address the super admin configured
 * and that key (`jiraBrowseUrl`). The URL is never stored. `actions` is not a
 * protected session field (`server/services/sessionGuard.js`): any
 * participant's socket write can put anything on an action, so a stored URL
 * would be a link anyone could plant on the facilitator's screen. A value that
 * matches `JIRA_ISSUE_KEY_PATTERN` cannot point anywhere but the configured
 * Jira — it has no scheme, no host, no slash and no dot.
 *
 * ## One spelling per address
 *
 * `parseJiraBaseUrl` reduces an address to one canonical spelling. That is not
 * cosmetic: the server binds each team's sealed Jira token to the base URL, so
 * `HTTPS://Jira.example.org/` and `https://jira.example.org` must compare equal
 * or a harmless re-save of the console form would make every team re-enter its
 * token. The rules it applies are the ones a token is safe to travel under:
 * https, or plain http on the loopback interface only (a Jira on the same
 * machine — the e2e mock, a developer's instance); no username or password in
 * the address, where a log line or a browser history would keep them; and no
 * query or fragment, because `jiraApiUrl` appends REST paths to the address and
 * a query would end up in the middle of every request.
 */

/**
 * A Jira issue key: a project key, a hyphen, and an issue number that does not
 * start with zero. Jira itself never issues `AB-0` or `AB-01`, so a value
 * shaped like that was not written by Jira and is refused.
 */
export const JIRA_ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-[1-9][0-9]*$/;
export const JIRA_ISSUE_KEY_MAX_LENGTH = 64;

/** A Jira project key: what an issue key starts with. */
export const JIRA_PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]+$/;
export const JIRA_PROJECT_KEY_MAX_LENGTH = 32;

// Jira's issue-type ids are numeric strings (`"10001"`). A *name* ("Task") is
// refused: names are translated per Jira user, ids are not.
const JIRA_ISSUE_TYPE_ID_PATTERN = /^[0-9]{1,18}$/;

/**
 * A Jira label. Jira refuses a label with a space in it and caps one at 255
 * characters; `\S` also refuses a no-break space, which looks like a space and
 * would be refused just the same. The 255 is counted in UTF-16 code units, as
 * Jira's Java strings count it, which is why the pattern has no `u` flag: with
 * one, a label of 255 emoji (510 units) would pass here and fail in Jira.
 */
export const JIRA_LABEL_PATTERN = /^\S{1,255}$/;
export const JIRA_MAX_LABELS = 10;

/** How many actions one `/jira/issues` request may ask to create. */
export const JIRA_MAX_ACTIONS_PER_REQUEST = 10;

/**
 * How long a claim on an action (an issue being created for it) stays
 * authoritative. A younger claim answers "in progress"; an older one means the
 * request that made it died mid-creation, and the action is marked uncertain —
 * never created a second time on a guess.
 */
export const JIRA_CLAIM_TTL_MS = 60_000;

/** The wire codes a refused target is answered with. */
export const INVALID_JIRA_TARGET_ERROR = 'invalid_jira_target';
export const INVALID_JIRA_LABELS_ERROR = 'invalid_jira_labels';

// Longer than any real address by an order of magnitude; refused before the
// URL parser sees it, since the console form is the only legitimate source.
const JIRA_BASE_URL_MAX_LENGTH = 2048;

// Plain http is accepted on these hosts only, spelled as the URL parser
// serialises them (it lower-cases `LOCALHOST` and brackets an IPv6 address).
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * True when `value` is a Jira issue key (`AB-1`), at most 64 characters.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const isJiraIssueKey = (value) =>
  typeof value === 'string'
  && value.length <= JIRA_ISSUE_KEY_MAX_LENGTH
  && JIRA_ISSUE_KEY_PATTERN.test(value);

/**
 * True when `value` is a Jira project key (`AB`), at most 32 characters.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const isJiraProjectKey = (value) =>
  typeof value === 'string'
  && value.length <= JIRA_PROJECT_KEY_MAX_LENGTH
  && JIRA_PROJECT_KEY_PATTERN.test(value);

/**
 * True when `value` is a Jira issue-type id: a string of one to 18 digits. A
 * number is refused rather than coerced, because the id is sent back to Jira as
 * the string it received.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const isJiraIssueTypeId = (value) =>
  typeof value === 'string' && JIRA_ISSUE_TYPE_ID_PATTERN.test(value);

/**
 * The labels to send, or `null` when the list cannot be sent as given.
 *
 * Duplicates are removed (the first occurrence keeps its place) and the limit
 * is counted afterwards, so `['a', 'a']` is one label. Nothing is trimmed or
 * split: a label with a space is refused whole rather than silently turned into
 * something the facilitator did not type, and one bad entry refuses the list,
 * so a target is never stored with a label quietly missing.
 *
 * @param {unknown} value
 * @returns {string[] | null}
 */
export const normalizeJiraLabels = (value) => {
  if (!Array.isArray(value)) return null;
  const labels = [];
  const seen = new Set();
  for (const label of value) {
    if (typeof label !== 'string' || !JIRA_LABEL_PATTERN.test(label)) return null;
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
    if (labels.length > JIRA_MAX_LABELS) return null;
  }
  return labels;
};

/**
 * The canonical form of a Jira base URL, or `null` when it is not one.
 *
 * Accepted: `https:`, or `http:` on `localhost`, `127.0.0.1` or `[::1]`. Refused:
 * a username or password, a query or a fragment (even an empty `?` or `#`), any
 * other scheme. The scheme and host come back lower-cased, the default port is
 * dropped, and the path is kept as typed — a context path such as `/jira` is
 * case-sensitive on the server behind it — minus its trailing slashes. The
 * result never ends with a slash: `https://jira.example.org`,
 * `https://intranet.example.org/jira`.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export const parseJiraBaseUrl = (value) => {
  if (typeof value !== 'string' || value.length > JIRA_BASE_URL_MAX_LENGTH) return null;

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  const plainHttpAllowed = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !plainHttpAllowed) return null;
  if (url.username !== '' || url.password !== '') return null;
  // `search` and `hash` read as '' for a bare `?` or `#`, which `href` keeps.
  // Neither character can appear in a parsed path or host, so finding one in
  // `href` means the address had a query or a fragment.
  if (url.href.includes('?') || url.href.includes('#')) return null;

  // A loop rather than `/\/+$/`: an end-anchored repeated class backtracks
  // quadratically on a long run of slashes.
  const path = url.pathname;
  let end = path.length;
  while (end > 0 && path[end - 1] === '/') end -= 1;

  // `host` carries the port only when it is not the scheme's default.
  return `${url.protocol}//${url.host}${path.slice(0, end)}`;
};

/**
 * A REST URL on the configured Jira: `path` appended to the base URL's path, so
 * a Jira served under a context path keeps it —
 * `jiraApiUrl('https://h/jira', '/rest/api/2/myself')` is
 * `https://h/jira/rest/api/2/myself`. Resolving `path` against the base with
 * `new URL(path, base)` would instead drop `/jira`.
 *
 * Throws a `TypeError` when `baseUrl` is not a Jira base URL or `path` does not
 * start with `/`: this builds the address a team's token is sent to, and a
 * caller bug must fail loudly rather than send it somewhere else.
 *
 * @param {unknown} baseUrl
 * @param {string} path
 * @returns {string}
 */
export const jiraApiUrl = (baseUrl, path) => {
  const base = parseJiraBaseUrl(baseUrl);
  if (!base) throw new TypeError('jiraApiUrl: the base is not a Jira base URL');
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new TypeError('jiraApiUrl: the path must start with "/"');
  }
  return `${base}${path}`;
};

/**
 * The link a screen shows for an issue, or `null` when either half is not
 * trustworthy: the base URL must parse and the key must be a key. A screen that
 * gets `null` shows the key as plain text instead of a link.
 *
 * @param {unknown} baseUrl
 * @param {unknown} key
 * @returns {string | null}
 */
export const jiraBrowseUrl = (baseUrl, key) => {
  const base = parseJiraBaseUrl(baseUrl);
  if (!base || !isJiraIssueKey(key)) return null;
  return `${base}/browse/${key}`;
};

// The `jira` field of an action, when it is an object at all.
const jiraLinkOf = (action) => {
  const jira = action && typeof action === 'object' ? action.jira : undefined;
  return jira && typeof jira === 'object' ? jira : null;
};

/**
 * True when the action carries a Jira issue key. Anything else stored in
 * `jira.key` — a URL, a lowercase key — is not a link, whoever wrote it.
 *
 * @param {unknown} action
 * @returns {boolean}
 */
export const isJiraLinked = (action) => {
  const jira = jiraLinkOf(action);
  return !!jira && isJiraIssueKey(jira.key);
};

/**
 * True when an issue may exist in Jira for this action without the key being
 * known: a creation was sent and its answer was lost (a timeout, a proxy error,
 * a pod killed mid-call). Such an action is never created again automatically;
 * the facilitator checks Jira and confirms. A valid key beside the marker wins,
 * and a marker beside a malformed key still counts — the safe way to be wrong
 * is to ask, not to create a duplicate.
 *
 * @param {unknown} action
 * @returns {boolean}
 */
export const isJiraUncertain = (action) => {
  const jira = jiraLinkOf(action);
  return !!jira && !isJiraIssueKey(jira.key) && typeof jira.uncertainSince === 'string';
};

/**
 * @typedef {object} JiraTargetValue
 * @property {'project' | 'parent'} mode
 * @property {string} [projectKey] Present in `project` mode only.
 * @property {string} [parentKey] Present in `parent` mode only.
 * @property {string} issueTypeId
 * @property {string[]} labels
 */

/**
 * @typedef {{ ok: true, target: JiraTargetValue }
 *   | { ok: false, error: 'invalid_jira_target' | 'invalid_jira_labels' }} JiraTargetValidation
 */

/**
 * The target to store or use, built fresh from what was sent, or the code to
 * refuse it with. Shared by `/jira/target`, `/jira/issues` (its one-time
 * override) and the screens' target form.
 *
 *  - `project` mode creates issues in a project: a project key and an issue
 *    type id are required.
 *  - `parent` mode creates sub-tasks under one issue: a parent issue key and an
 *    issue type id are required. The project is the parent's, read from Jira.
 *
 * Every other field is dropped, including the key the mode does not use, so a
 * stored target never carries a stale half. Missing labels read as none; a bad
 * target is reported before bad labels.
 *
 * @param {unknown} target
 * @returns {JiraTargetValidation}
 */
export const validateJiraTarget = (target) => {
  const refuse = (error) => ({ ok: false, error });
  if (!target || typeof target !== 'object' || Array.isArray(target)) return refuse(INVALID_JIRA_TARGET_ERROR);

  const { mode, projectKey, parentKey, issueTypeId, labels } = /** @type {Record<string, unknown>} */ (target);
  if (!isJiraIssueTypeId(issueTypeId)) return refuse(INVALID_JIRA_TARGET_ERROR);

  let destination;
  if (mode === 'project') {
    if (!isJiraProjectKey(projectKey)) return refuse(INVALID_JIRA_TARGET_ERROR);
    destination = { mode, projectKey };
  } else if (mode === 'parent') {
    if (!isJiraIssueKey(parentKey)) return refuse(INVALID_JIRA_TARGET_ERROR);
    destination = { mode, parentKey };
  } else {
    return refuse(INVALID_JIRA_TARGET_ERROR);
  }

  const normalizedLabels = labels === undefined || labels === null ? [] : normalizeJiraLabels(labels);
  if (!normalizedLabels) return refuse(INVALID_JIRA_LABELS_ERROR);

  return { ok: true, target: { ...destination, issueTypeId, labels: normalizedLabels } };
};
