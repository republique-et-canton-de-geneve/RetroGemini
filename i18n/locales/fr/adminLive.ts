import type en from '../en/adminLive';

// French messages for the "adminLive" namespace. The type makes a missing or extra
// key a type-check error.
const adminLive: Record<keyof typeof en, string> = {
  'adminLive.heading': 'Sessions actives',
  'adminLive.empty': 'Aucune session active',
  'adminLive.emptyHint':
    'Les sessions apparaissent ici lorsque des utilisateurs rejoignent une rétrospective ou un bilan de santé.',
  'adminLive.safeToDeploy': 'Déploiement sans risque\u00a0: aucune session active',
  'adminLive.warningTitle': 'Sessions actives détectées',
  'adminLive.warning':
    '{sessions} session(s) avec {users} utilisateur(s) connecté(s). Attendez de préférence avant de déployer, pour ne pas interrompre ces sessions.',

  // Session cards
  'adminLive.type.healthcheck': 'Bilan de santé',
  'adminLive.type.retrospective': 'Rétrospective',
  'adminLive.live': 'EN DIRECT',
  'adminLive.team': 'Équipe\u00a0: {team}',
  'adminLive.connected': 'Connectés',
  'adminLive.phaseLine': 'Phase\u00a0: {phase}',
  'adminLive.statusLine': 'Statut\u00a0: {status}',
  'adminLive.statusValue.IN_PROGRESS': 'En cours',
  'adminLive.statusValue.CLOSED': 'Clôturée',
  'adminLive.participants': 'Participants connectés\u00a0:',
};

export default adminLive;
