import express from 'express';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

/**
 * A Jira for tests: the five REST endpoints the integration calls, answered the
 * way Jira Data Center 10 and Jira Cloud answer them (REST API v2), served by a
 * plain Express app on a local port.
 *
 * It exists so the client, the routes and the e2e suite are tested against
 * Jira's *behaviour* rather than against a stub of our own expectations:
 *
 *  - it is mounted under a context path (`/jira` by default), as a Data Center
 *    install behind a shared host is, so a client that resolves REST paths
 *    against the host root fails here as it would in production;
 *  - the issue-type list is paginated into two pages with the sub-task type on
 *    the second only, so a client that reads one page never finds it;
 *  - creating an issue is validated like Jira validates it — project, issue
 *    type valid in that project, sub-task rules, summary length counted as
 *    Java counts it, a description over Data Center's default 32,767
 *    characters, fields that are not on the create screen — and refused with
 *    Jira's `{ errorMessages, errors }` shape;
 *  - every failure the integration must survive is a knob (`setBehaviour`):
 *    a slow, silent or trickling Jira, a rate limit, a revoked token, a
 *    gateway error, and a connection dropped after the issue was created —
 *    every time, or for the N-th create only (a session's parent issue is
 *    create #1 of its send, its first sub-task create #2);
 *  - an issue type may carry Jira Cloud's `hierarchyLevel` (an epic is 1),
 *    passed on in the type list and in an issue read, as Cloud does. The
 *    default projects carry none, as Data Center sends none.
 *
 * Nothing here imports vitest, so the e2e suite can start it too.
 */

export type JiraMockDeployment = 'Server' | 'Cloud';
export type JiraMockEndpoint = 'serverInfo' | 'myself' | 'issueTypes' | 'issue' | 'create';

export interface JiraMockIssueType {
  id: string;
  name: string;
  subtask: boolean;
  /** Jira Cloud's level (−1 sub-task, 0 standard, 1 epic), passed on when set; Data Center sends none. */
  hierarchyLevel?: number;
}
export interface JiraMockProject { id: string; key: string; name: string; issueTypes: JiraMockIssueType[] }

export interface JiraMockAuth {
  /** The personal access token accepted as `Authorization: Bearer <token>` (Data Center). */
  bearer?: string;
  /** The email and API token accepted as `Authorization: Basic` (Cloud). */
  basic?: { email: string; token: string };
}

export interface JiraMockIssue {
  id: string;
  key: string;
  projectId: string;
  projectKey: string;
  issueTypeId: string;
  subtask: boolean;
  summary: string;
  description: string | null;
  labels: string[];
  parentKey: string | null;
  /** The `fields` object exactly as it was sent. */
  fields: Record<string, unknown>;
}

