import type en from '../en/adminLogs';

// French messages for the "adminLogs" namespace. The type makes a missing or extra
// key a type-check error.
const adminLogs: Record<keyof typeof en, string> = {
  'adminLogs.heading': 'Journaux du serveur',
  'adminLogs.clear': 'Effacer les journaux',
  'adminLogs.confirmClear': 'Voulez-vous vraiment effacer tous les journaux du serveur\u202f?',
  'adminLogs.cleared': 'Journaux du serveur effacés',

  // Filters
  'adminLogs.levelLabel': 'Niveau\u00a0:',
  'adminLogs.levelAll': 'Tous les niveaux',
  'adminLogs.levelFilter.error': 'Erreurs',
  'adminLogs.levelFilter.warn': 'Avertissements',
  'adminLogs.levelFilter.info': 'Informations',
  'adminLogs.sourceLabel': 'Source\u00a0:',
  'adminLogs.sourceAll': 'Toutes les sources',
  'adminLogs.sourceFilter.postgres': 'PostgreSQL',
  'adminLogs.sourceFilter.server': 'Serveur',
  'adminLogs.sourceFilter.socket': 'Socket.IO',
  'adminLogs.sourceFilter.email': 'E-mail',
  'adminLogs.entries_one': '{count} entrée de journal',
  'adminLogs.entries_other': '{count} entrées de journal',

  // Table
  'adminLogs.empty': 'Aucun journal à afficher',
  'adminLogs.emptyHint': 'Les erreurs et avertissements du serveur apparaissent ici lorsqu’ils se produisent.',
  'adminLogs.column.timestamp': 'Horodatage',
  'adminLogs.column.level': 'Niveau',
  'adminLogs.column.source': 'Source',
  'adminLogs.column.message': 'Message',
  'adminLogs.level.error': 'erreur',
  'adminLogs.level.warn': 'avertissement',
  'adminLogs.level.info': 'info',
  'adminLogs.source.postgres': 'postgres',
  'adminLogs.source.server': 'serveur',
  'adminLogs.source.socket': 'socket',
  'adminLogs.source.email': 'e-mail',
};

export default adminLogs;
