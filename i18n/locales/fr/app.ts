import type en from '../en/app';

const app: Record<keyof typeof en, string> = {
  'app.loadingWorkspace': "Chargement de l'espace de travail…",
  'app.whatsNew': 'Nouveautés',
  'app.user': 'Utilisateur',
  'app.logoutTeam': "Déconnecter l'équipe",
};

export default app;
