import { describe, expect, it } from 'vitest';
import type { ActionItem, JiraLink } from '../types';
import { jiraLinkFields, mergeJiraLink, sameJiraLink, withJiraLinkFrom } from '../components/jira/jiraLinkMerge';

/**
 * Which Jira link an action shows when two copies of it disagree: the team
 * record's and the one a live session holds (finding A-5). Only the Jira route
 * writes a link, and the server patches the session row, so neither copy can
 * be trusted to be the latest: a copy that has a key always wins over one
 * that has none, and a known link is never erased.
 */

const KEY: JiraLink = { key: 'TEAM-7', createdAt: '2026-10-20T10:00:00.000Z' };
const SAME_KEY_LATER: JiraLink = { key: 'TEAM-7', createdAt: '2026-10-20T10:00:05.000Z' };
const OTHER_KEY: JiraLink = { key: 'TEAM-8', createdAt: '2026-10-20T10:00:00.000Z' };
const DOUBT: JiraLink = { uncertainSince: '2026-10-20T09:00:00.000Z' };
const LATER_DOUBT: JiraLink = { uncertainSince: '2026-10-20T09:30:00.000Z' };

describe('mergeJiraLink(record, held)', () => {
  it('keeps the link the session holds when the record has none', () => {
    expect(mergeJiraLink(undefined, KEY)).toBe(KEY);
    expect(mergeJiraLink(undefined, DOUBT)).toBe(DOUBT);
  });

  it('takes the record’s link when the session has none', () => {
    expect(mergeJiraLink(KEY, undefined)).toBe(KEY);
    expect(mergeJiraLink(DOUBT, undefined)).toBe(DOUBT);
  });

  it('never lets a doubt replace a key, whichever copy holds which', () => {
    expect(mergeJiraLink(DOUBT, KEY)).toBe(KEY);
    expect(mergeJiraLink(KEY, DOUBT)).toBe(KEY);
  });

  it('keeps the held object when both copies name the same issue, so nothing reads as a change', () => {
    expect(mergeJiraLink(SAME_KEY_LATER, KEY)).toBe(KEY);
    expect(mergeJiraLink(LATER_DOUBT, DOUBT)).toBe(DOUBT);
  });

  it('prefers the record when the two copies name different issues', () => {
    expect(mergeJiraLink(OTHER_KEY, KEY)).toBe(OTHER_KEY);
  });

  it('keeps a key over a value that is not a link at all', () => {
    const malformed = { key: 'not a key', createdAt: 'x' } as unknown as JiraLink;
    expect(mergeJiraLink(malformed, KEY)).toBe(KEY);
    expect(mergeJiraLink(KEY, malformed)).toBe(KEY);
    // Neither side is a link: what the session holds stays as it is.
    expect(mergeJiraLink(undefined, malformed)).toBe(malformed);
  });

  it('answers nothing when neither copy has a link', () => {
    expect(mergeJiraLink(undefined, undefined)).toBeUndefined();
  });
});

describe('sameJiraLink', () => {
  it('reads two copies of one key, or two doubts, as the same link', () => {
    expect(sameJiraLink(KEY, SAME_KEY_LATER)).toBe(true);
    expect(sameJiraLink(DOUBT, LATER_DOUBT)).toBe(true);
    expect(sameJiraLink(undefined, undefined)).toBe(true);
  });

  it('tells a new key, another key or a resolved doubt apart', () => {
    expect(sameJiraLink(undefined, KEY)).toBe(false);
    expect(sameJiraLink(KEY, OTHER_KEY)).toBe(false);
    expect(sameJiraLink(DOUBT, KEY)).toBe(false);
  });
});

describe('withJiraLinkFrom', () => {
  const action = (jira?: JiraLink): ActionItem => ({
    id: 'a1',
    text: 'Fix the build',
    assigneeId: null,
    done: false,
    type: 'new',
    proposalVotes: {},
    ...(jira ? { jira } : {})
  });

  it('returns the very action when the record adds nothing', () => {
    const held = action(KEY);
    expect(withJiraLinkFrom(held, undefined)).toBe(held);
    const bare = action();
    expect(withJiraLinkFrom(bare, undefined)).toBe(bare);
    // No `jira: undefined` key is added to an action that had none.
    expect('jira' in withJiraLinkFrom(bare, undefined)).toBe(false);
  });

  it('puts the record’s link on a copy that lacks it, without touching the original', () => {
    const bare = action();
    const linked = withJiraLinkFrom(bare, KEY);
    expect(linked).not.toBe(bare);
    expect(linked.jira).toBe(KEY);
    expect(bare.jira).toBeUndefined();
  });
});

describe('jiraLinkFields', () => {
  it('adds nothing after a spread of the record when the record’s own link wins', () => {
    expect(jiraLinkFields(KEY, undefined)).toEqual({});
    expect(jiraLinkFields(KEY, DOUBT)).toEqual({});
    expect(jiraLinkFields(undefined, undefined)).toEqual({});
  });

  it('puts back the link only the held copy knows', () => {
    expect(jiraLinkFields(undefined, KEY)).toEqual({ jira: KEY });
    expect(jiraLinkFields(DOUBT, KEY)).toEqual({ jira: KEY });
    // The same issue: the held object, so a comparison by object sees no change.
    expect(jiraLinkFields(SAME_KEY_LATER, KEY).jira).toBe(KEY);
  });
});
