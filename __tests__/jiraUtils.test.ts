import { describe, expect, it } from 'vitest';
import type { JiraLink, JiraTarget } from '../types';
import {
  JIRA_CLAIM_TTL_MS,
  JIRA_ISSUE_KEY_PATTERN,
  JIRA_LABEL_PATTERN,
  JIRA_MAX_ACTIONS_PER_REQUEST,
  JIRA_MAX_LABELS,
  JIRA_PROJECT_KEY_PATTERN,
  INVALID_JIRA_LABELS_ERROR,
  INVALID_JIRA_TARGET_ERROR,
  isJiraIssueKey,
  isJiraIssueTypeId,
  isJiraLinked,
  isJiraParentScope,
  isJiraProjectKey,
  isJiraUncertain,
  jiraApiUrl,
  jiraBrowseUrl,
  jiraProjectKeyOf,
  normalizeJiraLabels,
  parseJiraBaseUrl,
  validateJiraTarget
} from '../utils/jira.js';

/**
 * The shared Jira rules (`utils/jira.js`), imported by the routes and the
 * screens alike.
 *
 * A Jira link on an action is a *key*, never a URL: `actions` is not a
 * protected session field, so any participant's socket write can put anything
 * on an action, and a stored URL would be a link anyone can plant. These cases
 * pin what a key is, what the configured address is once canonical, and that
 * every href is built from that address and a key — nothing else.
 */

const repeat = (character: string, count: number) => character.repeat(count);

// Assembled rather than written as a literal, following `publicOriginLinks.test.ts`:
// ESLint's `no-script-url` rejects a literal `javascript:` URL.
const SCRIPT_URL = ['javascript', 'alert(1)'].join(':');

describe('constants', () => {
  it('pins the limits the routes and the screens share', () => {
    expect(JIRA_MAX_LABELS).toBe(10);
    expect(JIRA_MAX_ACTIONS_PER_REQUEST).toBe(10);
    expect(JIRA_CLAIM_TTL_MS).toBe(60_000);
    expect(INVALID_JIRA_TARGET_ERROR).toBe('invalid_jira_target');
    expect(INVALID_JIRA_LABELS_ERROR).toBe('invalid_jira_labels');
  });

  it('exports the patterns with the shapes of the contract', () => {
    expect(JIRA_ISSUE_KEY_PATTERN.source).toBe('^[A-Z][A-Z0-9_]+-[1-9][0-9]*$');
    expect(JIRA_PROJECT_KEY_PATTERN.source).toBe('^[A-Z][A-Z0-9_]+$');
    expect(JIRA_LABEL_PATTERN.source).toBe('^\\S{1,255}$');
  });

  it('exports the patterns with no flags', () => {
    // `.source` leaves the flags out, and each one changes what is accepted:
    // `m` lets `^`/`$` match at a newline inside the value, `u` counts a
    // label's 255 in code points rather than the code units Jira counts, and
    // `g` makes `.test()` stateful through `lastIndex`.
    expect(JIRA_ISSUE_KEY_PATTERN.flags).toBe('');
    expect(JIRA_PROJECT_KEY_PATTERN.flags).toBe('');
    expect(JIRA_LABEL_PATTERN.flags).toBe('');
  });
});

describe('isJiraIssueKey', () => {
  it.each([
    'AB-1',
    'A1_B-10',
    'PROJ-123456',
    'AB-9',
    // 64 characters exactly: the longest key accepted.
    `A${repeat('B', 61)}-1`
  ])('accepts %s', (key) => {
    expect(isJiraIssueKey(key)).toBe(true);
  });

  it.each([
    ['lowercase', 'ab-1'],
    ['a mixed-case project', 'Ab-1'],
    ['a zero issue number', 'AB-0'],
    ['a leading zero', 'AB-01'],
    ['a path after the key', 'AB-1/../x'],
    ['a query after the key', 'AB-1?x'],
    ['a fragment after the key', 'AB-1#x'],
    ['a trailing newline', 'AB-1\n'],
    ['surrounding spaces', ' AB-1 '],
    ['a one-letter project', 'A-1'],
    ['a project starting with a digit', '1AB-1'],
    ['no number', 'AB-'],
    ['no project', '-1'],
    ['the empty string', ''],
    ['65 characters', `A${repeat('B', 62)}-1`]
  ])('refuses %s', (_label, key) => {
    expect(isJiraIssueKey(key)).toBe(false);
  });

  it.each([undefined, null, 1, {}, ['AB-1'], true])('refuses the non-string %s', (value) => {
    expect(isJiraIssueKey(value)).toBe(false);
  });
});