export interface JiraMockRequest {
  method: string;
  /** The path and query as received, context path included. */
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export interface JiraMockBehaviour {
  /** Milliseconds every answer waits before it is sent. */
  delayMs: number;
  /** Never answer: the request is read and its connection left open. */
  hang: boolean;
  /** Send the answer one byte every this many milliseconds (0: all at once). */
  trickleMs: number;
  /** Answer this status instead of doing anything (401, 403, 500, 502, 503…). */
  failStatus: number | null;
  /** The endpoints `delayMs`, `hang`, `trickleMs` and `failStatus` apply to; `null` for all. */
  endpoints: JiraMockEndpoint[] | null;
  /** The N-th create since the last reset (1-based) answers 429 and creates nothing. */
  rateLimitNthCreate: number | null;
  /**
   * The N-th create since the last reset (1-based) is refused with a 400, as a
   * project with a required custom field refuses it, and creates nothing.
   */
  refuseNthCreate: number | null;
  /**
   * The `errors` of that refusal: by default the required custom field
   * (`customfield_10100: 'Team is required.'`), or the fields given here, as
   * a validator refusing one action's own summary answers.
   */
  refuseNthCreateErrors: Record<string, string> | null;
  /** The `Retry-After` value sent with a 429 (`rateLimitNthCreate`, or `failStatus: 429`); `null` sends none. */
  retryAfter: string | null;
  /** A create records the issue, then destroys the connection without answering. */
  dropAfterCreate: boolean;
  /** The N-th create since the last reset (1-based) records the issue, then destroys the connection: that one only. */
  dropAfterNthCreate: number | null;
  /** `serverInfo` answers 302 to this Location. */
  redirectServerInfo: string | null;
  /** A create that sets `labels` is refused, as when the field is not on the create screen. */
  refuseLabels: boolean;
  /** Largest page the issue-type list answers, whatever `maxResults` asks. */
  issueTypesPageSize: number;
}

export interface JiraMockOptions {
  port?: number;
  /** Where Jira is mounted: `/jira` by default, `''` for the host root. */
  contextPath?: string;
  deployment?: JiraMockDeployment;
  auth?: JiraMockAuth;
  projects?: JiraMockProject[];
  version?: string;
}

export interface JiraMock {
  /** The base URL a super admin would configure, context path included, no trailing slash. */
  url: string;
  /** The issues created, oldest first: with a label, under a parent (`null`: with no parent). */
  issues(filter?: { label?: string; parentKey?: string | null }): JiraMockIssue[];
  /** Every request received since the last reset, oldest first. */
  requests(): JiraMockRequest[];
  /**
   * Creates an issue directly, without validation beyond the project and type.
   * `key` gives it a key of another project — an issue moved between projects
   * still answers to the key it had — instead of the project's next one.
   */
  addIssue(issue: { projectKey: string; issueTypeId: string; summary?: string; parentKey?: string; key?: string }): string;
  setBehaviour(partial: Partial<JiraMockBehaviour>): void;
  setAuth(auth: JiraMockAuth): void;
  /** Forgets issues, requests and counters, and restores the default behaviour and auth. */
  reset(): void;
  close(): Promise<void>;
}

export const JIRA_MOCK_PAT = 'jira-mock-personal-access-token';
export const JIRA_MOCK_CLOUD_EMAIL = 'retro-bot@example.org';
export const JIRA_MOCK_CLOUD_TOKEN = 'jira-mock-api-token';

/**
 * Issue-type ids are global in Jira and a project's scheme picks which apply:
 * `10005` is a sub-task type in PROJ only, `10006` in OPS only, so a sub-task
 * sent with the other project's type is refused.
 */
export const defaultJiraMockProjects = (): JiraMockProject[] => [
  {
    id: '10000',
    key: 'PROJ',
    name: 'Project',
    issueTypes: [
      { id: '10001', name: 'Task', subtask: false },
      { id: '10002', name: 'Bug', subtask: false },
      { id: '10003', name: 'Story', subtask: false },
      { id: '10005', name: 'Sub-task', subtask: true }
    ]
  },
  {
    id: '10100',
    key: 'OPS',
    name: 'Operations',
    issueTypes: [
      { id: '10001', name: 'Task', subtask: false },
      { id: '10006', name: 'Technical sub-task', subtask: true }
    ]
  }
];

const defaultBehaviour = (): JiraMockBehaviour => ({
  delayMs: 0,
  hang: false,
  trickleMs: 0,
  failStatus: null,
  endpoints: null,
  rateLimitNthCreate: null,
  refuseNthCreate: null,
  refuseNthCreateErrors: null,
  retryAfter: null,
  dropAfterCreate: false,
  dropAfterNthCreate: null,
  redirectServerInfo: null,
  refuseLabels: false,
  issueTypesPageSize: 3
});

const defaultAuth = (deployment: JiraMockDeployment): JiraMockAuth => (deployment === 'Cloud'
  ? { basic: { email: JIRA_MOCK_CLOUD_EMAIL, token: JIRA_MOCK_CLOUD_TOKEN } }
  : { bearer: JIRA_MOCK_PAT });

// The fields the mock's create screen carries. Anything else is refused the
// way Jira refuses a field that is not on the screen.
const CREATE_SCREEN_FIELDS = new Set(['project', 'issuetype', 'summary', 'description', 'labels', 'parent']);
const notOnScreen = (field: string) => `Field '${field}' cannot be set. It is not on the appropriate screen, or unknown.`;

const errorBody = (errorMessages: string[], errors: Record<string, string> = {}) => ({ errorMessages, errors });

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const startJiraMock = async ({
  port = 0,
  contextPath = '/jira',
  deployment = 'Server',
  auth,
  projects = defaultJiraMockProjects(),
  version
}: JiraMockOptions = {}): Promise<JiraMock> => {
  const mountPath = contextPath.replace(/\/+$/, '');
  let behaviour = defaultBehaviour();
  let acceptedAuth: JiraMockAuth = auth ?? defaultAuth(deployment);
  let issues: JiraMockIssue[] = [];
  let log: JiraMockRequest[] = [];
  let createAttempts = 0;
  let nextIssueId = 10200;
  let issueNumbers = new Map<string, number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let baseUrl = '';

  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };

