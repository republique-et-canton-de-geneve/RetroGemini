import { describe, expect, it } from 'vitest';
import type { JiraIssueResult } from '../types';
import type { CreateIssuesOutcome } from '../services/jiraService';
import { groupJiraResults } from '../components/jira/jiraBatchResults';

/**
 * What the batch dialog reports for each action, grouped. Every status of
 * contracts §2 lands in exactly one group, and the safe reading wins whenever
 * the answer is unreadable: an issue that may exist is said to "may already be
 * in Jira", never "not sent", so nobody creates it twice.
 */

const outcome = (results: JiraIssueResult[], extra: Partial<CreateIssuesOutcome> = {}): CreateIssuesOutcome => ({
  results,
  notSent: [],
  unknown: [],
  parents: [],
  ...extra
});

const EMPTY = {
  created: [],
  alreadyLinked: [],
  notSaved: [],
  refused: [],
  noText: [],
  skipped: [],
  uncertain: [],
  notSent: [],
  unknown: [],
  parentUncertain: [],
  parentRefused: []
};

describe('groupJiraResults', () => {
  it.each([
    ['created', { created: [{ actionId: 'a1', key: 'TEAM-1' }] }],
    ['already_linked', { alreadyLinked: [{ actionId: 'a1', key: 'TEAM-1' }] }],
    ['created_not_saved', { notSaved: [{ actionId: 'a1', key: 'TEAM-1' }] }]
  ] as const)('puts a %s answer with its key where it reports the key', (status, expected) => {
    expect(groupJiraResults(outcome([{ actionId: 'a1', status, key: 'TEAM-1' }]))).toEqual({ ...EMPTY, ...expected });
  });

  it.each(['created', 'already_linked', 'created_not_saved'] as const)(
    'reads a %s answer without a valid key as possibly in Jira',
    (status) => {
      expect(groupJiraResults(outcome([{ actionId: 'a1', status }]))).toEqual({ ...EMPTY, uncertain: ['a1'] });
      expect(groupJiraResults(outcome([{ actionId: 'a1', status, key: 'not a key' }]))).toEqual({ ...EMPTY, uncertain: ['a1'] });
    }
  );

  it('keeps Jira\'s own messages for a refusal, dropping the empty ones', () => {
    expect(groupJiraResults(outcome([
      { actionId: 'a1', status: 'refused', jiraMessages: ['Component/s is required.', '  ', 7 as unknown as string] }
    ]))).toEqual({
      ...EMPTY,
      refused: [{ actionId: 'a1', messages: ['Component/s is required.'], refusesLabels: false }]
    });
  });

  // Plan J-5: labels a project does not accept are the target's to fix, and
  // the screens say where. Only Jira naming the field says so.
  it.each([
    [['labels'], true],
    [['summary', 'labels'], true],
    [['customfield_10100'], false],
    [undefined, false]
  ])('reads a refusal naming %j as a refusal of the labels: %s', (jiraFields, refusesLabels) => {
    expect(groupJiraResults(outcome([
      { actionId: 'a1', status: 'refused', jiraMessages: ['x'], ...(jiraFields ? { jiraFields } : {}) }
    ])).refused).toEqual([{ actionId: 'a1', messages: ['x'], refusesLabels }]);
  });

  // The server refuses an action whose summary comes out empty itself, with
  // `reason: 'no_text'` and no Jira message, and sends nothing to Jira:
  // reported as "Jira refused" with nothing after it, the facilitator would
  // look for a reason in Jira.
  it.each([
    ['no message at all', undefined],
    ['an empty list', []],
    ['only blank messages', ['', '   ']]
  ])('reads a no_text refusal with %s as an action with no text, never as refused by Jira', (_, jiraMessages) => {
    expect(groupJiraResults(outcome([
      { actionId: 'a2', status: 'refused', reason: 'no_text', ...(jiraMessages ? { jiraMessages } : {}) }
    ]))).toEqual({ ...EMPTY, noText: ['a2'] });
  });

  // A gateway in front of Jira refusing with a page, or a Jira 4xx with an
  // empty `errors` object: Jira refused an action that has text, and gave no
  // words. "This action has no text" would be false there.
  it.each([
    ['no message at all', undefined],
    ['an empty list', []],
    ['only blank messages', ['', '   ']]
  ])('reads a refusal with %s and no reason as refused by Jira, never as an action with no text', (_, jiraMessages) => {
    expect(groupJiraResults(outcome([
      { actionId: 'a2', status: 'refused', ...(jiraMessages ? { jiraMessages } : {}) }
    ]))).toEqual({ ...EMPTY, refused: [{ actionId: 'a2', messages: [], refusesLabels: false }] });
  });

  it.each(['in_progress', 'closed', 'not_found'] as const)('reports %s as skipped', (status) => {
    expect(groupJiraResults(outcome([{ actionId: 'a1', status }]))).toEqual({ ...EMPTY, skipped: ['a1'] });
  });

  // `sessionParent` mode: nothing was sent for these actions, so "check Jira
  // before creating it again" would be false. Each has its own group, or is
  // skipped, and none of them is ever read as possibly in Jira.
  it('groups the parent statuses on their own, never as possibly in Jira', () => {
    expect(groupJiraResults(outcome([
      { actionId: 'a1', status: 'parent_uncertain' },
      { actionId: 'a2', status: 'parent_refused', jiraMessages: ['Epic Name is required.', ' '], jiraFields: ['customfield_10011'] },
      { actionId: 'a3', status: 'parent_refused', jiraMessages: ['Field labels cannot be set.'], jiraFields: ['labels'] },
      { actionId: 'a4', status: 'parent_in_progress' }
    ]))).toEqual({
      ...EMPTY,
      parentUncertain: ['a1'],
      parentRefused: [
        { actionId: 'a2', messages: ['Epic Name is required.'], refusesLabels: false },
        { actionId: 'a3', messages: ['Field labels cannot be set.'], refusesLabels: true }
      ],
      skipped: ['a4']
    });
  });

  it('reads uncertain, and any status this client does not know, as possibly in Jira', () => {
    expect(groupJiraResults(outcome([
      { actionId: 'a1', status: 'uncertain' },
      { actionId: 'a2', status: 'from_a_later_release' as JiraIssueResult['status'] }
    ]))).toEqual({ ...EMPTY, uncertain: ['a1', 'a2'] });
  });

  it('passes the actions never sent and the ones whose answer was lost through as they are', () => {
    const grouped = groupJiraResults(outcome([], { notSent: ['a3', 'a4'], unknown: ['a5'] }));
    expect(grouped).toEqual({ ...EMPTY, notSent: ['a3', 'a4'], unknown: ['a5'] });
  });

  it('places every action of a mixed batch exactly once, in the order answered', () => {
    const grouped = groupJiraResults(outcome([
      { actionId: 'a1', status: 'created', key: 'TEAM-1' },
      { actionId: 'a2', status: 'closed' },
      { actionId: 'a3', status: 'already_linked', key: 'TEAM-4' },
      { actionId: 'a4', status: 'created', key: 'TEAM-2' }
    ], { notSent: ['a5'] }));

    expect(grouped.created).toEqual([{ actionId: 'a1', key: 'TEAM-1' }, { actionId: 'a4', key: 'TEAM-2' }]);
    expect(grouped.alreadyLinked).toEqual([{ actionId: 'a3', key: 'TEAM-4' }]);
    expect(grouped.skipped).toEqual(['a2']);
    expect(grouped.notSent).toEqual(['a5']);
    expect(grouped.uncertain).toEqual([]);
  });
});
