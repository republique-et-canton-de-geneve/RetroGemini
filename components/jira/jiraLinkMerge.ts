import type { ActionItem, JiraLink } from '../../types';
import { isJiraLinked, isJiraUncertain } from '../../utils/jira.js';

/**
 * Which Jira link an action shows when two copies of it disagree (finding
 * A-5): `record`, the team record's copy as this browser's cache holds it, and
 * `held`, the copy a live session holds (an action of the session, an entry of
 * `openActionsSnapshot` or `historyActionsSnapshot`).
 *
 * Neither copy is reliably the latest. Only the Jira route writes a link; it
 * updates the team record, then patches the session row, and only the browser
 * that clicked learns the keys in its cache (`dataService.applyJiraLinks`). A
 * participant's cache never does, so their session copy is ahead; the
 * clicker's cache can be ahead of a session row the patch has not reached yet.
 * The screens and the maps that rebuild session copies from the record
 * (Session.tsx) therefore never let one side erase what the other knows:
 *
 *  - a key wins over no key, and over a doubt (the issue it names exists);
 *  - the record wins when both hold a different key, which the server never
 *    writes (a key is never replaced) and is only a planted value;
 *  - a doubt wins over nothing;
 *  - when both copies say the same thing, the held object is kept, so a
 *    rebuild that compares objects sees no change and writes nothing.
 *
 * Anything that is neither a valid key nor a doubt is not a link: `held` is
 * returned unchanged then, so the merge never erases what a session holds.
 */
export const mergeJiraLink = (
  record: JiraLink | undefined,
  held: JiraLink | undefined
): JiraLink | undefined => {
  const recordHasKey = isJiraLinked({ jira: record });
  const heldHasKey = isJiraLinked({ jira: held });
  if (recordHasKey) {
    return heldHasKey && (held as { key: string }).key === (record as { key: string }).key ? held : record;
  }
  if (heldHasKey) return held;
  if (isJiraUncertain({ jira: held })) return held;
  if (isJiraUncertain({ jira: record })) return record;
  return held ?? record;
};

// What a link says, for comparing two copies: the key, a doubt, or nothing.
// When it was created or the doubt began does not change what the screen shows.
const meaningOf = (link: JiraLink | undefined): string => {
  if (isJiraLinked({ jira: link })) return `key:${(link as { key: string }).key}`;
  if (isJiraUncertain({ jira: link })) return 'uncertain';
  return '';
};

/** Whether two copies of an action's link say the same thing (counted in a rebuild's "states changed"). */
export const sameJiraLink = (a: JiraLink | undefined, b: JiraLink | undefined): boolean =>
  a === b || meaningOf(a) === meaningOf(b);

/**
 * `action` with the link `mergeJiraLink(record, action.jira)` chooses: the
 * very object when that changes nothing, so an action that had no link never
 * gains a `jira: undefined` key; a copy otherwise.
 */
export const withJiraLinkFrom = <T extends ActionItem>(action: T, record: JiraLink | undefined): T => {
  const jira = mergeJiraLink(record, action.jira);
  return jira === action.jira ? action : { ...action, jira };
};

/**
 * For a rebuild that spreads the record's copy (`{ ...record, … }`): the
 * `jira` field to put after the spread so a link only `held` knows survives,
 * or nothing when the record's own field already says it all.
 */
export const jiraLinkFields = (
  record: JiraLink | undefined,
  held: JiraLink | undefined
): { jira?: JiraLink } => {
  const jira = mergeJiraLink(record, held);
  return jira === undefined || jira === record ? {} : { jira };
};
