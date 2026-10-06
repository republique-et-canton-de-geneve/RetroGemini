import type en from '../en/adminTeams';

// French messages for the "adminTeams" namespace. The type makes a missing or extra
// key a type-check error.
const adminTeams: Record<keyof typeof en, string> = {
  'adminTeams.loading': 'Chargement des équipes…',
  'adminTeams.heading': 'Équipes ({count})',

  // Table
  'adminTeams.column.name': 'Nom de l’équipe',
  'adminTeams.column.members': 'Membres',
  'adminTeams.column.email': 'E-mail de récupération',
  'adminTeams.column.lastActive': 'Dernière activité',
  'adminTeams.id': 'ID\u00a0: {id}',
  'adminTeams.memberCount_one': '{count} membre',
  'adminTeams.memberCount_other': '{count} membres',
  'adminTeams.emailNotConfigured': 'Non configuré',
  'adminTeams.never': 'Jamais',
  'adminTeams.empty': 'Aucune équipe trouvée',

  // Row editors
  'adminTeams.namePlaceholder': 'Nom de l’équipe',
  'adminTeams.emailPlaceholder': 'email@example.com',
  'adminTeams.passwordPlaceholder': 'Nouveau mot de passe ({min} caractères min.)',
  'adminTeams.rename': 'Renommer',
  'adminTeams.renameTitle': 'Renommer l’équipe',
  'adminTeams.changePassword': 'Changer le mot de passe',
  'adminTeams.changePasswordTitle': 'Changer le mot de passe de l’équipe',
  'adminTeams.editEmail': 'Modifier l’e-mail',
  'adminTeams.editEmailTitle': 'Modifier l’e-mail de récupération',

  // Notices
  'adminTeams.notice.loadFailed': 'Le chargement des équipes a échoué',
  'adminTeams.notice.emailFailed': 'La mise à jour de l’e-mail a échoué',
  'adminTeams.notice.emailSaved': 'E-mail mis à jour',
  'adminTeams.notice.passwordFailed': 'La mise à jour du mot de passe a échoué',
  'adminTeams.notice.passwordSaved': 'Mot de passe mis à jour',
  // Same English as the dashboard's rename notices, so the same French
  // (dashboard.settings.renamed / renameFailed).
  'adminTeams.notice.renameFailed': 'Impossible de renommer l’équipe',
  'adminTeams.notice.renamed': 'Équipe renommée avec succès',
};

export default adminTeams;
