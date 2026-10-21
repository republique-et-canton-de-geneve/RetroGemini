import { PASSWORD_MIN_LENGTH, PASSWORD_POLICY_MESSAGE } from '../utils/passwordPolicy.js';
import {
  INVALID_EMAIL_ERROR,
  INVALID_EMAIL_MESSAGE,
  RECOVERY_EMAIL_REQUIRED_ERROR,
  RECOVERY_EMAIL_REQUIRED_MESSAGE
} from '../utils/emailAddress.js';
import { INVALID_JIRA_LABELS_ERROR, INVALID_JIRA_TARGET_ERROR } from '../utils/jira.js';
import { MessageKey, Translator } from './translate';

/**
 * The data layer throws `Error`s with English sentences, and the screens show
 * `err.message`. Translating at the display point instead of in the data layer
 * keeps those messages — which the unit tests pin, and which also travel to the
 * console — stable, while the user reads them in their own language.
 *
 * Server error codes the data layer passes through untouched are listed too,
 * so a user never reads `too_many_attempts` raw.
 */
const KNOWN_ERRORS: Record<string, MessageKey> = {
  'Unable to generate an invite link': 'errors.inviteLinkFailed',
  'Team name cannot be empty': 'errors.teamNameEmpty',
  'Team name already exists': 'errors.teamNameExists',
  'A team with this name already exists': 'errors.teamNameTaken',
  'Failed to create team': 'errors.createTeamFailed',
  'Team not found': 'errors.teamNotFound',
  'Invalid password': 'errors.invalidPassword',
  'Login failed': 'errors.loginFailed',
  'Member not found': 'errors.memberNotFound',
  'Name cannot be empty': 'errors.nameEmpty',
  'Another member already uses this email': 'errors.emailInUse',
  'Valid email required': 'errors.validEmailRequired',
  'The team could not be deleted. Please try again.': 'errors.deleteTeamFailed',
  'The recovery email could not be saved. Please try again.': 'errors.recoveryEmailNotSaved',
  // The shared email rule (utils/emailAddress.js): the sentence the data layer
  // throws, and the code every write path answers with.
  [INVALID_EMAIL_MESSAGE]: 'errors.invalidEmail',
  [INVALID_EMAIL_ERROR]: 'errors.invalidEmail',
  [RECOVERY_EMAIL_REQUIRED_MESSAGE]: 'errors.recoveryEmailRequired',
  [RECOVERY_EMAIL_REQUIRED_ERROR]: 'errors.recoveryEmailRequired',
  'Failed to join team - invalid invite link': 'errors.invalidInviteLink',
  'This name is reserved. Please use a different name or contact the team administrator.': 'errors.nameReserved',
  'An invitation is required to join this team.': 'errors.invitationRequired',
  'Invitation could not be verified. Please join manually.': 'errors.invitationNotVerified',
  'Template not found': 'errors.templateNotFound',
  'Current password required': 'errors.currentPasswordRequired',
  'Current password is incorrect': 'errors.currentPasswordIncorrect',
  'Failed to change password': 'errors.changePasswordFailed',
  'Too many requests right now — please wait a moment and try renaming again': 'errors.renameRateLimited',
  'Could not check whether that team name is available — please try again': 'errors.renameCheckFailed',
  'Password reset by email is not available on this server. Please contact your administrator.': 'errors.resetUnavailable',
  'If the team and email match, a reset link has been sent.': 'errors.resetRequested',
  'Too many password reset attempts from this network. Please wait a few minutes and try again.': 'errors.resetRateLimited',
  'Password reset successfully': 'errors.resetSucceeded',
  // What `/api/super-admin/test-ai` puts in `message` when it has no upstream
  // detail to report; an upstream error's own text is shown as it came.
  'AI is not enabled or not configured': 'errors.aiNotConfigured',
  'Connection failed': 'errors.connectionFailed',
  reset_failed: 'errors.resetFailed',
  invalid_or_expired_token: 'errors.resetTokenInvalid',
  missing_fields: 'errors.missingFields',
  login_failed: 'errors.loginFailed',
  failed_to_create: 'errors.createTeamFailed',
  too_many_attempts: 'errors.tooManyAttempts',
  team_name_exists: 'errors.teamNameExists',
  team_not_found: 'errors.teamNotFound',
  invalid_password: 'errors.invalidPassword',
  invalid_token: 'errors.invalidToken',
  too_many_requests: 'errors.tooManyRequests',
  unknown_error: 'errors.unknown',
  // The Jira routes: services/jiraService.ts rejects with the route's code as
  // the message, and a batch's stop code is shown the same way. Jira's own
  // refusal of one issue is shown as Jira wrote it, never through this table.
  jira_not_configured: 'errors.jiraNotConfigured',
  jira_token_missing: 'errors.jiraTokenMissing',
  jira_token_unusable: 'errors.jiraTokenUnusable',
  jira_secret_unavailable: 'errors.jiraSecretUnavailable',
  jira_auth_failed: 'errors.jiraAuthFailed',
  jira_auth_failed_cloud: 'errors.jiraAuthFailedCloud',
  jira_forbidden: 'errors.jiraForbidden',
  jira_not_found: 'errors.jiraNotFound',
  jira_parent_invalid: 'errors.jiraParentInvalid',
  jira_parent_refused: 'errors.jiraParentRefused',
  jira_rate_limited: 'errors.jiraRateLimited',
  jira_unavailable: 'errors.jiraUnavailable',
  jira_unreachable: 'errors.jiraUnreachable',
  jira_target_missing: 'errors.jiraTargetMissing',
  jira_target_refused: 'errors.jiraTargetRefused',
  [INVALID_JIRA_TARGET_ERROR]: 'errors.invalidJiraTarget',
  [INVALID_JIRA_LABELS_ERROR]: 'errors.invalidJiraLabels',
  invalid_jira_base_url: 'errors.invalidJiraBaseUrl',
  invalid_request: 'errors.invalidRequest',
  failed_to_save: 'errors.failedToSave',
  failed_to_load: 'errors.failedToLoad',
  failed_to_delete: 'errors.failedToDelete',
  // The console's Jira card: a refused super-admin credential, and what its
  // test can report besides the codes above (`test-jira` answers Jira's own
  // failure as `{ ok: false, error }`, and 500 `jira_test_failed` when the
  // test itself could not run).
  unauthorized: 'admin.notice.sessionExpired',
  jira_refused: 'errors.jiraRefused',
  jira_redirect: 'errors.jiraRedirect',
  jira_test_failed: 'admin.jira.testUnavailable',
  // The single-team restore of a deleted team that left a Jira token behind.
  team_secret_delete_failed: 'adminBackups.teamRestore.error.secretDeleteFailed',
  token_refused: 'errors.jiraTokenRefused',
  link_not_saved: 'errors.jiraLinkNotSaved',
  server_restarting: 'errors.jiraServerRestarting',
  client_gone: 'errors.jiraClientGone',
  outcome_unknown: 'errors.jiraOutcomeUnknown',
};

/**
 * The message in the user's language when it is one the data layer is known to
 * raise; anything else (a browser network error, a message from a newer server)
 * is shown as it came, which is still more useful than a generic sentence.
 */
export const translateErrorMessage = (message: string | undefined | null, t: Translator): string => {
  if (!message) return t('errors.unknown');
  if (message === PASSWORD_POLICY_MESSAGE) {
    return t('errors.passwordTooShort', { min: PASSWORD_MIN_LENGTH });
  }
  const key = KNOWN_ERRORS[message];
  return key ? t(key) : message;
};