describe('isJiraProjectKey', () => {
  it.each(['AB', 'PROJ', 'A1_B', `A${repeat('B', 31)}`])('accepts %s', (key) => {
    expect(isJiraProjectKey(key)).toBe(true);
  });

  it.each([
    ['lowercase', 'proj'],
    ['one letter', 'A'],
    ['a leading digit', '1AB'],
    ['an issue key', 'AB-1'],
    ['a space', 'A B'],
    ['a newline', 'AB\nCD'],
    ['the empty string', ''],
    ['33 characters', `A${repeat('B', 32)}`]
  ])('refuses %s', (_label, key) => {
    expect(isJiraProjectKey(key)).toBe(false);
  });

  it.each([undefined, null, 12, {}])('refuses the non-string %s', (value) => {
    expect(isJiraProjectKey(value)).toBe(false);
  });
});

describe('isJiraIssueTypeId', () => {
  it.each(['1', '10001', repeat('9', 18)])('accepts %s', (id) => {
    expect(isJiraIssueTypeId(id)).toBe(true);
  });

  it.each([
    ['the empty string', ''],
    ['a letter', '1a'],
    ['a negative number', '-1'],
    ['a decimal', '1.5'],
    ['a space', ' 1'],
    // The pattern is not exported, so only a value can pin its flags.
    ['a newline', '1\n2'],
    ['19 digits', repeat('9', 19)],
    ['a name instead of an id', 'Task']
  ])('refuses %s', (_label, id) => {
    expect(isJiraIssueTypeId(id)).toBe(false);
  });

  it.each([10001, undefined, null, {}])('refuses the non-string %s', (value) => {
    expect(isJiraIssueTypeId(value)).toBe(false);
  });
});

describe('normalizeJiraLabels', () => {
  it('accepts an empty array', () => {
    expect(normalizeJiraLabels([])).toEqual([]);
  });

  it('keeps valid labels in order', () => {
    expect(normalizeJiraLabels(['retro', 'team-a', 'été'])).toEqual(['retro', 'team-a', 'été']);
  });

  it('removes duplicates, keeping the first occurrence', () => {
    expect(normalizeJiraLabels(['retro', 'b', 'retro', 'b'])).toEqual(['retro', 'b']);
  });

  it('counts the limit after removing duplicates', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `l${i}`);
    expect(normalizeJiraLabels([...ten, 'l0'])).toEqual(ten);
  });

  it('accepts 10 labels and refuses 11', () => {
    const labels = Array.from({ length: 11 }, (_, i) => `l${i}`);
    expect(normalizeJiraLabels(labels.slice(0, 10))).toHaveLength(10);
    expect(normalizeJiraLabels(labels)).toBeNull();
  });

  it('accepts a 255-character label and refuses a 256-character one', () => {
    expect(normalizeJiraLabels([repeat('a', 255)])).toEqual([repeat('a', 255)]);
    expect(normalizeJiraLabels([repeat('a', 256)])).toBeNull();
  });

  it('counts the 255 in UTF-16 code units, as Jira does', () => {
    // Two code units per emoji: 127 make 254 and fit, 128 make 256 and do not,
    // although both are far below 255 code points.
    expect(normalizeJiraLabels([repeat('\u{1F600}', 127)])).toEqual([repeat('\u{1F600}', 127)]);
    expect(normalizeJiraLabels([repeat('\u{1F600}', 128)])).toBeNull();
  });

  it.each([
    ['a space inside', ['two words']],
    ['a leading space', [' retro']],
    ['a tab', ['re\ttro']],
    ['a newline', ['re\ntro']],
    ['a no-break space', ['re\u00a0tro']],
    ['the empty string', ['']],
    ['a non-string entry', ['retro', 3]],
    ['a null entry', [null]]
  ])('refuses the whole list for %s', (_label, labels) => {
    expect(normalizeJiraLabels(labels)).toBeNull();
  });

  it.each([undefined, null, 'retro', {}, 3])('refuses the non-array %s', (value) => {
    expect(normalizeJiraLabels(value)).toBeNull();
  });
});

