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
    expect(jqlOf(url)).toBe('project = TEAM AND summary ~ "speed up the build" ORDER BY created DESC');
  });

  it('searches the sub-tasks of the parent issue in parent mode', () => {
    const url = jiraSearchUrl('https://jira.example.org', {
      text: 'Fix it',
      target: { mode: 'parent', parentKey: 'TEAM-7', issueTypeId: '1', labels: [] }
    });
    expect(jqlOf(url)).toBe('parent = TEAM-7 AND summary ~ "fix it" ORDER BY created DESC');
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
