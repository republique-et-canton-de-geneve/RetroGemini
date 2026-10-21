import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JIRA_LABELS,
  draftFromTarget,
  labelsFromText,
  sameJiraTarget,
  splitJiraLabels,
  targetFromDraft
} from '../components/jira/jiraTargetDraft';

/**
 * The target form keeps what the facilitator typed (a draft of strings) and
 * turns it into a `JiraTarget` only through the shared `validateJiraTarget`,
 * so the form never accepts a value the route then refuses (finding U-2).
 */

describe('draftFromTarget', () => {
  it('starts an empty form in project mode with the default label', () => {
    expect(draftFromTarget(null)).toEqual({
      mode: 'project',
      projectKey: '',
      parentKey: '',
      issueTypeId: '',
      parentIssueTypeId: '',
      labels: DEFAULT_JIRA_LABELS
    });
    expect(DEFAULT_JIRA_LABELS).toBe('retrospective');
  });

  it('fills the form from a stored target, labels separated by spaces', () => {
    expect(draftFromTarget({ mode: 'parent', parentKey: 'TEAM-7', issueTypeId: '10003', labels: ['retro', 'q4'] }))
      .toEqual({ mode: 'parent', projectKey: '', parentKey: 'TEAM-7', issueTypeId: '10003', parentIssueTypeId: '', labels: 'retro q4' });
  });

  it('keeps the session-parent mode and both of its types', () => {
    expect(draftFromTarget({ mode: 'sessionParent', projectKey: 'TEAM', parentIssueTypeId: '10001', issueTypeId: '10003', labels: ['retro'] }))
      .toEqual({ mode: 'sessionParent', projectKey: 'TEAM', parentKey: '', issueTypeId: '10003', parentIssueTypeId: '10001', labels: 'retro' });
  });

  it('reads a mode it does not know as a project', () => {
    expect(draftFromTarget({ mode: 'epic' as never, projectKey: 'TEAM', issueTypeId: '10001', labels: [] }).mode).toBe('project');
  });
});

describe('labels', () => {
  it('accepts commas, spaces and both as separators', () => {
    expect(splitJiraLabels(' retro, q4  sprint-12,,')).toEqual(['retro', 'q4', 'sprint-12']);
    expect(splitJiraLabels('')).toEqual([]);
  });

  it('validates the list with the shared rule', () => {
    expect(labelsFromText('a, a b')).toEqual(['a', 'b']);
    expect(labelsFromText('x'.repeat(256))).toBeNull();
    expect(labelsFromText(Array.from({ length: 11 }, (_, i) => `l${i}`).join(' '))).toBeNull();
  });
});

describe('targetFromDraft', () => {
  it('builds a project target, trimming the keys', () => {
    expect(targetFromDraft({ mode: 'project', projectKey: ' TEAM ', parentKey: 'OLD-1', issueTypeId: '10001', parentIssueTypeId: '9', labels: 'retro' }))
      .toEqual({ ok: true, target: { mode: 'project', projectKey: 'TEAM', issueTypeId: '10001', labels: ['retro'] } });
  });

  it('builds a parent target', () => {
    expect(targetFromDraft({ mode: 'parent', projectKey: '', parentKey: 'TEAM-7', issueTypeId: '10003', parentIssueTypeId: '9', labels: '' }))
      .toEqual({ ok: true, target: { mode: 'parent', parentKey: 'TEAM-7', issueTypeId: '10003', labels: [] } });
  });

  it('builds a session-parent target in the project, with the parent issue\'s type', () => {
    expect(targetFromDraft({ mode: 'sessionParent', projectKey: ' TEAM ', parentKey: 'OLD-1', issueTypeId: '10003', parentIssueTypeId: '10001', labels: 'retro' }))
      .toEqual({ ok: true, target: { mode: 'sessionParent', projectKey: 'TEAM', parentIssueTypeId: '10001', issueTypeId: '10003', labels: ['retro'] } });
    // Without the parent issue's type, or with the same type twice: the route's refusal.
    expect(targetFromDraft({ mode: 'sessionParent', projectKey: 'TEAM', parentKey: '', issueTypeId: '10003', parentIssueTypeId: '', labels: '' }))
      .toEqual({ ok: false, error: 'invalid_jira_target' });
    expect(targetFromDraft({ mode: 'sessionParent', projectKey: 'TEAM', parentKey: '', issueTypeId: '10003', parentIssueTypeId: '10003', labels: '' }))
      .toEqual({ ok: false, error: 'invalid_jira_target' });
  });

  it('refuses what the route would refuse, with the route\'s code', () => {
    expect(targetFromDraft({ mode: 'project', projectKey: 'team', parentKey: '', issueTypeId: '10001', parentIssueTypeId: '', labels: '' }))
      .toEqual({ ok: false, error: 'invalid_jira_target' });
    expect(targetFromDraft({ mode: 'project', projectKey: 'TEAM', parentKey: '', issueTypeId: '', parentIssueTypeId: '', labels: '' }))
      .toEqual({ ok: false, error: 'invalid_jira_target' });
    expect(targetFromDraft({ mode: 'project', projectKey: 'TEAM', parentKey: '', issueTypeId: '1', parentIssueTypeId: '', labels: 'x'.repeat(256) }))
      .toEqual({ ok: false, error: 'invalid_jira_labels' });
  });
});

describe('sameJiraTarget', () => {
  it('compares targets as the server stores them', () => {
    const stored = { mode: 'project' as const, projectKey: 'TEAM', issueTypeId: '1', labels: ['a', 'b'] };
    expect(sameJiraTarget(stored, { ...stored, parentKey: 'IGNORED-1' })).toBe(true);
    expect(sameJiraTarget(stored, { ...stored, labels: ['b', 'a'] })).toBe(false);
    expect(sameJiraTarget(stored, { ...stored, issueTypeId: '2' })).toBe(false);
    expect(sameJiraTarget(stored, null)).toBe(false);
  });

  it('tells two session-parent targets apart by the parent issue\'s type', () => {
    const stored = { mode: 'sessionParent' as const, projectKey: 'TEAM', parentIssueTypeId: '1', issueTypeId: '3', labels: [] };
    expect(sameJiraTarget(stored, { ...stored })).toBe(true);
    expect(sameJiraTarget(stored, { ...stored, parentIssueTypeId: '2' })).toBe(false);
    // The same project and type in project mode is another target.
    expect(sameJiraTarget(stored, { mode: 'project', projectKey: 'TEAM', issueTypeId: '3', labels: [] })).toBe(false);
  });
});