describe('parseJiraBaseUrl', () => {
  it.each([
    ['an https root', 'https://jira.example.org', 'https://jira.example.org'],
    ['an https root with a slash', 'https://jira.example.org/', 'https://jira.example.org'],
    ['a context path', 'https://intranet.example.org/jira', 'https://intranet.example.org/jira'],
    ['trailing slashes', 'https://intranet.example.org/jira///', 'https://intranet.example.org/jira'],
    ['an upper-case scheme and host, path case kept', 'HTTPS://JIRA.Example.ORG/Jira', 'https://jira.example.org/Jira'],
    ['the default https port', 'https://jira.example.org:443/jira', 'https://jira.example.org/jira'],
    ['a non-default port', 'https://jira.example.org:8443/jira/', 'https://jira.example.org:8443/jira'],
    // The URL parser strips ASCII spaces itself, so this case alone would pass
    // without the trim; the pasted one below is what needs it.
    ['surrounding whitespace', '  https://jira.example.org/  ', 'https://jira.example.org'],
    // A BOM the parser refuses and a no-break space it would percent-encode
    // into the path (`/%C2%A0`): a second spelling of the same address.
    ['a pasted BOM and no-break space', '\ufeffhttps://jira.example.org/\u00a0', 'https://jira.example.org'],
    // A local Jira with a self-signed certificate (`allowSelfSignedCerts`).
    ['https on localhost', 'https://localhost:8443/jira/', 'https://localhost:8443/jira'],
    ['http on localhost', 'http://localhost:8080/jira', 'http://localhost:8080/jira'],
    ['http on localhost, default port', 'http://LOCALHOST:80/', 'http://localhost'],
    ['http on 127.0.0.1', 'http://127.0.0.1:2990/jira', 'http://127.0.0.1:2990/jira'],
    ['http on [::1]', 'http://[::1]:2990/', 'http://[::1]:2990'],
    ['a nested context path', 'https://h.example.org/tools/jira/', 'https://h.example.org/tools/jira']
  ])('canonicalises %s', (_label, input, expected) => {
    expect(parseJiraBaseUrl(input)).toBe(expected);
  });

  it.each([
    ['http on a public host', 'http://jira.example.org'],
    ['http on another loopback spelling', 'http://localhost.example.org'],
    ['http on a host that only ends in localhost', 'http://notlocalhost:8080'],
    // Loopback too, but not one of the three addresses the contract names.
    ['http on another loopback address', 'http://127.0.0.2'],
    // Loopback relaxes the scheme to http, never to anything else.
    ['another scheme on loopback', 'ftp://localhost/jira'],
    ['ws on loopback', 'ws://127.0.0.1:2990'],
    ['a username', 'https://admin@jira.example.org'],
    ['a username and password', 'https://admin:secret@jira.example.org/jira'],
    // Accepted, it would come back without the password, which would be
    // dropped silently.
    ['a password with no username', 'https://:secret@jira.example.org/jira'],
    ['a query', 'https://jira.example.org/jira?x=1'],
    ['an empty query', 'https://jira.example.org/jira?'],
    ['a fragment', 'https://jira.example.org/jira#top'],
    ['an empty fragment', 'https://jira.example.org/#'],
    ['a script URL', SCRIPT_URL],
    ['ftp:', 'ftp://jira.example.org'],
    ['a data: URL', 'data:text/html,hi'],
    ['no scheme', 'jira.example.org'],
    ['garbage', 'not a url'],
    ['the empty string', ''],
    ['an over-long value', `https://jira.example.org/${repeat('a', 2100)}`]
  ])('refuses %s', (_label, input) => {
    expect(parseJiraBaseUrl(input)).toBeNull();
  });

  it.each([undefined, null, 42, {}, ['https://jira.example.org']])('refuses the non-string %s', (value) => {
    expect(parseJiraBaseUrl(value)).toBeNull();
  });

  it('is idempotent', () => {
    const once = parseJiraBaseUrl('HTTPS://Jira.Example.org:443/Jira/');
    expect(parseJiraBaseUrl(once)).toBe(once);
  });
});

