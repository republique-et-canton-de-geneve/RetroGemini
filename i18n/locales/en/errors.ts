// English text of the errors the data layer raises and the screens display.
// Every key starts with "errors.". Most English values are the exact messages
// services/dataService.ts throws (see i18n/errorMessages.ts for the mapping),
// so a change to one of those messages must be mirrored here —
// i18nRobustness.test.ts fails on a thrown message with no translation. The
// rest give a sentence to a raw server code (`reset_failed`, `login_failed`…)
// that the screens used to print as is, in English too.
const errors = {
  'errors.inviteLinkFailed': 'Unable to generate an invite link',
  'errors.teamNameEmpty': 'Team name cannot be empty',
  'errors.teamNameExists': 'Team name already exists',
  'errors.teamNameTaken': 'A team with this name already exists',
  'errors.passwordTooShort': 'Password must be at least {min} characters',
  'errors.createTeamFailed': 'Failed to create team',
  'errors.teamNotFound': 'Team not found',
  'errors.invalidPassword': 'Invalid password',
  'errors.loginFailed': 'Login failed',
  'errors.memberNotFound': 'Member not found',
  'errors.nameEmpty': 'Name cannot be empty',
  'errors.emailInUse': 'Another member already uses this email',
  'errors.validEmailRequired': 'Valid email required',
  'errors.invalidInviteLink': 'Failed to join team - invalid invite link',
  'errors.nameReserved': 'This name is reserved. Please use a different name or contact the team administrator.',
  'errors.invitationRequired': 'An invitation is required to join this team.',
  'errors.invitationNotVerified': 'Invitation could not be verified. Please join manually.',
  'errors.templateNotFound': 'Template not found',
  'errors.currentPasswordRequired': 'Current password required',
  'errors.currentPasswordIncorrect': 'Current password is incorrect',
  'errors.changePasswordFailed': 'Failed to change password',
  'errors.renameRateLimited': 'Too many requests right now — please wait a moment and try renaming again',
  'errors.renameCheckFailed': 'Could not check whether that team name is available — please try again',
  'errors.resetUnavailable': 'Password reset by email is not available on this server. Please contact your administrator.',
  'errors.resetRequested': 'If the team and email match, a reset link has been sent.',
  'errors.resetRateLimited': 'Too many password reset attempts from this network. Please wait a few minutes and try again.',
  'errors.resetSucceeded': 'Password reset successfully',
  'errors.resetFailed': 'The password could not be reset. Please try again.',
  'errors.resetTokenInvalid': 'This reset link is invalid or has expired. Please request a new one.',
  'errors.missingFields': 'Please fill in all required fields.',
  'errors.tooManyAttempts': 'Too many attempts. Please wait a few minutes and try again.',
  'errors.unknown': 'Something went wrong. Please try again.',
};

export default errors;
