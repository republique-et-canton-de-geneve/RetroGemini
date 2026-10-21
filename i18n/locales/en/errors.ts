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
  'errors.invalidEmail': 'Enter one valid email address',
  'errors.recoveryEmailRequired': 'Enter a recovery email: it is the only way to reset the password if it is forgotten',
  'errors.deleteTeamFailed': 'The team could not be deleted. Please try again.',
  'errors.recoveryEmailNotSaved': 'The recovery email could not be saved. Please try again.',
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
  // The super-admin console's LLM connection test (`/api/super-admin/test-ai`).
  'errors.aiNotConfigured': 'AI is not enabled or not configured',
  'errors.connectionFailed': 'Connection failed',
  // A team credential the server no longer accepts, and the per-IP limiters.
  'errors.invalidToken': 'Your session has expired. Please sign in to the team again.',
  'errors.tooManyRequests': 'Too many requests right now. Please wait a moment and try again.',
  // The Jira routes (`/api/team/:teamId/jira/*`, `/api/super-admin/*jira*`)
  // and the codes a `/jira/issues` batch stops with. Jira's own refusal of one
  // issue is shown as Jira wrote it, never through these.
  'errors.jiraNotConfigured': 'Jira is not set up on this server. Ask your administrator to turn it on.',
  'errors.jiraTokenMissing': 'Enter the team’s Jira access token in Settings → Jira.',
  'errors.jiraTokenUnusable': 'The team’s Jira token can no longer be used: enter it again in Settings → Jira.',
  'errors.jiraTokenRefused': 'Jira refused the team’s token: replace it in Settings → Jira. The remaining actions were not sent.',
  'errors.jiraSecretUnavailable':
    'This server cannot store a Jira token safely yet. Ask your administrator to set a stable SESSION_TOKEN_SECRET.',
  'errors.jiraAuthFailed': 'Jira refused this token. Check it, then try again.',
  'errors.jiraAuthFailedCloud':
    'Jira Cloud refused this email and token. Use the email of the token’s account and a classic API token, not one “with scopes”.',
  'errors.jiraForbidden': 'Jira refused: the account of the team’s token is not allowed to do this.',
  'errors.jiraNotFound': 'Jira found no such project or issue, or the account of the team’s token cannot see it.',
  'errors.jiraParentInvalid': 'This issue cannot hold sub-tasks: choose an issue that is neither a sub-task nor an epic.',
  'errors.jiraParentRefused':
    'Jira refused to create a parent issue, so the other actions were not sent: check the type of the parent issue and the labels in Settings → Jira.',
  'errors.jiraRateLimited': 'Jira asks to wait before more requests. Try again in a moment.',
  'errors.jiraUnavailable': 'Jira is not available right now. Try again in a moment.',
  'errors.jiraUnreachable': 'Jira could not be reached. Try again in a moment, or ask your administrator to check the connection.',
  'errors.jiraTargetMissing': 'Choose where the issues are created in Settings → Jira first.',
  'errors.jiraTargetRefused':
    'Jira refused the target set in Settings → Jira, so the other actions were not sent: check its project, issue type and labels.',
  'errors.invalidJiraTarget': 'This Jira target is not valid: check the project or issue key and the issue type.',
  'errors.invalidJiraLabels': 'A label is not valid: labels contain no spaces, at most 255 characters each and 10 in all.',
  'errors.invalidJiraBaseUrl':
    'Enter the address Jira opens at, starting with https:// (http:// only on localhost), with no user name, query or fragment.',
  'errors.invalidRequest': 'The request was not valid. Reload the page and try again.',
  'errors.failedToSave': 'The settings could not be saved. Please try again.',
  'errors.failedToLoad': 'The information could not be loaded. Please try again.',
  'errors.failedToDelete': 'The deletion failed. Please try again.',
  // What the console's Jira test can say Jira answered, besides the codes above.
  'errors.jiraRefused': 'Jira refused the request.',
  'errors.jiraRedirect': 'This address answers with a redirect, not with Jira’s REST API.',
  'errors.jiraLinkNotSaved':
    'An issue was created in Jira, but its link could not be saved here. The remaining actions were not sent.',
  'errors.jiraServerRestarting': 'The server is restarting: the remaining actions were not sent. Try again in a moment.',
  'errors.jiraClientGone': 'The request was interrupted: the remaining actions were not sent.',
  'errors.jiraOutcomeUnknown':
    'The answer from the server was lost, so some actions may have been created in Jira. Check Jira before creating them again.',
  'errors.unknown': 'Something went wrong. Please try again.',
};

export default errors;
