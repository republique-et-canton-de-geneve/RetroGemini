import type { JiraTarget } from '../../types';
import { isJiraIssueKey, isJiraProjectKey, parseJiraBaseUrl } from '../../utils/jira.js';

// How many of the action's words the search uses: enough to find the issue,
// few enough that Jira's text search does not drown in common words.
const MAX_SEARCH_WORDS = 12;

/**
 * A link to a Jira search for the issue an uncertain creation may have made
 * ("May already be in Jira: check it"): the target's project, or the sub-tasks
 * of its parent issue, and the action's words in the summary, newest first.
 *
 * The query is built from words only. Every character that is not a letter or
 * a digit becomes a space, so nothing a participant typed can close the quoted
 * text or add a clause; the words are lower-cased, because the text search
 * reads `AND`, `OR` and `NOT` in capitals as operators and ignores case
 * anyway. Keys are used only when they pass the key rules, and the address is
 * the configured Jira's, parsed by the shared rule, or there is no link.
 *
 * Keys are quoted: a valid project key can be a JQL reserved word (`INT`,
 * `SET`, `USER`) or an operator (`OR`, `IN`), which Jira refuses unquoted.
 * The key rules allow no quote and no backslash, so nothing needs escaping.
 */
export const jiraSearchUrl = (
  baseUrl: string | null | undefined,
  { text, target }: { text: string; target: JiraTarget | null | undefined }
): string | null => {
  const base = parseJiraBaseUrl(baseUrl);
  if (!base) return null;

  const words = (typeof text === 'string' ? text : '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, MAX_SEARCH_WORDS);
  if (words.length === 0) return null;

  const clauses: string[] = [];
  if (target?.mode === 'project' && isJiraProjectKey(target.projectKey)) clauses.push(`project = "${target.projectKey}"`);
  if (target?.mode === 'parent' && isJiraIssueKey(target.parentKey)) clauses.push(`parent = "${target.parentKey}"`);
  clauses.push(`summary ~ "${words.join(' ')}"`);

  const jql = `${clauses.join(' AND ')} ORDER BY created DESC`;
  return `${base}/issues/?jql=${encodeURIComponent(jql)}`;
};
