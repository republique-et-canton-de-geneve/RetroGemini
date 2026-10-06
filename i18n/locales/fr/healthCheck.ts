import type en from '../en/healthCheck';

// French messages for the "healthCheck" namespace. The type makes a missing or extra
// key a compile error, and i18nDictionaries.test.ts checks the placeholders.
//
// Vocabulary: the SURVEY phase is « évaluation » (common.phase.SURVEY), so a
// participant's 1–5 score is a « note » — two words, never the same one for both.
const healthCheck: Record<keyof typeof en, string> = {
  'healthCheck.notFound': 'Session introuvable',
  'healthCheck.anonymousParticipant': 'Participant {number}',
  'healthCheck.unknownMember': 'Inconnu',
  'healthCheck.comment.you': 'Vous',
  'healthCheck.comment.ownName': '{name} (vous)',

  'healthCheck.header.leave': 'Quitter le bilan de santé',
  'healthCheck.header.expandParticipants': 'Cliquer pour déployer le panneau des participants',
  'healthCheck.header.finishedLabel': 'ont terminé',
  'healthCheck.header.votedLabel': 'ont voté',
  'healthCheck.header.participantsLabel': 'participants',
  'healthCheck.header.invite': 'Inviter / Rejoindre',
  'healthCheck.header.user': 'Utilisateur',

  'healthCheck.dimension.bad': 'Mauvais :',
  'healthCheck.dimension.good': 'Bon :',

  'healthCheck.survey.title': 'Notez chaque dimension de santé',
  'healthCheck.survey.finishedCount': '{finished} / {total} participants ont terminé',
  'healthCheck.survey.next': 'Suivant : discussion',
  'healthCheck.survey.anonymousNotice': 'Vos notes sont anonymes',
  'healthCheck.survey.visibleNotice': "Vos notes sont visibles par l'équipe",
  'healthCheck.survey.scale.stronglyDisagree': "Pas du tout d'accord",
  'healthCheck.survey.scale.neutral': 'Neutre',
  'healthCheck.survey.scale.stronglyAgree': "Tout à fait d'accord",
  'healthCheck.survey.commentPlaceholder': 'Commentaires supplémentaires (facultatif)…',
  'healthCheck.survey.saved': 'ENREGISTRÉ',

  'healthCheck.discuss.title': "Discutez des résultats de l'évaluation et identifiez des actions",
  'healthCheck.discuss.showVotes': 'Afficher les votes',
  'healthCheck.discuss.next': 'Suivant : revue',
  'healthCheck.discuss.ratingCount_one': '{count} note',
  'healthCheck.discuss.ratingCount_other': '{count} notes',
  'healthCheck.discuss.commentCount_one': '{count} commentaire',
  'healthCheck.discuss.commentCount_other': '{count} commentaires',
  'healthCheck.discuss.hideDetails': 'Masquer les détails de la dimension',
  'healthCheck.discuss.showDetails': 'Afficher les détails de la dimension (bon / mauvais)',
  'healthCheck.discuss.toggleDetails': 'Afficher ou masquer les détails de la dimension',
  'healthCheck.discuss.voteDistribution': 'Répartition des votes',
  'healthCheck.discuss.actions': 'Actions',
  'healthCheck.discuss.proposePlaceholder': 'Proposer une action…',
  'healthCheck.discuss.propose': 'Proposer',
  'healthCheck.discuss.directAccept': "Accepter directement l'action",
  'healthCheck.discuss.accepted': 'Acceptée :',
  'healthCheck.discuss.deleteAction': "Supprimer l'action",
  'healthCheck.discuss.confirmDelete': 'Confirmer ?',

  'healthCheck.review.title': 'Revue des actions',
  'healthCheck.review.next': 'Suivant : clôture',
  'healthCheck.review.sessionActions': 'Actions de cette session ({count})',
  'healthCheck.review.empty': 'Aucune action créée pour le moment.',
  'healthCheck.review.general': 'Général',
  'healthCheck.review.markNotDone': "Marquer l'action comme non terminée",
  'healthCheck.review.markDone': "Marquer l'action comme terminée",
  'healthCheck.review.assigneeFor': "Responsable de l'action : {action}",
  'healthCheck.review.unassigned': 'Non assignée',

  'healthCheck.close.title': 'Bilan de santé terminé',
  'healthCheck.close.thanks': 'Merci pour votre contribution !',
  'healthCheck.close.rotiTitle': 'ROTI (retour sur le temps investi)',
  'healthCheck.close.votedCount': '{voted} / {total} membres ont voté',
  'healthCheck.close.reveal': 'Révéler les résultats',
  'healthCheck.close.returnToDashboard': 'Retour au tableau de bord',
  'healthCheck.close.leave': 'Quitter le bilan de santé',

  'healthCheck.participants.title': 'Participants ({count})',
  'healthCheck.participants.expand': 'Déployer le panneau',
  'healthCheck.participants.collapse': 'Réduire le panneau',
  'healthCheck.participants.online': 'En ligne',
  'healthCheck.participants.you': '(vous)',
  'healthCheck.participants.role.facilitator': 'facilitateur',
  'healthCheck.participants.role.participant': 'participant',
  'healthCheck.participants.finished': 'Terminé',
  'healthCheck.participants.surveyProgress': "{finished} / {total} ont terminé l'évaluation",
  'healthCheck.participants.closeProgress': '{voted} / {total} ont voté à la clôture',
  'healthCheck.participants.count_one': '{count} participant',
  'healthCheck.participants.count_other': '{count} participants',
  'healthCheck.participants.invite': "Inviter l'équipe",
};

export default healthCheck;
