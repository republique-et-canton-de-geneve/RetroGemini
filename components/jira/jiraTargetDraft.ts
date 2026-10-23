import type { JiraTarget } from '../../types';
import { normalizeJiraLabels, validateJiraTarget } from '../../utils/jira.js';

/**
 * The target form's state: what the facilitator typed, as strings, so a key
 * half-typed or a labels field mid-edit can be held without being a target
 * yet. It becomes a `JiraTarget` only through `validateJiraTarget`, the rule
 * `/jira/target` and `/jira/issues` apply (finding U-2), so the form never
 * accepts what the route then refuses.
 *
 * Both keys are kept while the mode changes, so switching modes back and forth
 * does not lose what was typed; the target built from the draft carries only
 * the key of its mode. `project` and `sessionParent` share the project key.
 */
export interface JiraTargetDraft {
  mode: 'project' | 'parent' | 'sessionParent';
  projectKey: string;
  parentKey: string;
  /** The type of each action's issue: a sub-task type in `parent` and `sessionParent` modes. */
  issueTypeId: string;
  /** `sessionParent` only: the standard type of the issue created per retrospective or health check. */
  parentIssueTypeId: string;
  /** As typed: labels separated by spaces or commas. */
  labels: string;
}

/** The labels a new target starts with (spec §2: default `retrospective`). */
export const DEFAULT_JIRA_LABELS = 'retrospective';

export const draftFromTarget = (target: JiraTarget | null | undefined): JiraTargetDraft => {
  if (!target) {
    return { mode: 'project', projectKey: '', parentKey: '', issueTypeId: '', parentIssueTypeId: '', labels: DEFAULT_JIRA_LABELS };
  }
  return {
    // A mode this release does not know reads as a project, as before.
    mode: target.mode === 'parent' || target.mode === 'sessionParent' ? target.mode : 'project',
    projectKey: target.projectKey ?? '',
    parentKey: target.parentKey ?? '',
    issueTypeId: target.issueTypeId ?? '',
    parentIssueTypeId: target.parentIssueTypeId ?? '',
    labels: Array.isArray(target.labels) ? target.labels.join(' ') : ''
  };
};

/** The labels typed, split on spaces and commas; empty pieces dropped. */
export const splitJiraLabels = (text: string): string[] => text.split(/[\s,]+/).filter(Boolean);

/** The labels typed, as the shared rule accepts them, or `null` when it does not. */
export const labelsFromText = (text: string): string[] | null => normalizeJiraLabels(splitJiraLabels(text));

export type JiraTargetFromDraft =
  | { ok: true; target: JiraTarget }
  | { ok: false; error: 'invalid_jira_target' | 'invalid_jira_labels' };

export const targetFromDraft = (draft: JiraTargetDraft): JiraTargetFromDraft => {
  const key = draft.mode === 'parent' ? { parentKey: draft.parentKey.trim() } : { projectKey: draft.projectKey.trim() };
  return validateJiraTarget({
    mode: draft.mode,
    ...key,
    ...(draft.mode === 'sessionParent' ? { parentIssueTypeId: draft.parentIssueTypeId } : {}),
    issueTypeId: draft.issueTypeId,
    labels: splitJiraLabels(draft.labels)
  }) as JiraTargetFromDraft;
};

/**
 * Whether two targets are the same once validated as the server stores them:
 * the key of the other mode is ignored (and so is the parent issue's type
 * outside `sessionParent`), labels compare in order.
 */
export const sameJiraTarget = (a: JiraTarget | null | undefined, b: JiraTarget | null | undefined): boolean => {
  const left = validateJiraTarget(a);
  const right = validateJiraTarget(b);
  if (!left.ok || !right.ok) return false;
  const { target: x } = left;
  const { target: y } = right;
  return x.mode === y.mode
    && x.projectKey === y.projectKey
    && x.parentKey === y.parentKey
    && x.parentIssueTypeId === y.parentIssueTypeId
    && x.issueTypeId === y.issueTypeId
    && x.labels.length === y.labels.length
    && x.labels.every((label, index) => label === y.labels[index]);
};
