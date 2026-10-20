// English messages for the "jira" namespace: every Jira control a team sees —
// the Review step's discovery note and reason line, the create buttons and
// their states, the batch dialog, and the Jira card of the Dashboard
// settings. Every key starts with "jira.". The super-admin console's Jira card
// is in the "admin" namespace (`admin.jira.*`), and the codes the Jira routes
// answer with are in "errors" (see i18n/errorMessages.ts).
//
// "Settings → Jira" names the Dashboard's Settings tab and the Jira card in it:
// keep it in step with `dashboard.tabs.SETTINGS` and `jira.settings.title`.
const jira = {
  // The create buttons
  'jira.create': 'Create in Jira',
  'jira.createCount_one': 'Create in Jira ({count})',
  'jira.createCount_other': 'Create in Jira ({count})',
  'jira.creating': 'Creating…',

  // The discovery note, shown once to everyone on a deployment with Jira. Its
  // last sentence follows who reads it and whether the team has a token.
  'jira.note.title': 'New: create your actions in Jira',
  'jira.note.body':
    'The actions of a retrospective or a health check can now be created in Jira in one click, each one linked to its issue.',
  'jira.note.facilitatorNoToken': 'To use it, add the team’s Jira access token in Settings → Jira on the team dashboard.',
  'jira.note.facilitatorSetUp': 'To use it, finish setting up Jira in Settings → Jira on the team dashboard.',
  'jira.note.facilitatorReady': 'The “Create in Jira” buttons are just below.',
  'jira.note.participant': 'Your facilitator can send the actions to Jira.',
  'jira.note.dismiss': 'Got it',

  // Why a facilitator cannot create, shown beside the unavailable control.
  'jira.reason.noToken': 'Jira is not connected for this team: add an access token in Settings → Jira.',
  'jira.reason.addressChanged':
    'The Jira address changed after the team’s token was saved: enter the token again in Settings → Jira.',
  'jira.reason.unreadable':
    'The team’s Jira token can no longer be read on this server: enter it again in Settings → Jira.',
  'jira.reason.refused': 'Jira refused the team’s token on {date}: replace it in Settings → Jira.',
  'jira.reason.noTarget': 'Choose where the issues are created in Settings → Jira.',

  // One action's control. Each accessible name starts with the visible text
  // (WCAG 2.5.3) and ends with the action, so a list of them stays apart.
  'jira.action.createLabel': 'Create in Jira, {text}',
  'jira.action.creatingLabel': 'Creating…, {text}',
  'jira.action.created': '{key} created',
  'jira.action.openLabel': '{key}, open in Jira (new tab)',
  'jira.action.plainKey': 'Jira: {key}',
  'jira.action.alreadyLinked': 'Already in Jira as {key}',
  'jira.action.notSaved': '{key} was created in Jira, but its link could not be saved here.',
  'jira.action.refused': 'Jira refused this issue:',
  'jira.action.refusedNoMessage': 'Jira refused this issue.',
  'jira.action.noText': 'This action has no text, so it cannot be created in Jira.',
  'jira.action.inProgress': 'This issue is being created from another window right now.',
  'jira.action.closed': 'This action is closed: it is not sent to Jira.',
  'jira.action.notFound': 'This action is not saved for the team yet. Try again in a moment.',
  'jira.action.uncertain': 'May already be in Jira: check it, then create anyway',
  'jira.action.uncertainBadge': 'May already be in Jira',
  'jira.action.check': 'Check in Jira',
  'jira.action.checkLabel': 'Check in Jira, {text} (new tab)',
  'jira.action.createAnyway': 'Create anyway',
  'jira.action.createAnywayLabel': 'Create anyway, {text}',
  // The confirmation "Create anyway" asks for before sending `force`.
  'jira.action.confirmForce': 'Create another issue for this action? Do it only if Jira has none for it.',
  'jira.action.confirmForceYes': 'Yes, create it',
  'jira.action.confirmForceYesLabel': 'Yes, create it, {text}',
  'jira.action.cancel': 'Cancel',

  // The batch dialog
  'jira.batch.title': 'Create the actions in Jira',
  'jira.batch.target.project': 'In the project {project}',
  'jira.batch.target.parent': 'As sub-tasks of {parent}',
  'jira.batch.target.issueType': 'Issue type: {type}',
  'jira.batch.target.labels': 'Labels: {labels}',
  'jira.batch.target.noLabels': 'No labels',
  'jira.batch.changeTarget': 'Change the target for this creation only',
  'jira.batch.previewHeading': 'What will be sent to Jira',
  'jira.batch.previewSummary': 'Summary',
  'jira.batch.previewDescription': 'Description',
  'jira.batch.confirm_one': 'Create {count} issue',
  'jira.batch.confirm_other': 'Create {count} issues',
  'jira.batch.progress': 'Creating: {done} of {total} sent…',
  'jira.batch.done': 'Finished.',
  'jira.batch.result.created_one': '{count} issue created',
  'jira.batch.result.created_other': '{count} issues created',
  'jira.batch.result.alreadyLinked_one': '{count} action was already in Jira',
  'jira.batch.result.alreadyLinked_other': '{count} actions were already in Jira',
  'jira.batch.result.notSaved_one': '{count} issue created, but its link could not be saved',
  'jira.batch.result.notSaved_other': '{count} issues created, but their links could not be saved',
  'jira.batch.result.refused_one': '{count} refused by Jira',
  'jira.batch.result.refused_other': '{count} refused by Jira',
  'jira.batch.result.noText_one': '{count} action has no text, so it cannot be created in Jira',
  'jira.batch.result.noText_other': '{count} actions have no text, so they cannot be created in Jira',
  'jira.batch.result.skipped_one': '{count} skipped: closed, not saved yet or being created elsewhere',
  'jira.batch.result.skipped_other': '{count} skipped: closed, not saved yet or being created elsewhere',
  'jira.batch.result.uncertain_one': '{count} may already be in Jira: check it before creating it again',
  'jira.batch.result.uncertain_other': '{count} may already be in Jira: check them before creating them again',
  'jira.batch.result.notSent_one': '{count} not sent',
  'jira.batch.result.notSent_other': '{count} not sent',
  'jira.batch.result.unknown_one': '{count} outcome unknown: check Jira before retrying',
  'jira.batch.result.unknown_other': '{count} outcomes unknown: check Jira before retrying',
  'jira.batch.resultsHeading': 'Result',
  'jira.batch.outcomeUnknown':
    'The answer from the server was lost, so some actions may have been created in Jira. Check Jira before creating them again.',
  'jira.batch.rateLimited_one': 'Jira asks to wait {count} second before creating more issues.',
  'jira.batch.rateLimited_other': 'Jira asks to wait {count} seconds before creating more issues.',
  'jira.batch.rateLimitedNoDelay': 'Jira asks to wait before creating more issues.',
  'jira.batch.tryAgain': 'Try again',
  'jira.batch.close': 'Close',
  'jira.batch.cancel': 'Cancel',

  // The Jira card of the Dashboard settings
  'jira.settings.title': 'Jira',
  'jira.settings.description':
    'Create this team’s actions in Jira. The token belongs to the team: anyone signed in to the team can create issues with it through RetroGemini, so a technical account is best.',
  'jira.settings.disabled':
    'Jira is not turned on for this server. Your administrator can turn it on in the administration console.',
  'jira.settings.disabledTokenStored': 'A Jira token is still stored for this team.',
  // The token check got a 404 from Jira's serverInfo or myself: the server's
  // configured address does not reach the REST API (a missing context path).
  'jira.settings.notFound':
    'Jira did not answer at the address this server is configured with. Ask your administrator to check the Jira base URL.',
  'jira.settings.tokenLabel': 'Jira access token',
  'jira.settings.emailLabel': 'Email (Jira Cloud only)',
  'jira.settings.tokenHelp':
    'On Jira Data Center or Server, create a personal access token in your Jira profile and leave the email empty. On Jira Cloud, enter the account’s email and a classic API token, not one “with scopes”; Cloud API tokens expire within a year.',
  'jira.settings.writeOnly': 'Once saved, the token is never shown again, not even in part.',
  'jira.settings.tokenRequired': 'Enter the token first.',
  // The status could not be read (an expired session, the network): never
  // "Jira is off", which would send the facilitator to the administrator.
  'jira.settings.loadFailed': 'The team’s Jira settings could not be read. Try again in a moment.',
  'jira.settings.retry': 'Try again',
  'jira.settings.connected': 'Connected to Jira as {name}, set on {date}',
  'jira.settings.connectedNoName': 'Connected to Jira, set on {date}',
  'jira.settings.deployment.Cloud': 'Jira Cloud',
  'jira.settings.deployment.Server': 'Jira Data Center or Server',
  'jira.settings.noToken': 'No token saved yet.',
  'jira.settings.addressChanged': 'The Jira address changed after this token was saved. Enter the token again.',
  'jira.settings.unreadable': 'This server can no longer read the saved token. Enter it again.',
  'jira.settings.refused': 'Jira refused this token on {date}. Replace it.',
  'jira.settings.save': 'Save the token',
  'jira.settings.saving': 'Checking with Jira…',
  'jira.settings.saved': 'Token saved',
  'jira.settings.replace': 'Replace the token',
  'jira.settings.remove': 'Remove the token',
  'jira.settings.removeConfirm':
    'Remove the team’s Jira token? Nobody in the team can create issues until a new one is saved.',
  'jira.settings.removed': 'Token removed',
  'jira.settings.cancel': 'Cancel',

  // Where issues are created: shared by the settings card and the batch dialog.
  'jira.target.title': 'Where issues are created',
  'jira.target.mode': 'Create as',
  'jira.target.modeProject': 'Project',
  'jira.target.modeParent': 'Sub-tasks of an issue',
  'jira.target.projectKey': 'Project key',
  'jira.target.projectKeyPlaceholder': 'TEAM',
  'jira.target.projectKeyInvalid': 'Enter a project key in capital letters, such as TEAM.',
  'jira.target.parentKey': 'Parent issue key',
  'jira.target.parentKeyPlaceholder': 'TEAM-123',
  'jira.target.parentKeyInvalid': 'Enter an issue key such as TEAM-123.',
  'jira.target.issueType': 'Issue type',
  'jira.target.issueTypeHint': 'The list comes from Jira, read with the team’s token.',
  'jira.target.subtaskTypeHint': 'Sub-task types of the parent issue’s project, read from Jira with the team’s token.',
  'jira.target.chooseType': 'Choose an issue type',
  'jira.target.loadTypes': 'Load the issue types',
  'jira.target.loadingTypes': 'Loading the issue types…',
  'jira.target.noTypes': 'Jira offers no issue type here.',
  'jira.target.labels': 'Labels',
  'jira.target.labelsHint': 'Separated by spaces or commas, at most 10. Leave empty for none.',
  'jira.target.labelsInvalid': 'Labels cannot be longer than 255 characters, and at most 10 are allowed.',
  'jira.target.save': 'Save the target',
  'jira.target.saved': 'Target saved',
  'jira.target.clear': 'Clear the target',
  'jira.target.cleared': 'Target cleared',
  'jira.target.none': 'No target chosen yet.',
};

export default jira;