describe('jiraApiUrl', () => {
  it('appends to a root address', () => {
    expect(jiraApiUrl('https://jira.example.org', '/rest/api/2/myself'))
      .toBe('https://jira.example.org/rest/api/2/myself');
  });

  it('appends to the context path rather than replacing it', () => {
    expect(jiraApiUrl('https://h.example.org/jira', '/rest/api/2/myself'))
      .toBe('https://h.example.org/jira/rest/api/2/myself');
  });

  it('keeps a query the caller put in the path', () => {
    expect(jiraApiUrl('https://h.example.org/jira', '/rest/api/2/issue/AB-1?fields=project,issuetype'))
      .toBe('https://h.example.org/jira/rest/api/2/issue/AB-1?fields=project,issuetype');
  });

  it('canonicalises the base it is given', () => {
    expect(jiraApiUrl('HTTPS://H.example.org/jira/', '/rest/api/2/serverInfo'))
      .toBe('https://h.example.org/jira/rest/api/2/serverInfo');
  });

  it('throws on an address that is not a Jira base URL', () => {
    expect(() => jiraApiUrl('http://jira.example.org', '/rest/api/2/myself')).toThrow(TypeError);
    expect(() => jiraApiUrl(undefined, '/rest/api/2/myself')).toThrow(TypeError);
  });

  it('throws on a path that does not start with a slash', () => {
    // Concatenated as-is, `evil.example.org/x` would move the request to
    // another host when the base is a bare origin.
    expect(() => jiraApiUrl('https://jira.example.org', '.evil.example.org/x')).toThrow(/must start with/);
    // Asserted by message: `(3).startsWith` throws a TypeError of its own,
    // which would pass a bare `toThrow(TypeError)` without the guard.
    expect(() => jiraApiUrl('https://jira.example.org', 3 as unknown as string)).toThrow(/must start with/);
  });

  it('refuses a non-string path even when it claims to start with a slash', () => {
    const impostor = { startsWith: () => true, toString: () => '.evil.example.org/x' };
    expect(() => jiraApiUrl('https://jira.example.org', impostor as unknown as string)).toThrow(/must start with/);
  });
});

describe('jiraBrowseUrl', () => {
  it('builds the browse link with and without a context path', () => {
    expect(jiraBrowseUrl('https://jira.example.org', 'AB-1')).toBe('https://jira.example.org/browse/AB-1');
    expect(jiraBrowseUrl('https://h.example.org/jira/', 'AB-12')).toBe('https://h.example.org/jira/browse/AB-12');
  });

  it.each([
    ['a lowercase key', 'https://jira.example.org', 'ab-1'],
    ['a key that walks the path', 'https://jira.example.org', 'AB-1/../../admin'],
    ['a URL in place of a key', 'https://jira.example.org', 'https://evil.example.org'],
    ['no key', 'https://jira.example.org', undefined],
    ['no base', undefined, 'AB-1'],
    ['an empty base', '', 'AB-1'],
    ['a base Jira would not be reached at', SCRIPT_URL, 'AB-1'],
    ['a plain-http base', 'http://jira.example.org', 'AB-1']
  ])('answers null for %s', (_label, base, key) => {
    expect(jiraBrowseUrl(base, key)).toBeNull();
  });
});

