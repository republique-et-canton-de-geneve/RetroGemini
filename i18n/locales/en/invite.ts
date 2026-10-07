// English messages for the "invite" namespace. Every key starts with "invite.".
// English is the source language: keep this text identical to what the
// component rendered before it was translated.
const invite = {
  'invite.title': 'Invite teammates to {teamName}',
  'invite.subtitle': 'Choose how you want to invite participants.',
  'invite.tab.email': 'EMAIL',
  'invite.tab.link': 'CODE & LINK',
  'invite.tab.wifi': 'WI-FI',
  'invite.copy': 'COPY',
  'invite.testAnotherUser': 'Want to test as another user?',
  'invite.logoutAndCreate': 'Logout & Create New User',
  'invite.done': 'Done',

  // Email tab
  'invite.email.heading': 'Invite by email',
  'invite.email.description': 'Paste one or more email addresses to send personal links.',
  'invite.email.teamMembers': 'Team members',
  'invite.email.selectAll': 'Select all',
  'invite.email.unselectAll': 'Unselect all',
  'invite.email.placeholder': 'e.g. teammate@example.com, other@company.com',
  'invite.email.send': 'Send invites',
  'invite.email.sending': 'Sending…',
  'invite.email.sendingStatus': 'Sending invites…',
  'invite.email.readyCount_one': '{count} invite ready to share',
  'invite.email.readyCount_other': '{count} invites ready to share',
  'invite.email.noneCreated': 'No invites created',
  'invite.email.errorLine': '{email}: {message}',
  'invite.email.notConfigured': 'Email service not configured',
  'invite.email.sessionExpired': 'Session expired, please log in again',
  'invite.email.sendFailed': 'Failed to send email',
  'invite.email.generateFailed': 'Unable to generate invite',
  'invite.email.linksReady': 'Invite links ready',

  // Link / QR tab
  'invite.link.heading': 'Share via link or QR code',
  'invite.link.description': 'Anyone can join and choose their name after scanning.',
  'invite.link.qrAlt': 'QR Code',
  'invite.link.generating': 'Generating link…',

  // Wi-Fi tab
  'invite.wifi.heading': 'Connect to Wi-Fi',
  'invite.wifi.description': 'Scan this QR code with your phone to join the network.',
  'invite.wifi.qrAlt': 'Wi-Fi QR Code',
  'invite.wifi.network': 'Network',
  'invite.wifi.password': 'Password',
  'invite.wifi.showPassword': 'Show Wi-Fi password',
  'invite.wifi.hidePassword': 'Hide Wi-Fi password',
  'invite.wifi.hint': 'Once connected, open the invite link or scan the session QR code to join.',
};

export default invite;
