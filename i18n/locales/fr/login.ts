import type en from '../en/login';

// French messages for the "login" namespace. The type makes a missing or extra
// key a compile error, and i18nDictionaries.test.ts checks the placeholders.
const login: Record<keyof typeof en, string> = {
  'login.brand.tagline': 'Des rétrospectives collaboratives qui aident votre équipe à grandir, à s’améliorer et à célébrer ses réussites ensemble.',
  'login.genericError': 'Une erreur est survenue',
  'login.emailPlaceholder': 'votre@email.com',

  // Team picker
  'login.list.title': 'Vos équipes',
  'login.list.newTeam': '+ Nouvelle équipe',
  'login.list.empty': 'Aucune équipe trouvée. Créez-en une pour commencer\u202f!',
  'login.list.searchPlaceholder': 'Rechercher une équipe...',
  'login.list.clearSearch': 'Effacer la recherche',
  'login.list.favorites': 'Favoris',
  'login.list.allTeams': 'Toutes les équipes',
  'login.list.addFavorite': 'Ajouter {teamName} aux favoris',
  'login.list.removeFavorite': 'Retirer {teamName} des favoris',
  'login.list.memberCount_one': '{count} membre',
  'login.list.memberCount_other': '{count} membres',
  // Shown after "Dernière activité :", hence the lower case.
  'login.list.lastActive': 'Dernière activité\u00a0: {when}',
  'login.list.lastConnection.never': 'jamais',
  'login.list.lastConnection.justNow': 'à l’instant',
  'login.list.lastConnection.today': 'aujourd’hui',
  'login.list.lastConnection.yesterday': 'hier',
  'login.list.lastConnection.daysAgo': 'il y a {count} jours',
  'login.list.lastConnection.weeksAgo_one': 'il y a {count} semaine',
  'login.list.lastConnection.weeksAgo_other': 'il y a {count} semaines',
  'login.list.lastConnection.monthsAgo_one': 'il y a {count} mois',
  'login.list.lastConnection.monthsAgo_other': 'il y a {count} mois',
  'login.list.lastConnection.yearsAgo_one': 'il y a {count} an',
  'login.list.lastConnection.yearsAgo_other': 'il y a {count} ans',

  // Super admin entry
  'login.superAdmin.access': 'Accès super administrateur',
  'login.superAdmin.title': 'Connexion super administrateur',
  'login.superAdmin.subtitle': 'Saisissez le mot de passe du super administrateur pour gérer toutes les équipes',
  'login.superAdmin.passwordLabel': 'Mot de passe du super administrateur',
  'login.superAdmin.submit': 'Accéder au panneau d’administration',
  'login.superAdmin.envHint': 'Définissez la variable d’environnement SUPER_ADMIN_PASSWORD sur le serveur pour activer cette fonctionnalité',
  'login.superAdmin.notConfigured': 'Le super administrateur n’est pas configuré sur ce serveur',
  'login.superAdmin.tooManyAttemptsRetryIn': 'Trop de tentatives. Réessayez dans {retryAfter}.',
  'login.superAdmin.tooManyAttemptsLater': 'Trop de tentatives. Réessayez plus tard.',
  'login.superAdmin.invalidPassword': 'Mot de passe du super administrateur incorrect',
  'login.superAdmin.authFailed': 'Échec de l’authentification',

  // Create team
  'login.create.title': 'Créer une nouvelle équipe',
  'login.create.nameLabel': 'Nom de l’équipe',
  'login.create.namePlaceholder': 'p. ex. Équipe design',
  'login.create.passwordLabel': 'Choisir un mot de passe',
  'login.create.emailLabel': 'E-mail de récupération {optional}',
  'login.create.optional': '(facultatif)',
  'login.create.emailHint': 'Pour récupérer votre mot de passe si vous l’oubliez',
  'login.create.submit': 'Créer et rejoindre',

  // Team login
  'login.signIn.title': 'Connexion à {teamName}',
  'login.signIn.subtitle': 'Saisissez le mot de passe de l’équipe pour continuer.',
  'login.signIn.passwordLabel': 'Mot de passe',
  'login.signIn.submit': 'Accéder à l’espace de travail',
  'login.signIn.forgotPassword': 'Mot de passe oublié\u202f?',

  // Guest join (invite link)
  'login.join.title': 'Rejoindre {teamName}',
  'login.join.subtitleSelect': 'Sélectionnez votre nom dans la liste ou ajoutez-en un nouveau',
  'login.join.subtitleNew': 'Saisissez votre nom pour rejoindre l’équipe',
  'login.join.pickerLabelNoEmail': 'Sélectionnez un membre sans adresse e-mail',
  'login.join.pickerLabel': 'Sélectionnez votre nom',
  'login.join.linkEmailHint': 'Si vous avez déjà rejoint l’équipe sans adresse e-mail, sélectionnez votre nom pour associer cette adresse à votre profil.',
  'login.join.role.participant': 'participant',
  'login.join.role.facilitator': 'facilitateur',
  'login.join.noEmailOnFile': 'Aucune adresse e-mail enregistrée',
  'login.join.or': 'OU',
  'login.join.notInList': '+ Je ne suis pas dans la liste',
  'login.join.joiningAs': 'Vous rejoignez l’équipe en tant que {email}',
  'login.join.continue': 'Continuer',
  'login.join.backToList': 'Retour à la liste des membres',
  'login.join.nameLabel': 'Votre nom',
  'login.join.namePlaceholder': 'p. ex. Jean Dupont',
  'login.join.recognized': 'Votre profil a été retrouvé grâce à une session précédente. Votre nom a été conservé par souci de cohérence.',
  'login.join.submit': 'Rejoindre la rétrospective',
  'login.join.footer': 'Vous rejoindrez la session en tant que participant',
  'login.join.selectMemberRequired': 'Veuillez sélectionner un membre dans la liste ou choisir de saisir un nouveau nom.',
  'login.join.nameRequired': 'Veuillez saisir votre nom',

  // Forgot password
  'login.forgot.title': 'Mot de passe oublié',
  'login.forgot.subtitle': 'Saisissez l’e-mail de récupération de l’équipe {teamName}',
  'login.forgot.emailLabel': 'E-mail de récupération',
  'login.forgot.submit': 'Envoyer le lien de réinitialisation',
  'login.forgot.footer': 'Un e-mail contenant un lien pour réinitialiser votre mot de passe vous sera envoyé',

  // Reset password (link from the email)
  'login.reset.title': 'Réinitialiser le mot de passe',
  'login.reset.subtitle': 'Saisissez votre nouveau mot de passe',
  'login.reset.newPasswordLabel': 'Nouveau mot de passe',
  'login.reset.submit': 'Réinitialiser le mot de passe',
  'login.reset.invalidLink': 'Le lien de réinitialisation est invalide ou a expiré',
  'login.reset.verifyThrottled': 'Trop de tentatives de réinitialisation du mot de passe depuis ce réseau. Veuillez patienter quelques minutes, puis rouvrir le lien.',
  'login.reset.missingToken': 'Lien de réinitialisation invalide',
  'login.reset.success': 'Mot de passe mis à jour pour {teamName}. Vous pouvez maintenant vous connecter.',
};

export default login;
