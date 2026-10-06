import { PASSWORD_MIN_LENGTH, PASSWORD_POLICY_MESSAGE } from '../utils/passwordPolicy.js';
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
  reset_failed: 'errors.resetFailed',
  invalid_or_expired_token: 'errors.resetTokenInvalid',
  missing_fields: 'errors.missingFields',
  too_many_attempts: 'errors.tooManyAttempts',
  team_name_exists: 'errors.teamNameExists',
  team_not_found: 'errors.teamNotFound',
  invalid_password: 'errors.invalidPassword',
  unknown_error: 'errors.unknown',
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
