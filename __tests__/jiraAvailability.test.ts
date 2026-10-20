import { describe, expect, it } from 'vitest';
import type { ActionItem, JiraStatus } from '../types';
import {
  formatJiraDate,
  isOpenForJira,
  jiraActionHome,
  jiraAvailability
} from '../components/jira/jiraAvailability';

/**
 * When a facilitator can create issues, and why not (finding U-1). Every Jira
 * control reads these rules — the reason line, the per-action button, the
 * batch button, the discovery note's last sentence — so they live in one pure
 * module and are pinned here once.
 */

const READY: JiraStatus = {
  enabled: true,
  baseUrl: 'https://jira.example.org',
  target: { mode: 'project', projectKey: 'TEAM', issueTypeId: '10001', labels: [] },
  token: {
    configured: true,
    usable: true,
    reason: null,
    connectedAs: 'Retro Bot',
    deploymentType: 'Server',
    setAt: '2026-10-20T08:00:00.000Z',
    refusedAt: null
  }
};

const withToken = (token: Partial<JiraStatus['token']>): JiraStatus => ({ ...READY, token: { ...READY.token, ...token } });

const action = (overrides: Partial<ActionItem> = {}): ActionItem => ({
  id: 'a1',
  text: 'Speed up the build',
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  ...overrides
});

describe('jiraAvailability', () => {
  it('is off without a status, and when the deployment has Jira turned off', () => {
    expect(jiraAvailability(null)).toEqual({ state: 'off' });
    expect(jiraAvailability(undefined)).toEqual({ state: 'off' });
    expect(jiraAvailability({ ...READY, enabled: false })).toEqual({ state: 'off' });
  });

  it('is ready with a usable token and a valid target', () => {
    expect(jiraAvailability(READY)).toEqual({ state: 'ready' });
  });

  it('names a missing token first, whatever else is missing', () => {
    expect(jiraAvailability({ ...withToken({ configured: false, usable: false }), target: null }))
      .toEqual({ state: 'blocked', reason: 'noToken' });
  });

  it('asks for the token again with the reason the server gives', () => {
    expect(jiraAvailability(withToken({ usable: false, reason: 'address_changed' })))
      .toEqual({ state: 'blocked', reason: 'addressChanged' });
    expect(jiraAvailability(withToken({ usable: false, reason: 'unreadable' })))
      .toEqual({ state: 'blocked', reason: 'unreadable' });
    // An unusable token with no reason given still needs entering again.
    expect(jiraAvailability(withToken({ usable: false })))
      .toEqual({ state: 'blocked', reason: 'unreadable' });
  });

  it('reports a token Jira refused, with the date it did', () => {
    expect(jiraAvailability(withToken({ refusedAt: '2026-10-19T12:00:00.000Z' })))
      .toEqual({ state: 'blocked', reason: 'refused', refusedAt: '2026-10-19T12:00:00.000Z' });
  });

  it('needs a target that passes the shared validation', () => {
    expect(jiraAvailability({ ...READY, target: null })).toEqual({ state: 'blocked', reason: 'noTarget' });
    const malformed = { ...READY, target: { mode: 'project', projectKey: 'team', issueTypeId: '1', labels: [] } } as JiraStatus;
    expect(jiraAvailability(malformed)).toEqual({ state: 'blocked', reason: 'noTarget' });
  });
});

describe('isOpenForJira', () => {
  it('accepts an open action, previous ones included', () => {
    expect(isOpenForJira(action())).toBe(true);
    expect(isOpenForJira(action({ type: 'prev' }))).toBe(true);
  });

  it('refuses a closed action and a proposal, which the server refuses too', () => {
    expect(isOpenForJira(action({ done: true }))).toBe(false);
    expect(isOpenForJira(action({ type: 'proposal' }))).toBe(false);
  });

  it('refuses an action with no text to make a summary of', () => {
    expect(isOpenForJira(action({ text: ' \n\t ' }))).toBe(false);
  });
});

describe('jiraActionHome', () => {
  const retro = { id: 'r1', name: 'Sprint 12', date: '2026-10-06', actions: [action({ id: 'in-retro' })] };
  const healthCheck = { id: 'h1', name: 'Q3', date: '2026-09-01', actions: [action({ id: 'in-hc' })] };
  const team = {
    retrospectives: [retro],
    healthChecks: [healthCheck],
    globalActions: [action({ id: 'in-retro' }), action({ id: 'backlog-only' })]
  };

  it('prefers the session the screen is showing when it holds the action', () => {
    const current = { id: 'r2', actions: [action({ id: 'in-retro' })] };
    expect(jiraActionHome({ actionId: 'in-retro', team, session: current, kind: 'retro' }))
      .toEqual({ session: current, kind: 'retro' });
  });

  it('finds the retrospective or health check an action comes from', () => {
    expect(jiraActionHome({ actionId: 'in-retro', team })).toEqual({ session: retro, kind: 'retro' });
    expect(jiraActionHome({ actionId: 'in-hc', team })).toEqual({ session: healthCheck, kind: 'healthcheck' });
  });

  it('reads anything else as a backlog action', () => {
    expect(jiraActionHome({ actionId: 'backlog-only', team })).toEqual({ session: null, kind: 'backlog' });
    expect(jiraActionHome({ actionId: 'nowhere', team: null })).toEqual({ session: null, kind: 'backlog' });
  });
});

describe('formatJiraDate', () => {
  it('formats a stored ISO date in the reader\'s locale', () => {
    expect(formatJiraDate('2026-10-19T12:00:00.000Z', 'en-GB')).toBe('19/10/2026');
  });

  it('keeps a value it cannot read rather than printing "Invalid Date"', () => {
    expect(formatJiraDate('not a date', 'en-GB')).toBe('not a date');
    expect(formatJiraDate(null, 'en-GB')).toBe('');
  });
});
