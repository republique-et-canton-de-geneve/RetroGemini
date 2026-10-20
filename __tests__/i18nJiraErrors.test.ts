import { describe, expect, it } from 'vitest';
import { translateErrorMessage } from '../i18n/errorMessages';
import { createTranslator, type MessageKey } from '../i18n/translate';
import { INVALID_JIRA_LABELS_ERROR, INVALID_JIRA_TARGET_ERROR } from '../utils/jira.js';

/**
 * Every code a Jira route answers with, and every code a batch stops with,
 * reads as a sentence in both languages. `jiraService` rejects with the code as
 * the error's message and the screens show `translateErrorMessage(message)`, so
 * a code missing from i18n/errorMessages.ts reaches the user raw:
 * "jira_token_unusable" on a French screen.
 *
 * The lists are the contract's (jira-contracts.md §2 and §3) plus the codes
 * every team route shares (a lost session, the limiters).
 */

const ROUTE_CODES = [
  // §3, every team route: a refused credential.
  'invalid_token',
  'invalid_password',
  'team_not_found',
  'too_many_requests',
  // /jira/token
  'jira_token_missing',
  'invalid_email',
  'jira_not_configured',
  'jira_secret_unavailable',
  'jira_auth_failed',
  'jira_auth_failed_cloud',
  'jira_forbidden',
  'jira_unreachable',
  // /jira/target
  INVALID_JIRA_TARGET_ERROR,
  INVALID_JIRA_LABELS_ERROR,
  // /jira/issue-types
  'jira_token_unusable',
  'jira_parent_invalid',
  'jira_not_found',
  'jira_rate_limited',
  'jira_unavailable',
  // /jira/issues
  'invalid_request',
  'jira_target_missing',
  // the console
  'invalid_jira_base_url',
  'failed_to_save'
];

const STOP_CODES = [
  'token_refused',
  'jira_forbidden',
  'jira_not_found',
  'jira_rate_limited',
  'jira_unavailable',
  'jira_unreachable',
  'link_not_saved',
  'server_restarting',
  'client_gone',
  'jira_parent_invalid',
  // jiraService's own: an answer that was lost.
  'outcome_unknown'
];

const CODES = [...new Set([...ROUTE_CODES, ...STOP_CODES])];

// The sentence each code reads as, pinned rather than merely "translated": a
// code mapped to the generic "Something went wrong", or to a neighbour's
// sentence by a copy-paste slip, still reads as a French sentence that is
// neither the code nor the English one, and sends the user the wrong way.
const EXPECTED_KEY: Record<string, MessageKey> = {
  invalid_token: 'errors.invalidToken',
  invalid_password: 'errors.invalidPassword',
  team_not_found: 'errors.teamNotFound',
  too_many_requests: 'errors.tooManyRequests',
  jira_token_missing: 'errors.jiraTokenMissing',
  invalid_email: 'errors.invalidEmail',
  jira_not_configured: 'errors.jiraNotConfigured',
  jira_secret_unavailable: 'errors.jiraSecretUnavailable',
  jira_auth_failed: 'errors.jiraAuthFailed',
  jira_auth_failed_cloud: 'errors.jiraAuthFailedCloud',
  jira_forbidden: 'errors.jiraForbidden',
  jira_unreachable: 'errors.jiraUnreachable',
  [INVALID_JIRA_TARGET_ERROR]: 'errors.invalidJiraTarget',
  [INVALID_JIRA_LABELS_ERROR]: 'errors.invalidJiraLabels',
  jira_token_unusable: 'errors.jiraTokenUnusable',
  jira_parent_invalid: 'errors.jiraParentInvalid',
  jira_not_found: 'errors.jiraNotFound',
  jira_rate_limited: 'errors.jiraRateLimited',
  jira_unavailable: 'errors.jiraUnavailable',
  invalid_request: 'errors.invalidRequest',
  jira_target_missing: 'errors.jiraTargetMissing',
  invalid_jira_base_url: 'errors.invalidJiraBaseUrl',
  failed_to_save: 'errors.failedToSave',
  token_refused: 'errors.jiraTokenRefused',
  link_not_saved: 'errors.jiraLinkNotSaved',
  server_restarting: 'errors.jiraServerRestarting',
  client_gone: 'errors.jiraClientGone',
  outcome_unknown: 'errors.jiraOutcomeUnknown'
};

describe('Jira error codes on screen', () => {
  const en = createTranslator('en');
  const fr = createTranslator('fr');

  it('pins a sentence for every code of the contract, and only for those', () => {
    expect(Object.keys(EXPECTED_KEY).sort()).toEqual([...CODES].sort());
  });

  it.each(CODES)('reads %s as its own sentence in both languages', (code) => {
    const key = EXPECTED_KEY[code];

    expect(translateErrorMessage(code, en)).toBe(en(key));
    expect(translateErrorMessage(code, fr)).toBe(fr(key));
    expect(en(key)).not.toBe(code);
    expect(fr(key)).not.toBe(en(key));
  });

  it('never reads two codes as one sentence, nor any as the generic one', () => {
    for (const t of [en, fr]) {
      const sentences = CODES.map(code => translateErrorMessage(code, t));
      expect(sentences).not.toContain(t('errors.unknown'));
      expect(new Set(sentences).size).toBe(CODES.length);
    }
  });

  it.each([
    'jira_token_missing',
    'jira_token_unusable',
    'token_refused',
    'jira_target_missing'
  ])('names where the team settings are, as the screens do, for %s', (code) => {
    // Each of these is fixed in the team's Jira settings, so its sentence says
    // where they are. The path is built from the Dashboard's own labels;
    // i18nJiraDictionary checks every sentence that names it.
    for (const t of [en, fr]) {
      const path = `${t('dashboard.tabs.SETTINGS')} → ${t('jira.settings.title')}`;
      expect(translateErrorMessage(code, t)).toContain(path);
    }
  });

  it('never presents a lost answer as a failure to create', () => {
    // The batch may have created issues: the sentence must send the user to
    // check Jira, not invite a second click.
    expect(translateErrorMessage('outcome_unknown', en)).toMatch(/Check Jira before creating them again/);
  });
});
