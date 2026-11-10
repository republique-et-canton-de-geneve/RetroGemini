// English messages for the "adminTeams" namespace (the super-admin Teams tab). Every key starts
// with "adminTeams.". English is the source language: keep this text identical to
// what the console rendered before it was translated.
const adminTeams = {
  'adminTeams.loading': 'Loading teams...',
  'adminTeams.heading': 'Teams ({count})',

  // Table
  'adminTeams.column.name': 'Team Name',
  'adminTeams.column.members': 'Members',
  'adminTeams.column.retrospectives': 'Retrospectives',
  'adminTeams.column.email': 'Recovery Email',
  'adminTeams.column.lastActive': 'Last Active',
  'adminTeams.id': 'ID: {id}',
  'adminTeams.memberCount_one': '{count} member',
  'adminTeams.memberCount_other': '{count} members',
  'adminTeams.retrospectiveCount_one': '{count} retrospective',
  'adminTeams.retrospectiveCount_other': '{count} retrospectives',
  // A pod of an earlier release, during a rolling update, sends no count.
  'adminTeams.retrospectiveCountUnknown': 'Unknown',
  'adminTeams.emailNotConfigured': 'Not configured',
  'adminTeams.never': 'Never',
  'adminTeams.empty': 'No teams found',

  // Row editors
  'adminTeams.namePlaceholder': 'Team name',
  'adminTeams.emailPlaceholder': 'email@example.com',
  'adminTeams.passwordPlaceholder': 'New password (min {min} chars)',
  'adminTeams.rename': 'Rename',
  'adminTeams.renameTitle': 'Rename team',
  'adminTeams.changePassword': 'Change Password',
  'adminTeams.changePasswordTitle': 'Change team password',
  'adminTeams.editEmail': 'Edit Email',
  'adminTeams.editEmailTitle': 'Edit recovery email',

  // Notices
  'adminTeams.notice.loadFailed': 'Failed to load teams',
  'adminTeams.notice.emailFailed': 'Failed to update email',
  'adminTeams.notice.emailSaved': 'Email updated successfully',
  'adminTeams.notice.emailInvalid': 'Enter one valid email address, or leave the field empty',
  'adminTeams.notice.passwordFailed': 'Failed to update password',
  'adminTeams.notice.passwordSaved': 'Password updated. Everyone signed in to this team has been signed out.',
  'adminTeams.notice.renameFailed': 'Failed to rename team',
  'adminTeams.notice.renamed': 'Team renamed successfully',
};

export default adminTeams;
