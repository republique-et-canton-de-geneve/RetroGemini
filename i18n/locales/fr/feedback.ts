import type en from '../en/feedback';

// French messages for the "feedback" namespace. The type makes a missing or extra
// key a compile error, and i18nDictionaries.test.ts checks the placeholders.
const feedback: Record<keyof typeof en, string> = {
  // Header
  'feedback.header.title': 'Espace retours',
  'feedback.header.subtitle': 'Signalez des bugs ou soumettez des demandes de fonctionnalité, et consultez les retours des autres équipes',
  'feedback.header.refreshTitle': 'Actualiser',
  'feedback.header.refreshLabel': 'Actualiser la liste des retours',
  'feedback.header.newFeedback': 'Nouveau retour',

  // Feedback types
  'feedback.type.bug': 'Bug',
  'feedback.type.featureBadge': 'Fonctionnalité',
  'feedback.type.featureRequest': 'Demande de fonctionnalité',

  // Statuses
  'feedback.status.pending': 'En attente',
  'feedback.status.inProgress': 'En cours',
  'feedback.status.resolved': 'Résolu',
  'feedback.status.rejected': 'Rejeté',

  // Submission form
  'feedback.form.heading': 'Soumettre un retour',
  'feedback.form.typeLabel': 'Type',
  'feedback.form.titleLabel': 'Titre',
  'feedback.form.titlePlaceholder': 'Résumé succinct',
  'feedback.form.descriptionLabel': 'Description',
  'feedback.form.descriptionPlaceholder': 'Décrivez le problème ou la fonctionnalité souhaitée…',
  'feedback.form.imagesLabel': 'Images (5 au maximum, 2 Mo par image)',
  'feedback.form.uploading': 'Chargement des images…',
  'feedback.form.uploadAlt': 'Image ajoutée {number}',
  'feedback.form.submit': 'Soumettre',

  // Browser dialogs
  'feedback.alert.maxImages': '5 images au maximum sont autorisées',
  'feedback.alert.imageTooLarge': "L'image {name} est trop volumineuse. 2 Mo au maximum par image.",
  'feedback.alert.readError': 'Erreur lors de la lecture du fichier',
  'feedback.alert.fillAllFields': 'Veuillez remplir tous les champs',
  'feedback.confirm.deleteComment': 'Voulez-vous vraiment supprimer ce commentaire\u202f?',
  'feedback.confirm.deleteFeedback': 'Voulez-vous vraiment supprimer ce retour\u202f?',

  // Filters
  'feedback.filter.all': 'Tous ({count})',
  'feedback.filter.myTeam': 'Mon équipe ({count})',
  'feedback.filter.bugs': 'Bugs ({count})',
  'feedback.filter.features': 'Fonctionnalités ({count})',
  'feedback.filter.statusLabel': 'Statut\u00a0:',
  'feedback.filter.statusAll': 'Tous',

  // List and cards
  'feedback.list.loading': 'Chargement des retours…',
  'feedback.list.empty': 'Aucun retour ne correspond au filtre actuel',
  'feedback.card.myTeam': 'Mon équipe',
  'feedback.card.imageAlt': 'Image {number} du retour',
  'feedback.card.meta': 'Équipe\u00a0: {team} · Soumis par {name} le {date}',
  'feedback.card.delete': 'Supprimer le retour',

  // Comment thread
  'feedback.comments.toggle': 'Commentaires ({count})',
  'feedback.comments.delete': 'Supprimer le commentaire',
  'feedback.comments.empty': 'Aucun commentaire pour le moment',
  'feedback.comments.placeholder': 'Ajouter un commentaire…',
  'feedback.comments.send': 'Envoyer',
};

export default feedback;
