import type en from '../en/app';

const app: Record<keyof typeof en, string> = {
  'app.loadingWorkspace': "Chargement de l'espace de travail…",
  'app.whatsNew': 'Nouveautés',
  'app.user': 'Utilisateur',
  'app.logoutTeam': "Déconnecter l'équipe",
  'app.sessionRevoked.banner':
    "Le mot de passe de l'équipe a été changé\u00a0: rien de ce que vous faites ici n'est plus enregistré. Copiez ce que vous n'avez pas encore envoyé, puis reconnectez-vous avec le nouveau mot de passe.",
  'app.sessionRevoked.logInAgain': 'Se reconnecter',
};

export default app;
