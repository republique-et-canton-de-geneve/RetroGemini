import type en from '../en/adminFeedbacks';

// French messages for the "adminFeedbacks" namespace. The type makes a missing or extra
// key a type-check error.
const adminFeedbacks: Record<keyof typeof en, string> = {
  // Filters
  'adminFeedbacks.filter.all': 'Tous ({count})',
  'adminFeedbacks.filter.unread': 'Non lus ({count})',
  'adminFeedbacks.filter.bugs': 'Bugs ({count})',
  'adminFeedbacks.filter.features': 'Fonctionnalités ({count})',
  'adminFeedbacks.filter.statusLabel': 'Statut\u00a0:',
  'adminFeedbacks.filter.statusAll': 'Tous',

  // List and cards
  'adminFeedbacks.empty': 'Aucun retour à afficher',
  'adminFeedbacks.card.new': 'Nouveau',
  'adminFeedbacks.card.imageAlt': 'Image {number} du retour',
  'adminFeedbacks.card.team': 'Équipe\u00a0: {team}',
  'adminFeedbacks.card.comments': 'Commentaires ({count})\u00a0:',
  'adminFeedbacks.card.markRead': 'Marquer comme lu',
  'adminFeedbacks.card.statusLabel': 'Statut du retour\u00a0: {title}',
  'adminFeedbacks.confirm.delete':
    'Voulez-vous vraiment supprimer ce retour de l’équipe «\u00a0{team}\u00a0»\u202f?',

  // Comment composer (the card's button, the dialog title and its submit)
  'adminFeedbacks.addComment': 'Ajouter un commentaire',
  'adminFeedbacks.comment.feedback': 'Retour\u00a0: {title}',
  'adminFeedbacks.comment.placeholder': 'Rédigez votre commentaire ici…',
  'adminFeedbacks.comment.maxLength': '1\u202f000 caractères au maximum',

  // Notices
  'adminFeedbacks.notice.loadFailed': 'Le chargement des retours a échoué',
  'adminFeedbacks.notice.gone': 'Ce retour n’existe plus\u00a0: son équipe l’a supprimé.',
  'adminFeedbacks.notice.updateFailed': 'La mise à jour du retour a échoué',
  'adminFeedbacks.notice.deleteFailed': 'La suppression du retour a échoué',
  'adminFeedbacks.notice.deleted': 'Retour supprimé',
  'adminFeedbacks.notice.commentAdded': 'Commentaire ajouté',
  'adminFeedbacks.notice.commentLost':
    'Ce retour n’existe plus\u00a0: son équipe l’a supprimé. Votre commentaire n’a pas été enregistré.',
  'adminFeedbacks.notice.commentFailed': 'L’ajout du commentaire a échoué',
};

export default adminFeedbacks;