describe('isJiraLinked and isJiraUncertain', () => {
  const linked = { jira: { key: 'AB-1', createdAt: '2026-10-20T10:00:00.000Z' } };
  const uncertain = { jira: { uncertainSince: '2026-10-20T10:00:00.000Z' } };

  it('reads a stored key as linked', () => {
    expect(isJiraLinked(linked)).toBe(true);
    expect(isJiraUncertain(linked)).toBe(false);
  });

  it('reads an uncertain marker as uncertain, not linked', () => {
    expect(isJiraLinked(uncertain)).toBe(false);
    expect(isJiraUncertain(uncertain)).toBe(true);
  });

  it('never reads a planted value as a link', () => {
    expect(isJiraLinked({ jira: { key: 'https://evil.example.org' } })).toBe(false);
    expect(isJiraLinked({ jira: { key: 'ab-1' } })).toBe(false);
    expect(isJiraLinked({ jira: 'AB-1' })).toBe(false);
    expect(isJiraLinked({ jira: null })).toBe(false);
  });

  it('a valid key wins over an uncertain marker beside it', () => {
    const both = { jira: { key: 'AB-1', createdAt: 'x', uncertainSince: 'y' } };
    expect(isJiraLinked(both)).toBe(true);
    expect(isJiraUncertain(both)).toBe(false);
  });

  it('a marker beside an invalid key stays uncertain, so nothing is re-created silently', () => {
    expect(isJiraUncertain({ jira: { key: 'nope', uncertainSince: '2026-10-20' } })).toBe(true);
  });

  it.each([
    ['no action', undefined],
    ['null', null],
    ['an action without a link', { id: 'a1' }],
    ['a non-string marker', { jira: { uncertainSince: 12 } }],
    ['an empty link', { jira: {} }]
  ])('reads %s as neither', (_label, action) => {
    expect(isJiraLinked(action)).toBe(false);
    expect(isJiraUncertain(action)).toBe(false);
  });
});