  const applies = (endpoint: JiraMockEndpoint) => !behaviour.endpoints || behaviour.endpoints.includes(endpoint);

  // Sends one answer, through the delay and trickle knobs. A string payload is
  // sent as HTML, the way a gateway or Jira's own error page answers.
  const answer = (
    res: express.Response,
    endpoint: JiraMockEndpoint,
    status: number,
    payload: unknown,
    headers: Record<string, string> = {}
  ) => {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const contentType = typeof payload === 'string' ? 'text/html;charset=UTF-8' : 'application/json;charset=UTF-8';
    const write = () => {
      if (res.destroyed) return;
      const trickleMs = applies(endpoint) ? behaviour.trickleMs : 0;
      if (trickleMs <= 0) {
        res.status(status).set({ 'Content-Type': contentType, ...headers }).send(text);
        return;
      }
      const bytes = Buffer.from(text);
      res.writeHead(status, { 'Content-Type': contentType, ...headers });
      let index = 0;
      const step = () => {
        if (res.destroyed) return;
        if (index >= bytes.length) {
          res.end();
          return;
        }
        res.write(bytes.subarray(index, index + 1));
        index += 1;
        later(step, trickleMs);
      };
      step();
    };
    const delayMs = applies(endpoint) ? behaviour.delayMs : 0;
    if (delayMs > 0) later(write, delayMs);
    else write();
  };

  const failurePayload = (status: number): unknown => {
    if (status === 401) return errorBody(['You are not authenticated. Authentication required to perform this operation.']);
    if (status === 403) return errorBody(['You do not have the permission to perform this operation.']);
    if (status === 500) return errorBody(['Internal server error']);
    // A gateway in front of Jira answers with a page, not JSON.
    return `<html><body><h1>${status}</h1><p>The service is unavailable.</p></body></html>`;
  };

  // Applies the hang and failStatus knobs; true when the request is handled.
  const intercepted = (endpoint: JiraMockEndpoint, res: express.Response) => {
    if (!applies(endpoint)) return false;
    if (behaviour.hang) return true;
    if (behaviour.failStatus !== null) {
      const headers: Record<string, string> = behaviour.failStatus === 429 && behaviour.retryAfter !== null
        ? { 'Retry-After': behaviour.retryAfter }
        : {};
      answer(res, endpoint, behaviour.failStatus, failurePayload(behaviour.failStatus), headers);
      return true;
    }
    return false;
  };

  const credentialState = (req: express.Request): 'anonymous' | 'valid' | 'invalid' => {
    const header = req.headers.authorization;
    if (!header) return 'anonymous';
    if (acceptedAuth.bearer && header === `Bearer ${acceptedAuth.bearer}`) return 'valid';
    if (acceptedAuth.basic) {
      const encoded = Buffer.from(`${acceptedAuth.basic.email}:${acceptedAuth.basic.token}`).toString('base64');
      if (header === `Basic ${encoded}`) return 'valid';
    }
    return 'invalid';
  };

  // Jira answers 401 to a wrong credential on *every* resource, anonymous ones
  // included; Data Center says why in a header. True when the request is handled.
  const refusedCredential = (req: express.Request, res: express.Response, endpoint: JiraMockEndpoint, anonymousAllowed: boolean) => {
    const state = credentialState(req);
    if (state === 'valid' || (state === 'anonymous' && anonymousAllowed)) return false;
    if (deployment === 'Cloud') {
      answer(res, endpoint, 401, 'Client must be authenticated to access this resource.');
    } else {
      const headers: Record<string, string> = state === 'invalid' ? { 'X-Seraph-LoginReason': 'AUTHENTICATED_FAILED' } : {};
      answer(res, endpoint, 401, failurePayload(401), headers);
    }
    return true;
  };

  const findProject = (idOrKey: unknown) => projects.find((project) => project.key === idOrKey || project.id === idOrKey);
  const findIssue = (idOrKey: unknown) => issues.find((issue) => issue.key === idOrKey || issue.id === idOrKey);

  const issueTypeJson = (type: JiraMockIssueType) => ({
    self: `${baseUrl}/rest/api/2/issuetype/${type.id}`,
    id: type.id,
    description: '',
    iconUrl: `${baseUrl}/images/icons/issuetypes/${type.subtask ? 'subtask' : 'task'}.svg`,
    name: type.name,
    subtask: type.subtask,
    ...(type.hierarchyLevel === undefined ? {} : { hierarchyLevel: type.hierarchyLevel })
  });

