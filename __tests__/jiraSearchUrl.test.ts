import { describe, expect, it } from 'vitest';
import { jiraSearchUrl } from '../components/jira/jiraSearchUrl';

/**
 * "May already be in Jira: check it" links to a search of the target for the
 * action's words (plan v2, "Creating issues"). The JQL is built from words
 * only, so nothing a participant typed can change the query's structure, and
 * the address is the configured Jira's or nothing.
 */

const jqlOf = (url: string | null) => {
  expect(url).not.toBeNull();
  const parsed = new URL(url as string);
  return parsed.searchParams.get('jql');
};

describe('jiraSearchUrl', () => {
  it('searches the project for the action\'s words, newest first', () => {
    const url = jiraSearchUrl('https://h.example.org/jira/', {
      text: 'Speed up the "build"!',
      target: { mode: 'project', projectKey: 'TEAM', issueTypeId: '1', labels: [] }
    });
    expect(url?.startsWith('https://h.example.org/jira/issues/?jql=')).toBe(true);
    expect(jqlOf(url)).toBe('project = "TEAM" AND summary ~ "speed up the build" ORDER BY created DESC');
  });

  it('searches the sub-tasks of the parent issue in parent mode', () => {
    const url = jiraSearchUrl('https://jira.example.org', {
      text: 'Fix it',
      target: { mode: 'parent', parentKey: 'TEAM-7', issueTypeId: '1', labels: [] }
    });
    expect(jqlOf(url)).toBe('parent = "TEAM-7" AND summary ~ "fix it" ORDER BY created DESC');
  });

  it('searches the project in session-parent mode', () => {
    const url = jiraSearchUrl('https://jira.example.org', {
      text: 'Fix it',
      target: { mode: 'sessionParent', projectKey: 'TEAM', parentIssueTypeId: '1', issueTypeId: '3', labels: [] }
    });
    expect(jqlOf(url)).toBe('project = "TEAM" AND summary ~ "fix it" ORDER BY created DESC');
  });

  // A parent issue that may already exist is searched by its title words.
  it('finds a parent issue by its title', () => {
    const url = jiraSearchUrl('https://jira.example.org', {
      text: 'Retrospective actions: Sprint 12 (21.10.2026)',
      target: { mode: 'sessionParent', projectKey: 'TEAM', parentIssueTypeId: '1', issueTypeId: '3', labels: [] }
    });
    expect(jqlOf(url)).toBe('project = "TEAM" AND summary ~ "retrospective actions sprint 12 21 10 2026" ORDER BY created DESC');
  });

  // [R10] An action in doubt in session-parent mode is under its session's
  // parent, which may be in another project (a parent named for a send).
  it('searches under the parent issue it is given, in place of the target\'s clause', () => {
    const target = { mode: 'sessionParent' as const, projectKey: 'TEAM', parentIssueTypeId: '1', issueTypeId: '3', labels: [] };
    expect(jqlOf(jiraSearchUrl('https://jira.example.org', { text: 'Fix it', target, parentKey: 'OPS-5' })))
      .toBe('parent = "OPS-5" AND summary ~ "fix it" ORDER BY created DESC');
    // Not a key: the target's own clause.
    expect(jqlOf(jiraSearchUrl('https://jira.example.org', { text: 'Fix it', target, parentKey: 'OPS-5" OR x' })))
      .toBe('project = "TEAM" AND summary ~ "fix it" ORDER BY created DESC');
  });

  // A valid project key can be a JQL reserved word (INT, SET, USER, DATE…) or
  // an operator (OR, IN): unquoted, Jira answers "'int' is a reserved JQL
  // word" instead of the search, exactly when the facilitator has to decide
  // whether to create a possible duplicate.
  it.each(['INT', 'OR', 'IN', 'SET'])('quotes a project key that JQL reserves (%s)', (projectKey) => {
    const url = jiraSearchUrl('https://jira.example.org', {
      text: 'Fix it',
      target: { mode: 'project', projectKey, issueTypeId: '1', labels: [] }
    });
    expect(jqlOf(url)).toBe(`project = "${projectKey}" AND summary ~ "fix it" ORDER BY created DESC`);
  });

  it('drops every character JQL could read as syntax, lower-cases the operators away, and keeps twelve words', () => {
    // Lucene reads AND, OR and NOT inside the quoted text as operators, but
    // only in capitals; Jira's text search ignores case anyway.
    const url = jiraSearchUrl('https://jira.example.org', {
      text: 'a" OR project = SECRET -- \\ ( ) [ ] 1 2 3 4 5 6 7 8 9',
      target: null
    });
    expect(jqlOf(url)).toBe('summary ~ "a or project secret 1 2 3 4 5 6 7 8" ORDER BY created DESC');
  });

  it('gives no link without a valid base URL or anything to search for', () => {
    expect(jiraSearchUrl(null, { text: 'x', target: null })).toBeNull();
    expect(jiraSearchUrl('ftp://jira.example.org', { text: 'x', target: null })).toBeNull();
    expect(jiraSearchUrl('https://jira.example.org', { text: '!!!', target: null })).toBeNull();
  });
});
