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
      labels: DEFAULT_JIRA_LABELS
    });
    expect(DEFAULT_JIRA_LABELS).toBe('retrospective');
  });

  it('fills the form from a stored target, labels separated by spaces', () => {
    expect(draftFromTarget({ mode: 'parent', parentKey: 'TEAM-7', issueTypeId: '10003', labels: ['retro', 'q4'] }))
      .toEqual({ mode: 'parent', projectKey: '', parentKey: 'TEAM-7', issueTypeId: '10003', labels: 'retro q4' });
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
    expect(targetFromDraft({ mode: 'project', projectKey: ' TEAM ', parentKey: 'OLD-1', issueTypeId: '10001', labels: 'retro' }))
      .toEqual({ ok: true, target: { mode: 'project', projectKey: 'TEAM', issueTypeId: '10001', labels: ['retro'] } });
  });

  it('builds a parent target', () => {
    expect(targetFromDraft({ mode: 'parent', projectKey: '', parentKey: 'TEAM-7', issueTypeId: '10003', labels: '' }))
      .toEqual({ ok: true, target: { mode: 'parent', parentKey: 'TEAM-7', issueTypeId: '10003', labels: [] } });
  });

  it('refuses what the route would refuse, with the route\'s code', () => {
    expect(targetFromDraft({ mode: 'project', projectKey: 'team', parentKey: '', issueTypeId: '10001', labels: '' }))
      .toEqual({ ok: false, error: 'invalid_jira_target' });
    expect(targetFromDraft({ mode: 'project', projectKey: 'TEAM', parentKey: '', issueTypeId: '', labels: '' }))
      .toEqual({ ok: false, error: 'invalid_jira_target' });
    expect(targetFromDraft({ mode: 'project', projectKey: 'TEAM', parentKey: '', issueTypeId: '1', labels: 'x'.repeat(256) }))
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
});
