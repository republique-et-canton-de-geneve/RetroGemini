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
  'adminBackups.label.preDelete': 'Instantané avant suppression',
  'adminBackups.size.bytes': '{size}\u00a0o',
  'adminBackups.size.kilobytes': '{size}\u00a0Ko',
  'adminBackups.size.megabytes': '{size}\u00a0Mo',
  'adminBackups.protected.on': 'Protégée du nettoyage automatique',
  'adminBackups.protected.off': 'Cliquez pour la protéger du nettoyage automatique',
  'adminBackups.download': 'Télécharger',
  'adminBackups.downloadLabel': 'Télécharger la sauvegarde',
  'adminBackups.restore': 'Restaurer',
  'adminBackups.restoreLabel': 'Restaurer la sauvegarde',
  'adminBackups.restoreTeam': 'Restaurer une équipe',
  'adminBackups.restoreTeamLabel': 'Restaurer une seule équipe depuis cette sauvegarde',
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
  'adminBackups.notice.restoreInProgress': 'Une autre restauration est en cours. Attendez qu’elle se termine, puis réessayez.',
  'adminBackups.notice.deleted': 'Sauvegarde supprimée',
  'adminBackups.notice.deleteFailed': 'La suppression de la sauvegarde a échoué',
  'adminBackups.notice.updateFailed': 'La mise à jour de la sauvegarde a échoué',

  // Restaurer une seule équipe
  'adminBackups.teamRestore.title': 'Restaurer une équipe',
  'adminBackups.teamRestore.subtitle': 'Depuis la sauvegarde «\u00a0{name}\u00a0». Les autres équipes ne sont pas modifiées.',
  'adminBackups.teamRestore.loading': 'Lecture de la sauvegarde…',
  'adminBackups.teamRestore.empty': 'Cette sauvegarde ne contient aucune équipe.',
  'adminBackups.teamRestore.search': 'Rechercher une équipe',
  'adminBackups.teamRestore.listLabel': 'Équipes de cette sauvegarde',
  'adminBackups.teamRestore.noResult': 'Aucune équipe ne correspond à cette recherche.',
  'adminBackups.teamRestore.status.present': 'Existe',
  'adminBackups.teamRestore.status.renamed': 'Renommée depuis\u00a0: {name}',
  'adminBackups.teamRestore.status.deleted': 'Supprimée depuis',
  'adminBackups.teamRestore.counts':
    'Rétrospectives\u00a0: {retrospectives} · Bilans de santé\u00a0: {healthChecks} · Actions du backlog\u00a0: {actions} · Membres\u00a0: {members}',
  'adminBackups.teamRestore.explainExisting':
    'Ses rétrospectives, bilans de santé, backlog, membres et modèles reviennent à l’état de cette sauvegarde. Son nom, son mot de passe, son e-mail de récupération et ses retours restent tels qu’ils sont aujourd’hui.',
  'adminBackups.teamRestore.explainDeleted':
    'Cette équipe a été supprimée après cette sauvegarde. Elle revient avec le mot de passe et l’e-mail de récupération qu’elle avait alors, et avec les retours conservés depuis sa suppression.',
  'adminBackups.teamRestore.explainDeletedJira':
    'Si l’équipe utilisait Jira, elle revient sans son jeton Jira, et les actions envoyées à Jira après cette sauvegarde apparaissent comme absentes de Jira\u00a0: vérifiez dans Jira avant de les créer à nouveau.',
  'adminBackups.teamRestore.explainLive':
    'Les personnes qui se trouvent dans l’une de ses sessions la voient aussi revenir en arrière. Un instantané de toutes les données est créé auparavant.',
  'adminBackups.teamRestore.nameLabel': 'Nom de l’équipe restaurée',
  'adminBackups.teamRestore.nameTaken': 'Une autre équipe s’appelle désormais «\u00a0{name}\u00a0»\u00a0: choisissez un autre nom.',
  'adminBackups.teamRestore.pick': 'Choisissez une équipe',
  'adminBackups.teamRestore.confirm': 'Restaurer {name}',
  'adminBackups.teamRestore.restoring': 'Restauration…',
  'adminBackups.teamRestore.restored': '{name} a été restaurée depuis la sauvegarde',
  'adminBackups.teamRestore.restoredFeedbacksTwice':
    '{name} a été restaurée depuis la sauvegarde, mais certains de ses retours apparaissent désormais deux fois\u00a0: supprimez la copie en trop dans l’onglet Retours.',
  'adminBackups.teamRestore.restoredWithWarnings':
    '{name} a été restaurée depuis la sauvegarde, mais certaines de ses sessions ouvertes n’ont pas pu être mises à jour (demandez aux personnes présentes de recharger la page) et certains de ses retours apparaissent désormais deux fois (supprimez la copie en trop dans l’onglet Retours).',
  'adminBackups.teamRestore.restoredSessionsBehind':
    '{name} a été restaurée depuis la sauvegarde, mais certaines de ses sessions ouvertes n’ont pas pu être mises à jour\u00a0: demandez aux personnes présentes de recharger la page.',
  'adminBackups.teamRestore.error.listFailed': 'Impossible de lire les équipes de cette sauvegarde',
  'adminBackups.teamRestore.error.failed': 'La restauration de l’équipe a échoué',
  'adminBackups.teamRestore.error.backupNotFound': 'Cette sauvegarde n’existe plus.',
  'adminBackups.teamRestore.error.notInBackup': 'Cette équipe ne figure pas dans cette sauvegarde.',
  'adminBackups.teamRestore.error.malformed':
    'Les données de cette équipe dans la sauvegarde ne peuvent pas être restaurées ({fields}). Rien n’a été modifié.',
  'adminBackups.teamRestore.error.teamChanged':
    'L’équipe a été supprimée ou recréée entre-temps. Rien n’a été modifié\u00a0: réessayez.',
  'adminBackups.teamRestore.error.snapshotFailed':
    'L’instantané de sécurité n’a pas pu être créé, rien n’a donc été restauré.',
  'adminBackups.teamRestore.error.sessionReadFailed':
    'Une session de cette équipe n’a pas pu être lue. Rien n’a été modifié\u00a0: réessayez dans un instant.',
  'adminBackups.teamRestore.error.secretDeleteFailed':
    'Le jeton Jira que cette équipe supprimée a laissé n’a pas pu être retiré, rien n’a donc été restauré. Réessayez dans un instant.',
};

export default adminBackups;
