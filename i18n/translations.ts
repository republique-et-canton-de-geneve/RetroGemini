// i18n translations for RetroGemini
// Note: Health check templates (Team Health Check / Bilan de santé) are NOT translated here
// as they already have separate French and English versions in dataService.ts

export type Language = 'en' | 'fr';

export const LANGUAGE_STORAGE_KEY = 'retro-language';

export const languageNames: Record<Language, string> = {
  en: 'English',
  fr: 'Français'
};

export type TranslationKeys = typeof translations.en;

export const translations = {
  en: {
    // Common
    common: {
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      edit: 'Edit',
      close: 'Close',
      back: 'Back',
      next: 'Next',
      add: 'Add',
      confirm: 'Confirm',
      yes: 'Yes',
      no: 'No',
      loading: 'Loading workspace…',
      or: 'OR',
      unassigned: 'Unassigned',
      user: 'User',
      logout: 'Logout Team',
      actions: 'Actions',
      participants: 'participants',
      finished: 'finished',
      voted: 'voted',
      live: 'Live',
      online: 'Online',
      you: '(you)',
    },

    // App / Header
    app: {
      whatsNew: "What's New",
      version: 'Version',
    },

    // Team Login
    teamLogin: {
      title: 'RetroGemini',
      subtitle: 'Collaborative retrospectives that help your team grow, improve, and celebrate together.',
      yourTeams: 'Your Teams',
      newTeam: '+ New Team',
      noTeams: 'No teams found. Create one to get started!',
      members: 'members',
      lastActive: 'Last active:',
      never: 'Never',
      today: 'Today',
      yesterday: 'Yesterday',
      daysAgo: 'days ago',
      weeksAgo: 'weeks ago',
      monthsAgo: 'months ago',
      yearsAgo: 'years ago',
      justNow: 'Just now',

      // Create team
      createNewTeam: 'Create New Team',
      teamName: 'Team Name',
      teamNamePlaceholder: 'e.g. Design Team',
      createPassword: 'Create Password',
      recoveryEmail: 'Recovery Email',
      recoveryEmailOptional: '(optional)',
      recoveryEmailHelp: 'To recover your password if you forget it',
      createAndJoin: 'Create & Join',
      passwordMinLength: 'Password must be at least 4 chars',

      // Login
      loginTo: 'Login to',
      enterPassword: 'Enter the team password to continue.',
      password: 'Password',
      enterWorkspace: 'Enter Workspace',
      forgotPassword: 'Forgot password?',

      // Join
      join: 'Join',
      selectNameOrAdd: 'Select your name from the list or add a new one',
      enterNameToJoin: 'Enter your name to join',
      selectYourName: 'Select Your Name',
      selectedName: 'Selected Name',
      notInList: "+ I'm not in the list",
      backToMemberList: 'Back to member list',
      yourName: 'Your Name',
      yourNamePlaceholder: 'e.g. John Doe',
      joinRetro: 'Join Retrospective',
      joinAsParticipant: 'You will join as a participant',
      joiningAs: 'Joining as',
      recognizedFromPrevious: 'We recognized you from a previous session. Your name was kept for consistency.',
      continue: 'Continue',
      pleaseEnterName: 'Please enter your name',

      // Forgot password
      forgotPasswordTitle: 'Forgot Password',
      enterRecoveryEmail: 'Enter the recovery email for team',
      sendResetLink: 'Send Reset Link',
      resetLinkSent: 'An email will be sent with a link to reset your password',

      // Reset password
      resetPasswordTitle: 'Reset Password',
      enterNewPassword: 'Enter your new password',
      newPassword: 'New Password',
      atLeastChars: 'At least 4 characters',
      resetPassword: 'Reset Password',
      invalidResetLink: 'The reset link is invalid or has expired',

      // Super admin
      superAdminLogin: 'Super Admin Login',
      superAdminDesc: 'Enter the super admin password to manage all teams',
      superAdminPassword: 'Super Admin Password',
      accessAdminPanel: 'Access Admin Panel',
      superAdminHelp: 'Set SUPER_ADMIN_PASSWORD environment variable on the server to enable this feature',
      superAdminNotConfigured: 'Super admin not configured on this server',
      invalidSuperAdminPassword: 'Invalid super admin password',
      tooManyAttempts: 'Too many attempts.',
      tryAgainIn: 'Try again in',
      tryAgainLater: 'Try again later.',
    },

    // Dashboard
    dashboard: {
      title: 'Dashboard',
      manageActions: 'Manage actions and track team progress.',
      newRetrospective: 'New Retrospective',
      deleteTeam: 'Delete Team',

      // Tabs
      tabActions: 'Actions',
      tabRetros: 'Retrospectives',
      tabHealthChecks: 'Health Checks',
      tabMembers: 'Members',
      tabSettings: 'Settings',
      tabFeedback: 'Feedback',

      // Actions
      createAction: 'Create Action',
      whatNeedsToBeDone: 'What needs to be done?',
      open: 'Open',
      closed: 'Closed',
      all: 'All',
      noActionsFound: 'No actions found.',
      removed: '(removed)',

      // Retrospectives
      noRetrosYet: 'No retrospectives yet. Start one!',
      startNewRetro: 'Start New Retrospective',
      sessionName: 'Session Name',
      anonymousMode: 'Anonymous mode',
      anonymousModeDesc: 'Hide author names on tickets for this retro.',
      startStopContinue: 'Start, Stop, Continue',
      startStopContinueDesc: 'The classic format.',
      fourLs: "4 L's",
      fourLsDesc: 'Liked, Learned, Lacked, Longed For.',
      madSadGlad: 'Mad / Sad / Glad',
      madSadGladDesc: 'Capture the full range of feelings.',
      sailboat: 'Sailboat',
      sailboatDesc: 'Wind, anchors, rocks, and goals.',
      wentWell: 'Went Well / Improve / Ideas',
      wentWellDesc: 'Fast three-column retro.',
      savedTemplates: 'Saved Templates',
      createCustomTemplate: 'Create Custom Template',
      templateNameOptional: 'Template Name (Optional, to save)',
      templateNamePlaceholder: 'e.g. Sprint Review Special',
      columns: 'Columns',
      addColumn: '+ Add Column',
      startRetro: 'Start Retro',
      resume: 'Resume',
      viewSummary: 'View Summary',
      deleteRetrospective: 'Delete retrospective',
      renameRetrospective: 'Rename retrospective',
      deleteRetroConfirm: 'Actions from',
      deleteRetroConfirmEnd: 'will be kept in the global backlog.',

      // Health checks
      noHealthChecksYet: 'No health checks yet. Start one to track team health over time!',
      startHealthCheck: 'Start Health Check',
      template: 'Template',
      dimensions: 'dimensions',
      hideParticipantNames: 'Hide participant names during the session.',
      sessions: 'sessions',
      showNewer: 'Show newer',
      showOlder: 'Show older',
      dimension: 'Dimension',
      good: 'Good',
      bad: 'Bad',
      viewResults: 'View Results',
      deleteHealthCheck: 'Delete health check',
      renameHealthCheck: 'Rename health check',

      // Members
      noMembersYet: 'No members yet.',
      removeMember: 'Remove member',
      removeConfirm: 'Remove?',

      // Settings
      teamSettings: 'Team Settings',
      recoveryEmailLabel: 'Recovery Email',
      recoveryEmailDesc: 'This email will be used to recover your password if forgotten. It is separate from participant emails.',
      noEmailConfigured: "No email configured - you won't be able to recover your password",
      healthCheckTemplates: 'Health Check Templates',
      createHealthCheckTemplate: 'Create Health Check Template',
      default: 'Default',
      readOnly: 'This default template is read-only.',
      viewDetails: 'View details',
      hideDetails: 'Hide details',
      editTemplate: 'Edit template',
      deleteTemplate: 'Delete template',
      more: 'more',
      retroTemplates: 'Retrospective Templates',
      createRetroTemplate: 'Create Retro Template',

      // Template editor
      editTemplateTitle: 'Edit Template',
      createTemplateTitle: 'Create Template',
      templateName: 'Template Name',
      templateNameExample: 'e.g., Team Wellness Check',
      dimensionName: 'Dimension name',
      goodDescription: 'Good description (what it looks like when things are good)',
      badDescription: 'Bad description (what it looks like when things are bad)',
      addDimension: 'Add Dimension',
      saveTemplate: 'Save Template',

      // Delete team modal
      deleteTeamTitle: 'Delete Team',
      deleteTeamWarning: 'This action is',
      irreversible: 'irreversible',
      deleteTeamDesc: 'All retrospectives, actions, and team data will be permanently deleted.',
      typeTeamName: 'To confirm deletion, type the team name:',
      typeTeamNameHere: 'Type team name here',
    },

    // Session (Retrospective)
    session: {
      // Phases
      icebreaker: 'ICEBREAKER',
      brainstorm: 'BRAINSTORM',
      group: 'GROUP',
      vote: 'VOTE',
      discuss: 'DISCUSS',
      review: 'REVIEW',
      close: 'CLOSE',

      // Phase descriptions
      addTickets: 'Add your tickets',
      ticketsAdded: 'tickets added',
      groupTickets: 'Group related tickets',
      groups: 'groups',
      castVotes: 'Cast your votes',
      votesRemaining: 'votes remaining',
      discussTopics: 'Discuss top topics',
      of: 'of',
      topics: 'topics',
      reviewActions: 'Review Actions',
      actionsCreated: 'actions',

      // Ticket/Card
      addTicket: 'Add a ticket...',
      editTicket: 'Edit',
      deleteTicket: 'Delete',

      // Groups
      createGroup: 'Create Group',
      groupTitle: 'Group title...',
      ungrouped: 'Ungrouped',

      // Discussion
      proposeAction: 'Propose an action...',
      propose: 'Propose',
      accepted: 'Accepted:',
      accept: 'Accept',
      total: 'Total:',

      // Review phase
      actionsFromSession: 'Actions from this session',
      noActionsYet: 'No actions created yet.',
      general: 'General',

      // Close phase
      retroComplete: 'Retrospective Complete',
      thankYou: 'Thank you for your contribution!',
      roti: 'ROTI (Return on Time Invested)',
      membersVoted: 'members have voted',
      revealResults: 'Reveal Results',
      returnToDashboard: 'Return to Dashboard',
      leaveRetro: 'Leave Retrospective',

      // Participants panel
      participantsTitle: 'Participants',
      expandPanel: 'Expand panel',
      collapsePanel: 'Collapse panel',
      completedBrainstorm: 'completed brainstorm',
      votedInCloseout: 'voted in close-out',
      participant: 'participant',
      inviteTeam: 'Invite Team',
      clickToExpand: 'Click to expand participants panel',

      // Session not found
      sessionNotFound: 'Session not found',

      // Timer
      setTimer: 'Set Timer',
      startTimer: 'Start',
      pauseTimer: 'Pause',
      resetTimer: 'Reset',
      mins: 'mins',
    },

    // Health Check Session
    healthCheck: {
      // Phases
      survey: 'SURVEY',
      discuss: 'DISCUSS',
      review: 'REVIEW',
      close: 'CLOSE',

      // Survey phase
      rateEachDimension: 'Rate each health dimension',
      participantsFinished: 'participants finished',
      nextDiscuss: 'Next: Discuss',
      ratingsAnonymous: 'Your ratings are anonymous',
      ratingsVisible: 'Your ratings are visible to the team',
      stronglyDisagree: 'Strongly Disagree',
      neutral: 'Neutral',
      stronglyAgree: 'Strongly Agree',
      additionalComments: 'Additional comments (optional)...',
      saved: 'SAVED',

      // Discuss phase
      discussResults: 'Discuss survey results and identify actions',
      nextReview: 'Next: Review',
      voteDistribution: 'Vote Distribution',
      comments: 'Comments',
      rating: 'rating',
      ratings: 'ratings',
      comment: 'comment',

      // Review phase
      reviewActionsTitle: 'Review Actions',
      nextClose: 'Next: Close',
      actionsFromSession: 'Actions from this session',
      noActionsCreated: 'No actions created yet.',

      // Close phase
      healthCheckComplete: 'Health Check Complete',
      thankYouContribution: 'Thank you for your contribution!',
      rotiTitle: 'ROTI (Return on Time Invested)',
      membersHaveVoted: 'members have voted',
      revealResults: 'Reveal Results',
      returnToDashboard: 'Return to Dashboard',
      leaveHealthCheck: 'Leave Health Check',

      // Participants
      completedSurvey: 'completed survey',

      // Session not found
      sessionNotFound: 'Session not found',
    },

    // Invite Modal
    invite: {
      inviteTeamMembers: 'Invite Team Members',
      scanQR: 'Scan this QR code or share the link to invite participants.',
      sessionCode: 'Session Code',
      copyLink: 'Copy Link',
      copied: 'Copied!',
      sendByEmail: 'Send by Email',
      emailAddress: 'Email address',
      participantName: 'Participant name (optional)',
      sendInvite: 'Send Invite',
      inviteSent: 'Invitation sent successfully!',
      inviteFailed: 'Failed to send invitation',
    },

    // Announcement Modal
    announcement: {
      whatsNew: "What's New",
      newFeature: 'New Feature',
      improvement: 'Improvement',
      bugFix: 'Bug Fix',
      securityUpdate: 'Security Update',
      removed: 'Removed',
      allCaughtUp: "You're all caught up!",
      noNewUpdates: 'No new updates since your last visit.',
      later: 'Later',
      gotIt: 'Got it!',
    },

    // Super Admin
    superAdmin: {
      title: 'Super Admin Panel',
      backToLogin: 'Back to Login',
      allTeams: 'All Teams',
      noTeamsFound: 'No teams found.',
      accessTeam: 'Access Team',
      backups: 'Backups',
      createBackup: 'Create Backup',
      downloadBackup: 'Download Backup',
      restoreBackup: 'Restore Backup',
      userFeedback: 'User Feedback',
      noFeedback: 'No feedback submitted yet.',
    },

    // Team Feedback
    feedback: {
      title: 'Team Feedback',
      subtitle: 'Help us improve RetroGemini by sharing your thoughts.',
      whatType: 'What type of feedback?',
      types: {
        bug: 'Bug Report',
        feature: 'Feature Request',
        improvement: 'Improvement',
        other: 'Other',
      },
      describeFeedback: 'Describe your feedback',
      descriptionPlaceholder: 'Tell us what you think...',
      submit: 'Submit Feedback',
      thankYou: 'Thank you for your feedback!',
      previousFeedback: 'Previous Feedback',
      noPreviousFeedback: 'No previous feedback.',
    },

    // Dates
    dates: {
      today: 'Today',
      yesterday: 'Yesterday',
      daysAgo: '{n} days ago',
      weeksAgo: '{n} weeks ago',
      monthsAgo: '{n} months ago',
      yearsAgo: '{n} years ago',
    },
  },

  fr: {
    // Common
    common: {
      save: 'Enregistrer',
      cancel: 'Annuler',
      delete: 'Supprimer',
      edit: 'Modifier',
      close: 'Fermer',
      back: 'Retour',
      next: 'Suivant',
      add: 'Ajouter',
      confirm: 'Confirmer',
      yes: 'Oui',
      no: 'Non',
      loading: 'Chargement de l\'espace de travail…',
      or: 'OU',
      unassigned: 'Non assigné',
      user: 'Utilisateur',
      logout: 'Déconnexion',
      actions: 'Actions',
      participants: 'participants',
      finished: 'terminé',
      voted: 'voté',
      live: 'En direct',
      online: 'En ligne',
      you: '(vous)',
    },

    // App / Header
    app: {
      whatsNew: 'Nouveautés',
      version: 'Version',
    },

    // Team Login
    teamLogin: {
      title: 'RetroGemini',
      subtitle: 'Des rétrospectives collaboratives qui aident votre équipe à grandir, s\'améliorer et célébrer ensemble.',
      yourTeams: 'Vos équipes',
      newTeam: '+ Nouvelle équipe',
      noTeams: 'Aucune équipe trouvée. Créez-en une pour commencer !',
      members: 'membres',
      lastActive: 'Dernière activité :',
      never: 'Jamais',
      today: 'Aujourd\'hui',
      yesterday: 'Hier',
      daysAgo: 'jours',
      weeksAgo: 'semaines',
      monthsAgo: 'mois',
      yearsAgo: 'ans',
      justNow: 'À l\'instant',

      // Create team
      createNewTeam: 'Créer une nouvelle équipe',
      teamName: 'Nom de l\'équipe',
      teamNamePlaceholder: 'ex. Équipe Design',
      createPassword: 'Créer un mot de passe',
      recoveryEmail: 'Email de récupération',
      recoveryEmailOptional: '(optionnel)',
      recoveryEmailHelp: 'Pour récupérer votre mot de passe en cas d\'oubli',
      createAndJoin: 'Créer et rejoindre',
      passwordMinLength: 'Le mot de passe doit contenir au moins 4 caractères',

      // Login
      loginTo: 'Connexion à',
      enterPassword: 'Entrez le mot de passe de l\'équipe pour continuer.',
      password: 'Mot de passe',
      enterWorkspace: 'Accéder à l\'espace',
      forgotPassword: 'Mot de passe oublié ?',

      // Join
      join: 'Rejoindre',
      selectNameOrAdd: 'Sélectionnez votre nom dans la liste ou ajoutez-en un nouveau',
      enterNameToJoin: 'Entrez votre nom pour rejoindre',
      selectYourName: 'Sélectionnez votre nom',
      selectedName: 'Nom sélectionné',
      notInList: '+ Je ne suis pas dans la liste',
      backToMemberList: 'Retour à la liste des membres',
      yourName: 'Votre nom',
      yourNamePlaceholder: 'ex. Jean Dupont',
      joinRetro: 'Rejoindre la rétrospective',
      joinAsParticipant: 'Vous rejoindrez en tant que participant',
      joiningAs: 'Connexion en tant que',
      recognizedFromPrevious: 'Nous vous avons reconnu d\'une session précédente. Votre nom a été conservé pour la cohérence.',
      continue: 'Continuer',
      pleaseEnterName: 'Veuillez entrer votre nom',

      // Forgot password
      forgotPasswordTitle: 'Mot de passe oublié',
      enterRecoveryEmail: 'Entrez l\'email de récupération pour l\'équipe',
      sendResetLink: 'Envoyer le lien de réinitialisation',
      resetLinkSent: 'Un email sera envoyé avec un lien pour réinitialiser votre mot de passe',

      // Reset password
      resetPasswordTitle: 'Réinitialiser le mot de passe',
      enterNewPassword: 'Entrez votre nouveau mot de passe',
      newPassword: 'Nouveau mot de passe',
      atLeastChars: 'Au moins 4 caractères',
      resetPassword: 'Réinitialiser',
      invalidResetLink: 'Le lien de réinitialisation est invalide ou a expiré',

      // Super admin
      superAdminLogin: 'Connexion Super Admin',
      superAdminDesc: 'Entrez le mot de passe super admin pour gérer toutes les équipes',
      superAdminPassword: 'Mot de passe Super Admin',
      accessAdminPanel: 'Accéder au panneau admin',
      superAdminHelp: 'Définissez la variable d\'environnement SUPER_ADMIN_PASSWORD sur le serveur pour activer cette fonctionnalité',
      superAdminNotConfigured: 'Super admin non configuré sur ce serveur',
      invalidSuperAdminPassword: 'Mot de passe super admin invalide',
      tooManyAttempts: 'Trop de tentatives.',
      tryAgainIn: 'Réessayez dans',
      tryAgainLater: 'Réessayez plus tard.',
    },

    // Dashboard
    dashboard: {
      title: 'Tableau de bord',
      manageActions: 'Gérez les actions et suivez la progression de l\'équipe.',
      newRetrospective: 'Nouvelle rétrospective',
      deleteTeam: 'Supprimer l\'équipe',

      // Tabs
      tabActions: 'Actions',
      tabRetros: 'Rétrospectives',
      tabHealthChecks: 'Bilans de santé',
      tabMembers: 'Membres',
      tabSettings: 'Paramètres',
      tabFeedback: 'Feedback',

      // Actions
      createAction: 'Créer une action',
      whatNeedsToBeDone: 'Que faut-il faire ?',
      open: 'Ouvertes',
      closed: 'Fermées',
      all: 'Toutes',
      noActionsFound: 'Aucune action trouvée.',
      removed: '(supprimé)',

      // Retrospectives
      noRetrosYet: 'Pas encore de rétrospective. Commencez-en une !',
      startNewRetro: 'Démarrer une nouvelle rétrospective',
      sessionName: 'Nom de la session',
      anonymousMode: 'Mode anonyme',
      anonymousModeDesc: 'Masquer les noms des auteurs sur les tickets.',
      startStopContinue: 'Commencer, Arrêter, Continuer',
      startStopContinueDesc: 'Le format classique.',
      fourLs: 'Les 4 L',
      fourLsDesc: 'Aimé, Appris, Manqué, Désiré.',
      madSadGlad: 'Fâché / Triste / Content',
      madSadGladDesc: 'Capturez toute la gamme des émotions.',
      sailboat: 'Voilier',
      sailboatDesc: 'Vent, ancres, rochers et objectifs.',
      wentWell: 'Bien passé / À améliorer / Idées',
      wentWellDesc: 'Rétrospective rapide à trois colonnes.',
      savedTemplates: 'Modèles enregistrés',
      createCustomTemplate: 'Créer un modèle personnalisé',
      templateNameOptional: 'Nom du modèle (optionnel, pour sauvegarder)',
      templateNamePlaceholder: 'ex. Revue de sprint spéciale',
      columns: 'Colonnes',
      addColumn: '+ Ajouter une colonne',
      startRetro: 'Démarrer la rétro',
      resume: 'Reprendre',
      viewSummary: 'Voir le résumé',
      deleteRetrospective: 'Supprimer la rétrospective',
      renameRetrospective: 'Renommer la rétrospective',
      deleteRetroConfirm: 'Les actions de',
      deleteRetroConfirmEnd: 'seront conservées dans le backlog global.',

      // Health checks
      noHealthChecksYet: 'Pas encore de bilan de santé. Démarrez-en un pour suivre la santé de l\'équipe !',
      startHealthCheck: 'Démarrer un bilan de santé',
      template: 'Modèle',
      dimensions: 'dimensions',
      hideParticipantNames: 'Masquer les noms des participants pendant la session.',
      sessions: 'sessions',
      showNewer: 'Plus récent',
      showOlder: 'Plus ancien',
      dimension: 'Dimension',
      good: 'Bien',
      bad: 'Mal',
      viewResults: 'Voir les résultats',
      deleteHealthCheck: 'Supprimer le bilan de santé',
      renameHealthCheck: 'Renommer le bilan de santé',

      // Members
      noMembersYet: 'Pas encore de membres.',
      removeMember: 'Retirer le membre',
      removeConfirm: 'Retirer ?',

      // Settings
      teamSettings: 'Paramètres de l\'équipe',
      recoveryEmailLabel: 'Email de récupération',
      recoveryEmailDesc: 'Cet email sera utilisé pour récupérer votre mot de passe. Il est distinct des emails des participants.',
      noEmailConfigured: 'Aucun email configuré - vous ne pourrez pas récupérer votre mot de passe',
      healthCheckTemplates: 'Modèles de bilan de santé',
      createHealthCheckTemplate: 'Créer un modèle de bilan de santé',
      default: 'Par défaut',
      readOnly: 'Ce modèle par défaut est en lecture seule.',
      viewDetails: 'Voir les détails',
      hideDetails: 'Masquer les détails',
      editTemplate: 'Modifier le modèle',
      deleteTemplate: 'Supprimer le modèle',
      more: 'plus',
      retroTemplates: 'Modèles de rétrospective',
      createRetroTemplate: 'Créer un modèle de rétro',

      // Template editor
      editTemplateTitle: 'Modifier le modèle',
      createTemplateTitle: 'Créer un modèle',
      templateName: 'Nom du modèle',
      templateNameExample: 'ex. Bilan bien-être équipe',
      dimensionName: 'Nom de la dimension',
      goodDescription: 'Description positive (à quoi ça ressemble quand ça va bien)',
      badDescription: 'Description négative (à quoi ça ressemble quand ça va mal)',
      addDimension: 'Ajouter une dimension',
      saveTemplate: 'Enregistrer le modèle',

      // Delete team modal
      deleteTeamTitle: 'Supprimer l\'équipe',
      deleteTeamWarning: 'Cette action est',
      irreversible: 'irréversible',
      deleteTeamDesc: 'Toutes les rétrospectives, actions et données d\'équipe seront définitivement supprimées.',
      typeTeamName: 'Pour confirmer la suppression, tapez le nom de l\'équipe :',
      typeTeamNameHere: 'Tapez le nom de l\'équipe ici',
    },

    // Session (Retrospective)
    session: {
      // Phases
      icebreaker: 'BRISE-GLACE',
      brainstorm: 'BRAINSTORM',
      group: 'GROUPER',
      vote: 'VOTER',
      discuss: 'DISCUTER',
      review: 'RÉVISER',
      close: 'CLÔTURER',

      // Phase descriptions
      addTickets: 'Ajoutez vos tickets',
      ticketsAdded: 'tickets ajoutés',
      groupTickets: 'Regroupez les tickets similaires',
      groups: 'groupes',
      castVotes: 'Votez',
      votesRemaining: 'votes restants',
      discussTopics: 'Discutez des sujets principaux',
      of: 'sur',
      topics: 'sujets',
      reviewActions: 'Revue des actions',
      actionsCreated: 'actions',

      // Ticket/Card
      addTicket: 'Ajouter un ticket...',
      editTicket: 'Modifier',
      deleteTicket: 'Supprimer',

      // Groups
      createGroup: 'Créer un groupe',
      groupTitle: 'Titre du groupe...',
      ungrouped: 'Non groupé',

      // Discussion
      proposeAction: 'Proposer une action...',
      propose: 'Proposer',
      accepted: 'Accepté :',
      accept: 'Accepter',
      total: 'Total :',

      // Review phase
      actionsFromSession: 'Actions de cette session',
      noActionsYet: 'Aucune action créée pour l\'instant.',
      general: 'Général',

      // Close phase
      retroComplete: 'Rétrospective terminée',
      thankYou: 'Merci pour votre contribution !',
      roti: 'ROTI (Retour sur temps investi)',
      membersVoted: 'membres ont voté',
      revealResults: 'Révéler les résultats',
      returnToDashboard: 'Retour au tableau de bord',
      leaveRetro: 'Quitter la rétrospective',

      // Participants panel
      participantsTitle: 'Participants',
      expandPanel: 'Développer le panneau',
      collapsePanel: 'Réduire le panneau',
      completedBrainstorm: 'ont terminé le brainstorm',
      votedInCloseout: 'ont voté à la clôture',
      participant: 'participant',
      inviteTeam: 'Inviter l\'équipe',
      clickToExpand: 'Cliquez pour développer le panneau des participants',

      // Session not found
      sessionNotFound: 'Session non trouvée',

      // Timer
      setTimer: 'Minuteur',
      startTimer: 'Démarrer',
      pauseTimer: 'Pause',
      resetTimer: 'Réinitialiser',
      mins: 'min',
    },

    // Health Check Session
    healthCheck: {
      // Phases
      survey: 'SONDAGE',
      discuss: 'DISCUTER',
      review: 'RÉVISER',
      close: 'CLÔTURER',

      // Survey phase
      rateEachDimension: 'Évaluez chaque dimension de santé',
      participantsFinished: 'participants ont terminé',
      nextDiscuss: 'Suivant : Discuter',
      ratingsAnonymous: 'Vos évaluations sont anonymes',
      ratingsVisible: 'Vos évaluations sont visibles par l\'équipe',
      stronglyDisagree: 'Pas du tout d\'accord',
      neutral: 'Neutre',
      stronglyAgree: 'Tout à fait d\'accord',
      additionalComments: 'Commentaires supplémentaires (optionnel)...',
      saved: 'ENREGISTRÉ',

      // Discuss phase
      discussResults: 'Discutez des résultats et identifiez les actions',
      nextReview: 'Suivant : Réviser',
      voteDistribution: 'Distribution des votes',
      comments: 'Commentaires',
      rating: 'évaluation',
      ratings: 'évaluations',
      comment: 'commentaire',

      // Review phase
      reviewActionsTitle: 'Revue des actions',
      nextClose: 'Suivant : Clôturer',
      actionsFromSession: 'Actions de cette session',
      noActionsCreated: 'Aucune action créée pour l\'instant.',

      // Close phase
      healthCheckComplete: 'Bilan de santé terminé',
      thankYouContribution: 'Merci pour votre contribution !',
      rotiTitle: 'ROTI (Retour sur temps investi)',
      membersHaveVoted: 'membres ont voté',
      revealResults: 'Révéler les résultats',
      returnToDashboard: 'Retour au tableau de bord',
      leaveHealthCheck: 'Quitter le bilan de santé',

      // Participants
      completedSurvey: 'ont complété le sondage',

      // Session not found
      sessionNotFound: 'Session non trouvée',
    },

    // Invite Modal
    invite: {
      inviteTeamMembers: 'Inviter des membres',
      scanQR: 'Scannez ce QR code ou partagez le lien pour inviter des participants.',
      sessionCode: 'Code de session',
      copyLink: 'Copier le lien',
      copied: 'Copié !',
      sendByEmail: 'Envoyer par email',
      emailAddress: 'Adresse email',
      participantName: 'Nom du participant (optionnel)',
      sendInvite: 'Envoyer l\'invitation',
      inviteSent: 'Invitation envoyée avec succès !',
      inviteFailed: 'Échec de l\'envoi de l\'invitation',
    },

    // Announcement Modal
    announcement: {
      whatsNew: 'Nouveautés',
      newFeature: 'Nouvelle fonctionnalité',
      improvement: 'Amélioration',
      bugFix: 'Correction de bug',
      securityUpdate: 'Mise à jour de sécurité',
      removed: 'Supprimé',
      allCaughtUp: 'Vous êtes à jour !',
      noNewUpdates: 'Aucune nouvelle mise à jour depuis votre dernière visite.',
      later: 'Plus tard',
      gotIt: 'Compris !',
    },

    // Super Admin
    superAdmin: {
      title: 'Panneau Super Admin',
      backToLogin: 'Retour à la connexion',
      allTeams: 'Toutes les équipes',
      noTeamsFound: 'Aucune équipe trouvée.',
      accessTeam: 'Accéder à l\'équipe',
      backups: 'Sauvegardes',
      createBackup: 'Créer une sauvegarde',
      downloadBackup: 'Télécharger',
      restoreBackup: 'Restaurer',
      userFeedback: 'Feedback utilisateurs',
      noFeedback: 'Aucun feedback soumis pour l\'instant.',
    },

    // Team Feedback
    feedback: {
      title: 'Feedback équipe',
      subtitle: 'Aidez-nous à améliorer RetroGemini en partageant vos impressions.',
      whatType: 'Quel type de feedback ?',
      types: {
        bug: 'Rapport de bug',
        feature: 'Demande de fonctionnalité',
        improvement: 'Amélioration',
        other: 'Autre',
      },
      describeFeedback: 'Décrivez votre feedback',
      descriptionPlaceholder: 'Dites-nous ce que vous pensez...',
      submit: 'Envoyer le feedback',
      thankYou: 'Merci pour votre feedback !',
      previousFeedback: 'Feedback précédents',
      noPreviousFeedback: 'Aucun feedback précédent.',
    },

    // Dates
    dates: {
      today: 'Aujourd\'hui',
      yesterday: 'Hier',
      daysAgo: 'il y a {n} jours',
      weeksAgo: 'il y a {n} semaines',
      monthsAgo: 'il y a {n} mois',
      yearsAgo: 'il y a {n} ans',
    },
  },
} as const;

export type Translations = typeof translations.en;