describe('validateJiraTarget', () => {
  it('accepts a project target and normalises its labels', () => {
    expect(validateJiraTarget({
      mode: 'project', projectKey: 'PROJ', issueTypeId: '10001', labels: ['retro', 'retro', 'team']
    })).toEqual({
      ok: true,
      target: { mode: 'project', projectKey: 'PROJ', issueTypeId: '10001', labels: ['retro', 'team'] }
    });
  });

  it('accepts a parent target', () => {
    expect(validateJiraTarget({ mode: 'parent', parentKey: 'PROJ-12', issueTypeId: '10003', labels: [] }))
      .toEqual({ ok: true, target: { mode: 'parent', parentKey: 'PROJ-12', issueTypeId: '10003', labels: [] } });
  });

  it('reads missing labels as none', () => {
    expect(validateJiraTarget({ mode: 'project', projectKey: 'PROJ', issueTypeId: '1' }))
      .toEqual({ ok: true, target: { mode: 'project', projectKey: 'PROJ', issueTypeId: '1', labels: [] } });
    expect(validateJiraTarget({ mode: 'project', projectKey: 'PROJ', issueTypeId: '1', labels: null }))
      .toEqual({ ok: true, target: { mode: 'project', projectKey: 'PROJ', issueTypeId: '1', labels: [] } });
  });

  it('drops every field the mode does not use', () => {
    // Parsed from JSON, as a request body is, so `__proto__` is an own key.
    const result = validateJiraTarget(JSON.parse(
      '{"mode":"project","projectKey":"PROJ","parentKey":"OTHER-1","issueTypeId":"1","labels":[],'
      + '"summary":"injected","__proto__":{"polluted":true}}'
    ));
    expect(result).toEqual({ ok: true, target: { mode: 'project', projectKey: 'PROJ', issueTypeId: '1', labels: [] } });
    expect(Object.keys(result.ok ? result.target : {})).toEqual(['mode', 'projectKey', 'issueTypeId', 'labels']);
    expect(Object.getPrototypeOf(result.ok ? result.target : null)).toBe(Object.prototype);

    expect(validateJiraTarget({ mode: 'parent', parentKey: 'PROJ-1', projectKey: 'PROJ', issueTypeId: '1', labels: [] }))
      .toEqual({ ok: true, target: { mode: 'parent', parentKey: 'PROJ-1', issueTypeId: '1', labels: [] } });
  });

  it('returns what types.ts calls a JiraTarget', () => {
    const result = validateJiraTarget({ mode: 'parent', parentKey: 'PROJ-1', issueTypeId: '1' });
    // A type-level guard as much as a runtime one: `npm run type-check` fails
    // here if the JSDoc shape and the TypeScript interface drift apart.
    const target: JiraTarget | null = result.ok ? result.target : null;
    const link: JiraLink = { key: 'PROJ-2', createdAt: '2026-10-20T10:00:00.000Z' };
    expect(target?.mode).toBe('parent');
    expect(isJiraLinked({ jira: link })).toBe(true);
  });

  it('returns a new labels array, never the caller\'s', () => {
    const labels = ['retro'];
    const result = validateJiraTarget({ mode: 'project', projectKey: 'PROJ', issueTypeId: '1', labels });
    // Success first: on a refusal `result.ok && …` is `false`, which is not
    // `labels` either, so the identity check alone would pass on nothing.
    expect(result).toEqual({ ok: true, target: { mode: 'project', projectKey: 'PROJ', issueTypeId: '1', labels: ['retro'] } });
    expect(result.ok && result.target.labels).not.toBe(labels);
  });

  it.each([
    ['no target', undefined],
    ['null', null],
    ['a string', 'PROJ'],
    ['an array', []],
    ['an unknown mode', { mode: 'board', projectKey: 'PROJ', issueTypeId: '1', labels: [] }],
    ['no mode', { projectKey: 'PROJ', issueTypeId: '1', labels: [] }],
    ['a project target without a project key', { mode: 'project', issueTypeId: '1', labels: [] }],
    ['a project target with a lowercase key', { mode: 'project', projectKey: 'proj', issueTypeId: '1', labels: [] }],
    ['a project target with only a parent key', { mode: 'project', parentKey: 'PROJ-1', issueTypeId: '1', labels: [] }],
    ['a parent target without a parent key', { mode: 'parent', projectKey: 'PROJ', issueTypeId: '1', labels: [] }],
    ['a parent target with a project key as parent', { mode: 'parent', parentKey: 'PROJ', issueTypeId: '1', labels: [] }],
    ['no issue type', { mode: 'project', projectKey: 'PROJ', labels: [] }],
    ['an issue type name', { mode: 'project', projectKey: 'PROJ', issueTypeId: 'Task', labels: [] }],
    ['a numeric issue type', { mode: 'project', projectKey: 'PROJ', issueTypeId: 10001, labels: [] }]
  ])('refuses %s as an invalid target', (_label, target) => {
    expect(validateJiraTarget(target)).toEqual({ ok: false, error: 'invalid_jira_target' });
  });

  it.each([
    ['a label with a space', ['two words']],
    ['too many labels', Array.from({ length: 11 }, (_, i) => `l${i}`)],
    ['a label string instead of a list', 'retro']
  ])('refuses %s as invalid labels', (_label, labels) => {
    expect(validateJiraTarget({ mode: 'project', projectKey: 'PROJ', issueTypeId: '1', labels }))
      .toEqual({ ok: false, error: 'invalid_jira_labels' });
  });

  it('reports the target before the labels when both are wrong', () => {
    expect(validateJiraTarget({ mode: 'project', projectKey: 'proj', issueTypeId: '1', labels: ['a b'] }))
      .toEqual({ ok: false, error: 'invalid_jira_target' });
  });

  // One parent issue per retrospective or health check, created in a project
  // with a standard type, and each action as its sub-task (F2).
  describe('in sessionParent mode', () => {
    const sessionParent = { mode: 'sessionParent', projectKey: 'PROJ', parentIssueTypeId: '10001', issueTypeId: '10005', labels: ['retro'] };

    it('accepts a project, a parent type and a sub-task type, in this field order', () => {
      const result = validateJiraTarget(sessionParent);
      expect(result).toEqual({ ok: true, target: sessionParent });
      expect(Object.keys(result.ok ? result.target : {})).toEqual(['mode', 'projectKey', 'parentIssueTypeId', 'issueTypeId', 'labels']);
      // The type-level half: a `JiraTarget` may carry the parent type.
      const target: JiraTarget | null = result.ok ? result.target : null;
      expect(target?.parentIssueTypeId).toBe('10001');
    });

    it('drops a stray parent key, and anything else the mode does not use', () => {
      expect(validateJiraTarget({ ...sessionParent, parentKey: 'PROJ-1', summary: 'injected' }))
        .toEqual({ ok: true, target: sessionParent });
    });

    it.each([
      ['without a project key', { ...sessionParent, projectKey: undefined }],
      ['with only a parent key', { ...sessionParent, projectKey: undefined, parentKey: 'PROJ-1' }],
      ['without a parent type', { ...sessionParent, parentIssueTypeId: undefined }],
      ['with a parent type name', { ...sessionParent, parentIssueTypeId: 'Task' }],
      ['with a numeric parent type', { ...sessionParent, parentIssueTypeId: 10001 }],
      // A type is a sub-task type or a standard one, never both.
      ['with the same type for the parent and its sub-tasks', { ...sessionParent, parentIssueTypeId: '10005' }],
      ['without a sub-task type', { ...sessionParent, issueTypeId: undefined }]
    ])('refuses a target %s', (_label, target) => {
      expect(validateJiraTarget(target)).toEqual({ ok: false, error: 'invalid_jira_target' });
    });

    it('still refuses its labels after its destination', () => {
      expect(validateJiraTarget({ ...sessionParent, labels: ['a b'] })).toEqual({ ok: false, error: 'invalid_jira_labels' });
    });
  });

  it('drops a parent type from the two other modes, so a stored target never carries a stale half', () => {
    expect(validateJiraTarget({ mode: 'project', projectKey: 'PROJ', parentIssueTypeId: '10001', issueTypeId: '10002', labels: [] }))
      .toEqual({ ok: true, target: { mode: 'project', projectKey: 'PROJ', issueTypeId: '10002', labels: [] } });
    expect(validateJiraTarget({ mode: 'parent', parentKey: 'PROJ-1', parentIssueTypeId: '10001', issueTypeId: '10005', labels: [] }))
      .toEqual({ ok: true, target: { mode: 'parent', parentKey: 'PROJ-1', issueTypeId: '10005', labels: [] } });
  });
});

