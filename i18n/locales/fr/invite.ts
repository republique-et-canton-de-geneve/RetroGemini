import type en from '../en/invite';

// French messages for the "invite" namespace. The type makes a missing or extra
// key a compile error, and i18nDictionaries.test.ts checks the placeholders.
const invite: Record<keyof typeof en, string> = {
  'invite.title': 'Inviter des membres à rejoindre {teamName}',
  'invite.subtitle': 'Choisissez comment inviter les participants.',
  'invite.tab.email': 'E-MAIL',
  'invite.tab.link': 'CODE ET LIEN',
  'invite.tab.wifi': 'WI-FI',
  'invite.copy': 'COPIER',
  'invite.testAnotherUser': 'Souhaitez-vous tester avec un autre utilisateur ?',
  'invite.logoutAndCreate': 'Se déconnecter et créer un nouvel utilisateur',
  'invite.done': 'Terminé',

  // Email tab
  'invite.email.heading': 'Inviter par e-mail',
  'invite.email.description': 'Collez une ou plusieurs adresses e-mail pour envoyer des liens personnels.',
  'invite.email.teamMembers': 'Membres de l’équipe',
  'invite.email.selectAll': 'Tout sélectionner',
  'invite.email.unselectAll': 'Tout désélectionner',
  'invite.email.placeholder': 'p. ex. collegue@exemple.com, autre@entreprise.com',
  'invite.email.send': 'Envoyer les invitations',
  'invite.email.sending': 'Envoi…',
  'invite.email.sendingStatus': 'Envoi des invitations…',
  'invite.email.readyCount_one': '{count} invitation prête à partager',
  'invite.email.readyCount_other': '{count} invitations prêtes à partager',
  'invite.email.noneCreated': 'Aucune invitation créée',
  'invite.email.errorLine': '{email} : {message}',
  'invite.email.notConfigured': 'Le service d’e-mail n’est pas configuré',
  'invite.email.sessionExpired': 'Session expirée, veuillez vous reconnecter',
  'invite.email.sendFailed': 'Échec de l’envoi de l’e-mail',
  'invite.email.generateFailed': 'Impossible de générer l’invitation',
  'invite.email.linksReady': 'Liens d’invitation prêts',

  // Link / QR tab
  'invite.link.heading': 'Partager par lien ou code QR',
  'invite.link.description': 'Chacun peut rejoindre la session et choisir son nom après avoir scanné le code.',
  'invite.link.qrAlt': 'Code QR',
  'invite.link.generating': 'Génération du lien…',

  // Wi-Fi tab
  'invite.wifi.heading': 'Se connecter au Wi-Fi',
  'invite.wifi.description': 'Scannez ce code QR avec votre téléphone pour rejoindre le réseau.',
  'invite.wifi.qrAlt': 'Code QR Wi-Fi',
  'invite.wifi.network': 'Réseau',
  'invite.wifi.password': 'Mot de passe',
  'invite.wifi.showPassword': 'Afficher le mot de passe Wi-Fi',
  'invite.wifi.hidePassword': 'Masquer le mot de passe Wi-Fi',
  'invite.wifi.hint': 'Une fois la connexion établie, ouvrez le lien d’invitation ou scannez le code QR de la session pour la rejoindre.',
};

export default invite;