  const nextKey = (project: JiraMockProject) => {
    const number = (issueNumbers.get(project.key) ?? 0) + 1;
    issueNumbers.set(project.key, number);
    return `${project.key}-${number}`;
  };

  const recordIssue = (
    project: JiraMockProject,
    type: JiraMockIssueType,
    fields: Record<string, unknown>,
    parentKey: string | null,
    key: string = nextKey(project)
  ) => {
    const issue: JiraMockIssue = {
      id: String(nextIssueId++),
      key,
      projectId: project.id,
      projectKey: project.key,
      issueTypeId: type.id,
      subtask: type.subtask,
      summary: typeof fields.summary === 'string' ? fields.summary : '',
      description: typeof fields.description === 'string' ? fields.description : null,
      labels: Array.isArray(fields.labels) ? [...(fields.labels as string[])] : [],
      parentKey,
      fields: JSON.parse(JSON.stringify(fields))
    };
    issues.push(issue);
    return issue;
  };

  const router = express.Router();

  router.get('/rest/api/2/serverInfo', (req, res) => {
    if (behaviour.redirectServerInfo) {
      res.redirect(302, behaviour.redirectServerInfo);
      return;
    }
    if (intercepted('serverInfo', res) || refusedCredential(req, res, 'serverInfo', true)) return;
    const cloud = deployment === 'Cloud';
    const versionText = version ?? (cloud ? '1001.0.0-SNAPSHOT' : '10.3.1');
    answer(res, 'serverInfo', 200, {
      baseUrl,
      version: versionText,
      versionNumbers: versionText.split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10)),
      deploymentType: cloud ? 'Cloud' : 'Server',
      buildNumber: cloud ? 100261 : 10030001,
      buildDate: '2026-09-01T00:00:00.000+0000',
      serverTime: new Date().toISOString(),
      scmInfo: 'mock',
      serverTitle: 'Jira (mock)'
    });
  });

  router.get('/rest/api/2/myself', (req, res) => {
    if (intercepted('myself', res) || refusedCredential(req, res, 'myself', false)) return;
    const identity = deployment === 'Cloud'
      ? { accountId: '5b10ac8d82e05b22cc7d4ef5', emailAddress: acceptedAuth.basic?.email ?? JIRA_MOCK_CLOUD_EMAIL }
      : { key: 'JIRAUSER10100', name: 'retro-bot', emailAddress: 'retro-bot@example.org' };
    answer(res, 'myself', 200, {
      self: `${baseUrl}/rest/api/2/user`,
      ...identity,
      displayName: 'Retro Bot',
      active: true,
      timeZone: 'Europe/Zurich',
      locale: 'en_US'
    });
  });

  router.get('/rest/api/2/issue/createmeta/:project/issuetypes', (req, res) => {
    if (intercepted('issueTypes', res) || refusedCredential(req, res, 'issueTypes', false)) return;
    const project = findProject(req.params.project);
    if (!project) {
      answer(res, 'issueTypes', 404, errorBody([`No project could be found with key '${req.params.project}'.`]));
      return;
    }
    const startAt = Math.max(0, Number.parseInt(String(req.query.startAt ?? '0'), 10) || 0);
    const requested = Number.parseInt(String(req.query.maxResults ?? '50'), 10) || 50;
    const pageSize = Math.max(1, Math.min(requested, behaviour.issueTypesPageSize));
    const total = project.issueTypes.length;
    const page = project.issueTypes.slice(startAt, startAt + pageSize).map(issueTypeJson);
    if (deployment === 'Cloud') {
      answer(res, 'issueTypes', 200, { issueTypes: page, maxResults: pageSize, startAt, total });
    } else {
      answer(res, 'issueTypes', 200, {
        maxResults: pageSize,
        startAt,
        total,
        isLast: startAt + page.length >= total,
        values: page
      });
    }
  });

  router.get('/rest/api/2/issue/:key', (req, res) => {
    if (intercepted('issue', res) || refusedCredential(req, res, 'issue', false)) return;
    const issue = findIssue(req.params.key);
    if (!issue) {
      answer(res, 'issue', 404, errorBody(['Issue Does Not Exist']));
      return;
    }
    const project = findProject(issue.projectKey) as JiraMockProject;
    const type = project.issueTypes.find((candidate) => candidate.id === issue.issueTypeId) as JiraMockIssueType;
    const allFields: Record<string, unknown> = {
      project: { self: `${baseUrl}/rest/api/2/project/${project.id}`, id: project.id, key: project.key, name: project.name },
      issuetype: issueTypeJson(type),
      summary: issue.summary,
      description: issue.description,
      labels: issue.labels,
      ...(issue.parentKey ? { parent: { key: issue.parentKey } } : {})
    };
    const wanted = typeof req.query.fields === 'string' ? req.query.fields.split(',').map((name) => name.trim()) : null;
    const fields = wanted
      ? Object.fromEntries(Object.entries(allFields).filter(([name]) => wanted.includes(name)))
      : allFields;
    answer(res, 'issue', 200, {
      expand: 'renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations',
      id: issue.id,
      self: `${baseUrl}/rest/api/2/issue/${issue.id}`,
      key: issue.key,
      fields
    });
  });

  router.post('/rest/api/2/issue', (req, res) => {
    if (intercepted('create', res) || refusedCredential(req, res, 'create', false)) return;
    if (!req.is('application/json')) {
      answer(res, 'create', 415, 'Unsupported Media Type');
      return;
    }

    createAttempts += 1;
    if (behaviour.rateLimitNthCreate !== null && createAttempts === behaviour.rateLimitNthCreate) {
      const headers: Record<string, string> = behaviour.retryAfter !== null ? { 'Retry-After': behaviour.retryAfter } : {};
      answer(res, 'create', 429, errorBody(['Rate limit exceeded.']), headers);
      return;
    }
    if (behaviour.refuseNthCreate !== null && createAttempts === behaviour.refuseNthCreate) {
      // A required custom field the integration never sets: Jira names it by id.
      answer(res, 'create', 400, errorBody([], behaviour.refuseNthCreateErrors ?? { customfield_10100: 'Team is required.' }));
      return;
    }

    const fields = isObject(req.body) ? req.body.fields : undefined;
    if (!isObject(fields)) {
      answer(res, 'create', 400, errorBody(['No fields were given.']));
      return;
    }

    // Keyed by field names the request chose, so a Map: written as properties
    // of a plain object, a field named "__proto__" set its prototype instead and
    // the refusal Jira gives was silently lost.
    const errors = new Map<string, string>();
    for (const name of Object.keys(fields)) {
      if (!CREATE_SCREEN_FIELDS.has(name)) errors.set(name, notOnScreen(name));
    }

    const projectRef = isObject(fields.project) ? (fields.project.key ?? fields.project.id) : undefined;
    const project = projectRef === undefined ? undefined : findProject(projectRef);
    if (projectRef === undefined) errors.set('project', 'project is required');
    else if (!project) errors.set('project', 'Specify a valid project ID or key');

    const typeRef = isObject(fields.issuetype) ? (fields.issuetype.id ?? fields.issuetype.name) : undefined;
    const type = project?.issueTypes.find((candidate) => candidate.id === typeRef || candidate.name === typeRef);
    if (typeRef === undefined) errors.set('issuetype', 'issue type is required');
    else if (project && !type) errors.set('issuetype', 'The issue type selected is invalid.');

    const parentRef = isObject(fields.parent) ? (fields.parent.key ?? fields.parent.id) : undefined;
    const parent = parentRef === undefined ? undefined : findIssue(parentRef);
    if (type?.subtask && parentRef === undefined) {
      errors.set('issuetype', 'Issue type is a sub-task but parent issue key or id not specified.');
    } else if (type && !type.subtask && parentRef !== undefined) {
      errors.set('issuetype', 'The issue type selected is not a sub-task type, so the issue cannot have a parent.');
    } else if (parentRef !== undefined && !parent) {
      errors.set('parent', 'Could not find issue by id or key.');
    } else if (parent?.subtask) {
      errors.set('parent', 'A sub-task cannot be the parent of another sub-task.');
    } else if (parent && project && parent.projectKey !== project.key) {
      errors.set('project', 'A sub-task must be created in the project of its parent issue.');
    }

    const { summary } = fields;
    if (typeof summary !== 'string' || summary.trim() === '') {
      errors.set('summary', 'You must specify a summary of the issue.');
    } else if (/[\r\n]/.test(summary)) {
      errors.set('summary', 'The summary is invalid because it contains newline characters.');
    } else if (summary.length > 255) {
      // `length` counts UTF-16 units, as Java's String.length() does.
      errors.set('summary', 'Summary must be less than 255 characters.');
    }

    if (fields.description !== undefined && fields.description !== null && typeof fields.description !== 'string') {
      errors.set('description', 'Operation value must be a string');
    } else if (typeof fields.description === 'string' && fields.description.length > 32767) {
      // Data Center's default `jira.text.field.character.limit`. A literal on
      // purpose, never the builder's constant: a wrong constant must not hide
      // behind the mock that tests it.
      errors.set('description', 'The entered text is too long. It exceeds the allowed limit of 32,767 characters.');
    }

    if (fields.labels !== undefined) {
      if (behaviour.refuseLabels) {
        errors.set('labels', notOnScreen('labels'));
      } else if (!Array.isArray(fields.labels) || fields.labels.some((label) => typeof label !== 'string')) {
        errors.set('labels', 'data was not an array');
      } else {
        const spaced = (fields.labels as string[]).find((label) => /\s/.test(label));
        const long = (fields.labels as string[]).find((label) => label.length > 255);
        if (spaced !== undefined) errors.set('labels', `The label '${spaced}' contains spaces which is invalid.`);
        else if (long !== undefined) errors.set('labels', 'The label exceeds the maximum length for a single label of 255 characters.');
      }
    }

    if (errors.size > 0) {
      answer(res, 'create', 400, errorBody([], Object.fromEntries(errors)));
      return;
    }

    const issue = recordIssue(project as JiraMockProject, type as JiraMockIssueType, fields, parent ? parent.key : null);
    if (behaviour.dropAfterCreate || behaviour.dropAfterNthCreate === createAttempts) {
      // Jira created the issue; the answer never reaches the caller.
      req.socket.destroy();
      return;
    }
    answer(res, 'create', 201, { id: issue.id, key: issue.key, self: `${baseUrl}/rest/api/2/issue/${issue.id}` });
  });

  // Every open connection, and those with an answer still owed. Only the
  // latter are cut on reset: an idle keep-alive connection sits in the
  // client's pool, and destroying it would hand the next test a dead socket.
  const sockets = new Set<Socket>();
  const busySockets = new Set<Socket>();

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const entry: JiraMockRequest = { method: req.method, path: req.originalUrl, headers: { ...req.headers }, body: undefined };
    log.push(entry);
    res.locals.logEntry = entry;
    const { socket } = req;
    busySockets.add(socket);
    res.on('close', () => busySockets.delete(socket));
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    (res.locals.logEntry as JiraMockRequest).body = req.body;
    next();
  });
  app.use(mountPath || '/', router);
  // A body that is not JSON: Jira answers 400 with the parser's complaint.
  // Anything else is a bug in this mock, answered as Jira's own 500.
  app.use((err: { type?: string; message?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json(errorBody([`Unexpected character in the request body: ${err.message}`]));
      return;
    }
    res.status(500).json(errorBody([`jiraMock: ${err?.message ?? 'internal error'}`]));
  });

  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(port, '127.0.0.1', () => resolve(listening));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${mountPath}`;

  const clearTimers = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };

  return {
    url: baseUrl,
    issues: ({ label, parentKey } = {}) => issues
      .filter((issue) => label === undefined || issue.labels.includes(label))
      .filter((issue) => parentKey === undefined || issue.parentKey === parentKey)
      .map((issue) => ({ ...issue, labels: [...issue.labels], fields: JSON.parse(JSON.stringify(issue.fields)) })),
    requests: () => log.map((entry) => ({ ...entry })),
    addIssue: ({ projectKey, issueTypeId, summary = 'Seeded issue', parentKey, key }) => {
      const project = findProject(projectKey);
      const type = project?.issueTypes.find((candidate) => candidate.id === issueTypeId);
      if (!project || !type) throw new Error(`jiraMock.addIssue: unknown project ${projectKey} or type ${issueTypeId}`);
      if (key !== undefined && findIssue(key)) throw new Error(`jiraMock.addIssue: ${key} already exists`);
      return recordIssue(project, type, { summary }, parentKey ?? null, key).key;
    },
    setBehaviour: (partial) => {
      behaviour = { ...behaviour, ...partial };
    },
    setAuth: (next) => {
      acceptedAuth = next;
    },
    reset: () => {
      clearTimers();
      // A hanging or trickling answer from the previous test must not reach the next one.
      for (const socket of busySockets) socket.destroy();
      behaviour = defaultBehaviour();
      acceptedAuth = auth ?? defaultAuth(deployment);
      issues = [];
      log = [];
      createAttempts = 0;
      nextIssueId = 10200;
      issueNumbers = new Map();
    },
    close: async () => {
      clearTimers();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
};
