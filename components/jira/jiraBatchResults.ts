import type { JiraIssueResult } from '../../types';
import type { CreateIssuesOutcome } from '../../services/jiraService';
import { isJiraIssueKey } from '../../utils/jira.js';

/**
 * What became of each action of a batch, grouped the way the dialog reports
 * it. Every action sent lands in exactly one group:
 *
 *  - `created`, `alreadyLinked`, `notSaved`: an issue exists and its key is
 *    known (`notSaved`: created, but the link could not be stored, so the
 *    next click would create it again — said separately);
 *  - `refused`: Jira refused it, with Jira's own messages — none when Jira
 *    gave no words (a gateway's page, an empty `errors` object);
 *  - `noText`: the server refused it without calling Jira, because its copy
 *    on the team record has no text to make a summary of
 *    (`reason: 'no_text'`). Reported as such: "refused by Jira" would send
 *    the facilitator to Jira for a reason Jira never gave. Only the reason
 *    says so; a refusal with no message is not one, it may be Jira's;
 *  - `skipped`: the server did not try (closed, not saved for the team yet,
 *    being created from another window);
 *  - `uncertain`: the server marked it, or answered with a key this client
 *    cannot read: it may exist in Jira;
 *  - `notSent`: never attempted (a stop, a refusal of the request), safe to
 *    send again;
 *  - `unknown`: sent in a request whose answer was lost; never sent again
 *    automatically.
 */
export interface JiraBatchGroups {
  created: { actionId: string; key: string }[];
  alreadyLinked: { actionId: string; key: string }[];
  notSaved: { actionId: string; key: string }[];
  refused: { actionId: string; messages: string[] }[];
  noText: string[];
  skipped: string[];
  uncertain: string[];
  notSent: string[];
  unknown: string[];
}

/** Jira's own words in a refusal, the blank ones dropped. */
export const jiraMessagesOf = (result: Pick<JiraIssueResult, 'jiraMessages'>): string[] =>
  (result.jiraMessages ?? []).filter((m): m is string => typeof m === 'string' && m.trim() !== '');

/** The refusal the server makes itself, for an action with no text; never one of Jira's. */
export const isNoTextRefusal = (result: Pick<JiraIssueResult, 'status' | 'reason'>): boolean =>
  result.status === 'refused' && result.reason === 'no_text';

export const groupJiraResults = (outcome: CreateIssuesOutcome): JiraBatchGroups => {
  const groups: JiraBatchGroups = {
    created: [],
    alreadyLinked: [],
    notSaved: [],
    refused: [],
    noText: [],
    skipped: [],
    uncertain: [],
    notSent: [...outcome.notSent],
    unknown: [...outcome.unknown]
  };
  for (const result of outcome.results) {
    const keyed = isJiraIssueKey(result.key) ? { actionId: result.actionId, key: result.key as string } : null;
    switch (result.status) {
      case 'created':
      case 'already_linked':
      case 'created_not_saved':
        if (!keyed) groups.uncertain.push(result.actionId);
        else if (result.status === 'created') groups.created.push(keyed);
        else if (result.status === 'already_linked') groups.alreadyLinked.push(keyed);
        else groups.notSaved.push(keyed);
        break;
      case 'refused':
        if (isNoTextRefusal(result)) groups.noText.push(result.actionId);
        else groups.refused.push({ actionId: result.actionId, messages: jiraMessagesOf(result) });
        break;
      case 'in_progress':
      case 'closed':
      case 'not_found':
        groups.skipped.push(result.actionId);
        break;
      default:
        // `uncertain`, and any status this client does not know: the safe
        // reading is that the issue may exist.
        groups.uncertain.push(result.actionId);
    }
  }
  return groups;
};
