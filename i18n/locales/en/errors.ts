// English text of the errors the data layer raises and the screens display.
// Every key starts with "errors.". The English values are the exact messages
// services/dataService.ts throws (see i18n/errorMessages.ts for the mapping),
// so a change to one of those messages must be mirrored here.
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
  'errors.tooManyAttempts': 'Too many attempts. Please wait a few minutes and try again.',
  'errors.unknown': 'Something went wrong. Please try again.',
};

export default errors;
