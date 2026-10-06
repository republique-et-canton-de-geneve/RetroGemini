import type en from '../en/adminBackups';

// French messages for the "adminBackups" namespace. The type makes a missing or extra
// key a type-check error.
const adminBackups: Record<keyof typeof en, string> = {
  // Configuration summary
  'adminBackups.config.title': 'Configuration',
  'adminBackups.config.auto': 'Sauvegardes automatiques\u00a0: {value}',
  'adminBackups.config.enabled': 'Activées',
  'adminBackups.config.disabled': 'Désactivées',
  'adminBackups.config.interval': 'Intervalle\u00a0: {value}',
  'adminBackups.config.hours': '{hours}\u00a0h',
  'adminBackups.config.maxCount': 'Nombre maximal conservé\u00a0: {value}',
  'adminBackups.config.onStartup': 'Sauvegarde au démarrage\u00a0: {value}',
  'adminBackups.config.directory': 'Répertoire\u00a0: {value}',

  // Checkpoint
  'adminBackups.checkpoint.create': 'Créer un point de contrôle',
  'adminBackups.checkpoint.placeholder': 'Libellé facultatif (p. ex. Avant la mise à jour v10)',
  'adminBackups.checkpoint.creating': 'Création…',

  // List
  'adminBackups.loading': 'Chargement des sauvegardes…',
  'adminBackups.empty': 'Aucune sauvegarde pour le moment',
  'adminBackups.emptyHint':
    'Les sauvegardes apparaissent ici après la première sauvegarde planifiée ou lorsque vous créez un point de contrôle.',
  'adminBackups.column.type': 'Type',
  'adminBackups.column.label': 'Libellé / date',
  'adminBackups.column.teams': 'Équipes',
  'adminBackups.column.size': 'Taille',
  'adminBackups.column.protected': 'Protégée',
  'adminBackups.type.auto': 'auto',
  'adminBackups.type.manual': 'manuelle',
  'adminBackups.type.startup': 'démarrage',
  'adminBackups.label.startup': 'Démarrage du serveur',
  'adminBackups.label.preRestore': 'Instantané avant restauration',
  'adminBackups.size.bytes': '{size}\u00a0o',
  'adminBackups.size.kilobytes': '{size}\u00a0Ko',
  'adminBackups.size.megabytes': '{size}\u00a0Mo',
  'adminBackups.protected.on': 'Protégée du nettoyage automatique',
  'adminBackups.protected.off': 'Cliquez pour la protéger du nettoyage automatique',
  'adminBackups.download': 'Télécharger',
  'adminBackups.downloadLabel': 'Télécharger la sauvegarde',
  'adminBackups.restore': 'Restaurer',
  'adminBackups.restoreLabel': 'Restaurer la sauvegarde',
  'adminBackups.delete': 'Supprimer',
  'adminBackups.deleteLabel': 'Supprimer la sauvegarde',
  'adminBackups.confirm.restore':
    'Restaurer les données de la sauvegarde «\u00a0{name}\u00a0»\u202f?\n\nUn instantané sera créé automatiquement avant la restauration.',
  'adminBackups.confirm.delete': 'Supprimer la sauvegarde «\u00a0{name}\u00a0»\u202f?',

  // Notices
  'adminBackups.notice.inProgress': 'Une sauvegarde est déjà en cours. Veuillez patienter.',
  'adminBackups.notice.createFailed': 'La création du point de contrôle a échoué',
  'adminBackups.notice.created': 'Point de contrôle créé',
  'adminBackups.notice.restoreFailed': 'La restauration de la sauvegarde a échoué',
  'adminBackups.notice.restored': 'Données restaurées',
  'adminBackups.notice.deleted': 'Sauvegarde supprimée',
  'adminBackups.notice.deleteFailed': 'La suppression de la sauvegarde a échoué',
  'adminBackups.notice.updateFailed': 'La mise à jour de la sauvegarde a échoué',
};

export default adminBackups;
