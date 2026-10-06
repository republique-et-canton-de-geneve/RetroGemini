import type en from '../en/admin';

// French messages for the "admin" namespace. The type makes a missing or extra
// key a type-check error.
const admin: Record<keyof typeof en, string> = {
  // Header
  'admin.header.title': 'Tableau de bord super administrateur',
  'admin.header.subtitle': 'Gérez toutes les équipes et leurs e-mails de récupération',
  'admin.header.exit': 'Quitter le mode administrateur',

  // Shared by several blocks and tabs
  'admin.saving': 'Enregistrement…',
  'admin.refresh': 'Actualiser',
  'admin.actions': 'Actions',
  'admin.notice.sessionExpired': 'La session super administrateur a expiré. Veuillez vous reconnecter.',
  'admin.notice.downloadBackupFailed': 'Le téléchargement de la sauvegarde a échoué',

  // Info message
  'admin.info.title': 'Message d’information',
  'admin.info.description':
    'Affichez une annonce importante sur la page de sélection des équipes et sur les tableaux de bord des équipes. Laissez vide pour masquer le message.',
  'admin.info.placeholder': 'p. ex. Maintenance planifiée dimanche de 2\u00a0h à 4\u00a0h…',
  'admin.info.preview': 'Aperçu\u00a0:',
  'admin.info.save': 'Enregistrer le message',
  'admin.info.saveFailed': 'L’enregistrement du message d’information a échoué',
  'admin.info.saved': 'Message d’information mis à jour',

  // Feedback notifications
  'admin.notifications.title': 'Notifications de retours',
  'admin.notifications.description':
    'Configurez les notifications par e-mail envoyées lorsque des utilisateurs soumettent un retour (signalement de bug ou demande de fonctionnalité). Nécessite une configuration SMTP sur le serveur.',
  'admin.notifications.emailLabel': 'Adresse e-mail de l’administrateur',
  'admin.notifications.emailPlaceholder': 'admin@example.com',
  'admin.notifications.emailHint': 'Laissez vide pour désactiver les notifications par e-mail des nouveaux retours.',
  'admin.notifications.saveEmail': 'Enregistrer l’e-mail',
  'admin.notifications.saveEmailFailed': 'L’enregistrement de l’e-mail de l’administrateur a échoué',
  'admin.notifications.emailSaved': 'E-mail de l’administrateur mis à jour',
  'admin.notifications.newTeamTitle': 'Notification de nouvelle équipe',
  'admin.notifications.newTeamDescription':
    'Recevez un e-mail lorsqu’une nouvelle équipe est créée. Nécessite une adresse e-mail d’administrateur et une configuration SMTP.',
  'admin.notifications.newTeamNeedsEmail': 'Définissez d’abord une adresse e-mail d’administrateur',
  'admin.notifications.newTeamDisable': 'Désactiver les notifications de nouvelle équipe',
  'admin.notifications.newTeamEnable': 'Activer les notifications de nouvelle équipe',
  'admin.notifications.newTeamEnabled': 'Notifications de nouvelle équipe activées',
  'admin.notifications.newTeamDisabled': 'Notifications de nouvelle équipe désactivées',
  'admin.notifications.newTeamFailed': 'La mise à jour du paramètre de notification a échoué',

  // AI assistant
  'admin.ai.title': 'Assistant IA',
  'admin.ai.description':
    'Connectez un LLM compatible OpenAI pour activer les suggestions automatiques de titres de groupe et la génération de synthèses de rétrospective.',
  'admin.ai.disable': 'Désactiver les fonctionnalités d’IA',
  'admin.ai.enable': 'Activer les fonctionnalités d’IA',
  'admin.ai.apiUrlLabel': 'URL de l’API',
  'admin.ai.apiUrlPlaceholder': 'https://api.openai.com/v1',
  'admin.ai.apiUrlHint': 'URL de base de l’API compatible OpenAI (p. ex. https://api.openai.com/v1)',
  'admin.ai.apiKeyLabel': 'Clé d’API',
  'admin.ai.apiKeyPlaceholder': 'sk-... (laisser vide si elle n’est pas requise)',
  'admin.ai.apiKeyHint':
    'Facultative. Requise pour des services comme OpenAI. Laissez vide si votre LLM n’exige pas d’authentification.',
  'admin.ai.modelLabel': 'Modèle',
  'admin.ai.modelPlaceholder': 'p. ex. gpt-4o-mini (facultatif)',
  'admin.ai.modelHint':
    'Nom de modèle facultatif. Certains points de terminaison l’exigent, d’autres le choisissent automatiquement.',
  'admin.ai.selfSignedTitle': 'Autoriser les certificats auto-signés',
  'admin.ai.selfSignedDescription':
    'Activez cette option pour les serveurs internes dotés de certificats TLS auto-signés ou d’entreprise.',
  'admin.ai.selfSignedDisable': 'Désactiver la prise en charge des certificats auto-signés',
  'admin.ai.selfSignedEnable': 'Autoriser les certificats auto-signés',
  'admin.ai.testing': 'Test en cours…',
  'admin.ai.test': 'Tester la connexion',
  'admin.ai.save': 'Enregistrer les paramètres',
  'admin.ai.saveFailed': 'L’enregistrement des paramètres d’IA a échoué',
  'admin.ai.saved': 'Paramètres d’IA mis à jour',
  'admin.ai.testSucceeded': 'Connexion réussie. Réponse\u00a0: «\u00a0{response}\u00a0»',

  // Full data archive (download and upload)
  'admin.data.title': 'Sauvegarde des données',
  'admin.data.description':
    'Téléchargez une archive complète du dossier {folder} pour une récupération locale ou une migration.',
  'admin.data.preparing': 'Préparation de la sauvegarde…',
  'admin.data.download': 'Télécharger la sauvegarde',
  'admin.data.directoryNotFound': 'Répertoire des données à sauvegarder introuvable.',
  'admin.data.generateFailed': 'La génération de la sauvegarde a échoué.',
  'admin.data.downloaded': 'Sauvegarde téléchargée',
  'admin.data.restoreTitle': 'Restauration des données',
  'admin.data.restoreDescription':
    'Importez une archive de sauvegarde {extension} téléchargée précédemment pour restaurer le dossier {folder}.',
  'admin.data.restoreWarningLabel': 'Attention\u00a0:',
  'admin.data.restoreWarning':
    '{warning} la restauration d’une sauvegarde écrase les données actuelles. Téléchargez d’abord une sauvegarde si vous risquez de devoir revenir en arrière.',
  'admin.data.restoring': 'Restauration…',
  'admin.data.upload': 'Importer et restaurer',
  'admin.data.selectArchive': 'Veuillez sélectionner une archive de sauvegarde à importer.',
  'admin.data.restoreFailed': 'La restauration de la sauvegarde a échoué.',
  'admin.data.restored': 'Sauvegarde restaurée. Actualisez la page pour charger les données mises à jour.',

  // Tab bar
  'admin.tabs.teams': 'Équipes ({count})',
  'admin.tabs.feedbacks': 'Retours ({count})',
  'admin.tabs.live': 'Sessions en direct',
  'admin.tabs.logs': 'Journaux du serveur',
  'admin.tabs.backups': 'Sauvegardes',
};

export default admin;
