import type { ActionItem, JiraStatus } from '../../types';
import { validateJiraTarget } from '../../utils/jira.js';
import { issueSummary } from '../../utils/jiraIssueContent.js';

/**
 * Whether a facilitator can create Jira issues right now, and if not, why
 * (finding U-1). Every Jira control reads this one rule: the reason line, the
 * per-action button, the batch button and the discovery note's last sentence.
 * Written once so that a button never appears where the reason line says
 * creation is impossible, or the other way round.
 *
 *  - `off`: no status (a deployment without Jira, a pod from before the
 *    feature, a status that could not be read), or Jira turned off by the
 *    super admin. Nothing Jira-related is offered.
 *  - `blocked`: Jira is on, but the team cannot create yet. The reason names
 *    what to fix in Settings → Jira, the most fundamental first: no token at
 *    all, a token to enter again (the address changed, it no longer decrypts),
 *    a token Jira refused, no target.
 *  - `ready`: a usable token and a target that passes the shared validation.
 *
 * The server checks all of this again on every request; this only decides
 * what the screens offer.
 */
export type JiraBlockReason = 'noToken' | 'addressChanged' | 'unreadable' | 'refused' | 'noTarget';

export type JiraAvailability =
  | { state: 'off' }
  | { state: 'ready' }
  | { state: 'blocked'; reason: Exclude<JiraBlockReason, 'refused'> }
  | { state: 'blocked'; reason: 'refused'; refusedAt: string };

export const jiraAvailability = (status: JiraStatus | null | undefined): JiraAvailability => {
  if (!status || !status.enabled) return { state: 'off' };
  const token = status.token;
  if (!token?.configured) return { state: 'blocked', reason: 'noToken' };
  if (token.reason === 'address_changed') return { state: 'blocked', reason: 'addressChanged' };
  if (token.reason === 'unreadable') return { state: 'blocked', reason: 'unreadable' };
  if (typeof token.refusedAt === 'string' && token.refusedAt) {
    return { state: 'blocked', reason: 'refused', refusedAt: token.refusedAt };
  }
  // Unusable with no reason given: the only remedy the screens can offer is
  // entering it again.
  if (!token.usable) return { state: 'blocked', reason: 'unreadable' };
  if (!validateJiraTarget(status.target).ok) return { state: 'blocked', reason: 'noTarget' };
  return { state: 'ready' };
};

/**
 * The codes after which the status a screen holds no longer says what the
 * server knows (the token was refused or is gone, Jira was turned off, the
 * target was cleared): the screen reads it again and the reason line takes
 * over. A stop code of `/jira/issues` or a route's refusal, alike.
 */
const STATUS_STALE_CODES = new Set([
  'token_refused',
  'jira_token_missing',
  'jira_token_unusable',
  'jira_not_configured',
  'jira_target_missing'
]);

export const isJiraStatusStaleCode = (code: string | null | undefined): boolean =>
  typeof code === 'string' && STATUS_STALE_CODES.has(code);

/**
 * An action the Jira controls may offer to create: open, not a proposal, and
 * with a text that makes a summary. The server refuses the others (`closed`,
 * `not_found`, an empty summary), so offering them would only produce a
 * refusal.
 */
export const isOpenForJira = (action: ActionItem): boolean =>
  !action.done && action.type !== 'proposal' && issueSummary(action.text) !== '';

/** What an issue's description says the action comes from (`issueFields`'s `kind`). */
export type JiraActionKind = 'retro' | 'healthcheck' | 'backlog';

/**
 * A stored ISO date in the reader's locale. A value that is not a date is
 * shown as stored rather than as "Invalid Date", and an unusable locale falls
 * back to the browser's.
 */
export const formatJiraDate = (iso: string | null | undefined, locale: string): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleDateString(locale);
  } catch {
    return date.toLocaleDateString();
  }
};
