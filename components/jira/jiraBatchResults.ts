import type { CreateIssuesOutcome } from '../../services/jiraService';
import { isJiraIssueKey } from '../../utils/jira.js';

/**
 * What became of each action of a batch, grouped the way the dialog reports
 * it. Every action sent lands in exactly one group:
 *
 *  - `created`, `alreadyLinked`, `notSaved`: an issue exists and its key is
 *    known (`notSaved`: created, but the link could not be stored, so the
 *    next click would create it again — said separately);
 *  - `refused`: Jira refused it, with Jira's own messages;
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
  skipped: string[];
  uncertain: string[];
  notSent: string[];
  unknown: string[];
}

export const groupJiraResults = (outcome: CreateIssuesOutcome): JiraBatchGroups => {
  const groups: JiraBatchGroups = {
    created: [],
    alreadyLinked: [],
    notSaved: [],
    refused: [],
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
        groups.refused.push({
          actionId: result.actionId,
          messages: (result.jiraMessages ?? []).filter((m): m is string => typeof m === 'string' && m.trim() !== '')
        });
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