describe('jiraProjectKeyOf', () => {
  it.each([
    ['PROJ-12', 'PROJ'],
    ['A1_B-7', 'A1_B'],
    ['OPS-1', 'OPS']
  ])('reads %s as issued in %s', (key, project) => {
    expect(jiraProjectKeyOf(key)).toBe(project);
  });

  it.each(['proj-12', 'PROJ', 'PROJ-0', 'https://jira/browse/PROJ-1', '', undefined, null, 12])('reads %s as no key', (value) => {
    expect(jiraProjectKeyOf(value)).toBeNull();
  });
});

describe('isJiraParentScope', () => {
  it.each([
    'backlog',
    'retro:r1',
    'healthcheck:hc-q3',
    // The id is whatever the record holds: /retrospective/:retroId bounds
    // nothing, so a scope the server wrote must not be refused here.
    `retro:${repeat('x', 200)}`,
    'retro:retro:nested'
  ])('accepts %s', (scope) => {
    expect(isJiraParentScope(scope)).toBe(true);
  });

  it.each([
    ['a kind with no id', 'retro:'],
    ['a health check with no id', 'healthcheck:'],
    ['an unknown kind', 'board:1'],
    ['a bare id', 'r1'],
    ['the backlog spelled otherwise', 'Backlog'],
    ['far longer than any id', `retro:${repeat('x', 1100)}`],
    ['a non-string', 12],
    ['nothing', undefined]
  ])('refuses %s', (_label, value) => {
    expect(isJiraParentScope(value)).toBe(false);
  });
});
