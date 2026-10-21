import type { JiraIssueType } from '../../types';

/**
 * The parent issue named for one send in the batch dialog
 * (`JiraParentField.tsx`), and the two rules the dialog reads from it before
 * it sends. Kept out of the component's file, which exports only components.
 */

/** The parent issue named for one send, as the dialog holds it. */
export interface JiraParentFieldValue {
  /** As typed, in capitals. */
  key: string;
  /** The last successful check: the key it was for, its project and that project's sub-task types. */
  checked: { key: string; projectKey: string; subtaskTypes: JiraIssueType[] } | null;
  /** The sub-task type chosen in the parent's project, when the target's own does not fit there. */
  subtaskTypeId: string;
}

export const EMPTY_JIRA_PARENT_FIELD: JiraParentFieldValue = { key: '', checked: null, subtaskTypeId: '' };

/** Whether the key typed is the one Jira was asked about, and answered for. */
export const isJiraParentChecked = (value: JiraParentFieldValue): boolean =>
  !!value.checked && value.checked.key === value.key.trim();

/**
 * The sub-task type a send under the named parent uses: the target's own when
 * the parent's project offers it, else the one chosen; '' while one must still
 * be chosen.
 */
export const jiraParentSubtaskType = (value: JiraParentFieldValue, targetIssueTypeId: string): string => {
  if (!isJiraParentChecked(value) || !value.checked) return '';
  const types = value.checked.subtaskTypes;
  if (types.some(type => type.id === targetIssueTypeId)) return targetIssueTypeId;
  return types.some(type => type.id === value.subtaskTypeId) ? value.subtaskTypeId : '';
};

