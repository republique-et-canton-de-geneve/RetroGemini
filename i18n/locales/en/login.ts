// English messages for the "login" namespace. Every key starts with "login.".
// English is the source language: keep this text identical to what the
// component rendered before it was translated.
const login = {
  'login.brand.tagline': 'Collaborative retrospectives that help your team grow, improve, and celebrate together.',
  'login.genericError': 'An error occurred',
  'login.emailPlaceholder': 'your@email.com',

  // Team picker
  'login.list.title': 'Your Teams',
  'login.list.newTeam': '+ New Team',
  'login.list.empty': 'No teams found. Create one to get started!',
  'login.list.searchPlaceholder': 'Search teams...',
  'login.list.clearSearch': 'Clear search',
  'login.list.favorites': 'Favorites',
  'login.list.allTeams': 'All Teams',
  'login.list.addFavorite': 'Add {teamName} to favorites',
  'login.list.removeFavorite': 'Remove {teamName} from favorites',
  // English printed the plural even for 1 ("1 members", "1 weeks ago") until
  // these strings moved into the dictionary; the `_one` forms now read as
  // singular in both languages.
  'login.list.memberCount_one': '{count} member',
  'login.list.memberCount_other': '{count} members',
  'login.list.lastActive': 'Last active: {when}',
  'login.list.lastConnection.never': 'Never',
  'login.list.lastConnection.justNow': 'Just now',
  'login.list.lastConnection.today': 'Today',
  'login.list.lastConnection.yesterday': 'Yesterday',
  'login.list.lastConnection.daysAgo': '{count} days ago',
  'login.list.lastConnection.weeksAgo_one': '{count} week ago',
  'login.list.lastConnection.weeksAgo_other': '{count} weeks ago',
  'login.list.lastConnection.monthsAgo_one': '{count} month ago',
  'login.list.lastConnection.monthsAgo_other': '{count} months ago',
  'login.list.lastConnection.yearsAgo_one': '{count} year ago',
  'login.list.lastConnection.yearsAgo_other': '{count} years ago',

  // Super admin entry
  'login.superAdmin.access': 'Super Admin Access',
  'login.superAdmin.title': 'Super Admin Login',
  'login.superAdmin.subtitle': 'Enter the super admin password to manage all teams',
  'login.superAdmin.passwordLabel': 'Super Admin Password',
  'login.superAdmin.submit': 'Access Admin Panel',
  'login.superAdmin.envHint': 'Set SUPER_ADMIN_PASSWORD environment variable on the server to enable this feature',
  'login.superAdmin.notConfigured': 'Super admin not configured on this server',
  'login.superAdmin.tooManyAttemptsRetryIn': 'Too many attempts. Try again in {retryAfter}.',
  'login.superAdmin.tooManyAttemptsLater': 'Too many attempts. Try again later.',
  'login.superAdmin.invalidPassword': 'Invalid super admin password',
  'login.superAdmin.authFailed': 'Failed to authenticate',

  // Create team
  'login.create.title': 'Create New Team',
  'login.create.nameLabel': 'Team Name',
  'login.create.namePlaceholder': 'e.g. Design Team',
  'login.create.passwordLabel': 'Create Password',
  'login.create.emailLabel': 'Recovery Email {optional}',
  'login.create.optional': '(optional)',
  'login.create.emailHint': 'To recover your password if you forget it',
  'login.create.submit': 'Create & Join',

  // Team login
  'login.signIn.title': 'Login to {teamName}',
  'login.signIn.subtitle': 'Enter the team password to continue.',
  'login.signIn.passwordLabel': 'Password',
  'login.signIn.submit': 'Enter Workspace',
  'login.signIn.forgotPassword': 'Forgot password?',

  // Guest join (invite link)
  'login.join.title': 'Join {teamName}',
  'login.join.subtitleSelect': 'Select your name from the list or add a new one',
  'login.join.subtitleNew': 'Enter your name to join',
  'login.join.pickerLabelNoEmail': 'Select a member without an email',
  'login.join.pickerLabel': 'Select Your Name',
  'login.join.linkEmailHint': 'If you already joined without an email, select your name to link this address to your profile.',
  'login.join.role.participant': 'participant',
  'login.join.role.facilitator': 'facilitator',
  'login.join.noEmailOnFile': 'No email on file',
  'login.join.or': 'OR',
  'login.join.notInList': "+ I'm not in the list",
  'login.join.joiningAs': 'Joining as {email}',
  'login.join.continue': 'Continue',
  'login.join.backToList': 'Back to member list',
  'login.join.nameLabel': 'Your Name',
  'login.join.namePlaceholder': 'e.g. John Doe',
  'login.join.recognized': 'We recognized you from a previous session. Your name was kept for consistency.',
  'login.join.submit': 'Join Retrospective',
  'login.join.footer': 'You will join as a participant',
  'login.join.selectMemberRequired': 'Please select a member from the list or choose to enter a new name.',
  'login.join.nameRequired': 'Please enter your name',

  // Forgot password
  'login.forgot.title': 'Forgot Password',
  'login.forgot.subtitle': 'Enter the recovery email for team {teamName}',
  'login.forgot.emailLabel': 'Recovery Email',
  'login.forgot.submit': 'Send Reset Link',
  'login.forgot.footer': 'An email will be sent with a link to reset your password',

  // Reset password (link from the email)
  'login.reset.title': 'Reset Password',
  'login.reset.subtitle': 'Enter your new password',
  'login.reset.newPasswordLabel': 'New Password',
  'login.reset.submit': 'Reset Password',
  'login.reset.invalidLink': 'The reset link is invalid or has expired',
  'login.reset.verifyThrottled': 'Too many password reset attempts from this network. Please wait a few minutes, then open the link again.',
  'login.reset.missingToken': 'Invalid reset link',
  'login.reset.success': 'Password updated for {teamName}. You can now log in.',
};

export default login;
