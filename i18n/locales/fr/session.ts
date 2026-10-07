import type en from '../en/session';

// French messages for the "session" namespace. The type makes a missing or extra
// key a compile error, and i18nDictionaries.test.ts checks the placeholders.
const session: Record<keyof typeof en, string> = {
  // Session.tsx — whole screen
  'session.notFound': 'Session introuvable',
  'session.anonymousParticipant': 'Participant {number}',

  // Context line of an action
  'session.actionContext.rotiFollowUp': 'Concerne\u00a0: suivi du ROTI',
  'session.actionContext.ticket': 'Concerne\u00a0: «\u00a0{text}\u00a0»',
  'session.actionContext.group': 'Concerne\u00a0: groupe «\u00a0{title}\u00a0»',

  // Phase action bar (Brainstorm / Group / Vote)
  'session.board.brainstormTitle': 'Brainstorming',
  'session.board.groupTitle': 'Regrouper les idées',
  'session.board.voteTitle': 'Vote',
  'session.board.votesRemaining': 'Votes restants\u00a0: {count}',
  'session.board.suggestGroups': 'Suggérer des groupes avec l’IA',
  'session.board.suggestGroupsHint':
    'Demander à l’assistant de proposer des regroupements. Vous validerez chaque suggestion avant qu’elle soit appliquée.',
  'session.board.revealCards': 'Révéler les cartes',
  'session.board.colorBy': 'Couleur par\u00a0:',
  'session.board.colorByAria': 'Colorer les cartes par',
  'session.board.colorByTopic': 'Thème',
  'session.board.colorByAuthor': 'Auteur',
  'session.board.doneEditingLayout': 'Terminer la modification',
  'session.board.editLayout': 'Modifier la disposition',
  'session.board.oneVotePerItem': '1 vote par élément',
  'session.board.maxVotes': 'Max\u00a0:',
  'session.board.decreaseMaxVotes': 'Diminuer le nombre maximal de votes',
  'session.board.increaseMaxVotes': 'Augmenter le nombre maximal de votes',
  'session.board.finished': 'Terminé\u202f!',
  'session.board.imFinished': 'J’ai terminé',
  'session.board.nextPhase': 'Phase suivante',

  // Touch hints (role="status", phone layout only)
  'session.hint.groupSelected':
    'Carte sélectionnée. Touchez une autre carte, un groupe ou une colonne pour l’y déplacer. Touchez à nouveau la carte sélectionnée, ou appuyez sur Échap, pour annuler.',
  'session.hint.groupIdle':
    'Astuce tactile\u00a0: touchez une carte pour la sélectionner, puis touchez une autre carte ou un groupe pour l’y déplacer.',
  'session.hint.moveSelected':
    'Sélection effectuée. Touchez «\u00a0Déplacer ici\u00a0» dans une autre colonne pour l’y déplacer. Touchez à nouveau la sélection, ou appuyez sur Échap, pour annuler.',
  'session.hint.moveIdleRevealed':
    'Astuce tactile\u00a0: touchez une carte pour la sélectionner, puis choisissez la colonne où la déplacer.',
  'session.hint.moveIdleOwnCards':
    'Astuce tactile\u00a0: touchez l’une de vos cartes pour la sélectionner, puis choisissez la colonne où la déplacer.',

  // Columns
  'session.column.moveTo': 'Déplacer vers {title}',
  'session.column.remove': 'Supprimer la colonne {title}',
  'session.column.addIdeaPlaceholder': 'Ajouter une idée…',
  'session.column.reconnectingPlaceholder': 'Reconnexion… modification en pause',
  'session.column.pressEnterToAdd': 'Appuyez sur Entrée pour ajouter',
  'session.column.addIdea': 'Ajouter l’idée',
  'session.column.moveSelectedCardHere': 'Déplacer la carte sélectionnée ici',
  'session.column.newColumnTitle': 'Nouvelle colonne',
  'session.column.addColumn': '+ Ajouter une colonne',

  // Ticket card
  'session.ticket.editTitle': 'Modifier',
  'session.ticket.editAria': 'Modifier la carte',
  'session.ticket.addReaction': 'Ajouter une réaction',
  'session.ticket.delete': 'Supprimer la carte',
  'session.ticket.comments': 'Commentaires',
  'session.ticket.removeVote': 'Retirer un vote de cette carte',
  'session.ticket.addVote': 'Ajouter un vote à cette carte',

  // Group container
  'session.group.label': 'Groupe',
  'session.group.addToGroup': 'Ajouter au groupe',
  'session.group.aiSuggestingPlaceholder': 'L’IA propose un titre…',
  'session.group.namePlaceholder': 'Nommer ce groupe…',
  'session.group.untitled': 'Groupe sans titre',
  'session.group.delete': 'Supprimer le groupe',
  'session.group.addSelectedCard': 'Ajouter la carte sélectionnée à ce groupe',
  'session.group.removeVote': 'Retirer un vote de ce groupe',
  'session.group.addVote': 'Ajouter un vote à ce groupe',

  // Grouping banners on a ticket card (TicketGroupingBanner.tsx)
  'session.groupingBanner.dropTarget': 'Regrouper avec cette carte',
  'session.groupingBanner.selected': 'Sélectionnée - touchez pour annuler',

  // Pointerless grouping (groupingKeyboard.ts)
  'session.grouping.fallback.ticket': 'Carte sans titre',
  'session.grouping.fallback.group': 'Groupe sans titre',
  'session.grouping.fallback.column': 'Colonne sans titre',
  'session.grouping.aria.selected':
    'Carte sélectionnée pour le regroupement\u00a0: {label}. Activez ou appuyez sur Échap pour annuler.',
  'session.grouping.aria.groupWithTicket': 'Regrouper la carte sélectionnée avec {label}.',
  'session.grouping.aria.addToGroup': 'Ajouter la carte sélectionnée au groupe {label}.',
  'session.grouping.aria.moveToColumn': 'Sortir la carte sélectionnée de son groupe et la placer dans {label}.',
  'session.grouping.aria.pickUp': 'Prendre la carte {label} pour la regrouper.',
  'session.grouping.button.cancel': 'Annuler',
  'session.grouping.button.groupHere': 'Regrouper ici',
  'session.grouping.button.pickUp': 'Prendre',

  // Brainstorm move between columns (brainstormMove.ts)
  'session.move.fallback.ticket': 'Carte sans titre',
  'session.move.fallback.group': 'Groupe sans titre',
  'session.move.fallback.column': 'Colonne sans titre',
  'session.move.aria.selected':
    'Élément sélectionné pour le déplacement\u00a0: {label}. Activez ou appuyez sur Échap pour annuler.',
  'session.move.aria.moveCardToColumn': 'Déplacer la carte sélectionnée vers {label}.',
  'session.move.aria.moveGroupToColumn': 'Déplacer le groupe sélectionné vers {label}.',
  'session.move.aria.pickUpCard': 'Déplacer la carte {label} vers une autre colonne.',
  'session.move.aria.pickUpGroup': 'Déplacer le groupe {label} vers une autre colonne.',
  'session.move.button.cancel': 'Annuler',
  'session.move.button.moveHere': 'Déplacer ici',
  'session.move.button.move': 'Déplacer',

  // Origin chip (TicketOriginBadge.tsx)
  'session.originBadge.title': 'Cette carte a été rédigée à l’origine dans «\u00a0{column}\u00a0»',
  'session.originBadge.from': 'Origine\u00a0: {column}',

  // AI group suggestions (Session.tsx + AiGroupSuggestionsModal.tsx)
  'session.aiGroups.analyzeFailed': 'L’assistant n’a pas pu analyser les cartes.',
  'session.aiGroups.requestFailed': 'La requête à l’IA a échoué.',
  'session.aiGroups.dialogLabel': 'Suggestions de groupes par l’IA',
  'session.aiGroups.title': 'Suggestions de groupes par l’IA',
  'session.aiGroups.closeAria': 'Fermer les suggestions',
  'session.aiGroups.intro':
    'L’assistant propose des regroupements à partir des cartes du brainstorming. Examinez chacun d’eux, décochez les cartes que vous souhaitez exclure et acceptez les regroupements qui vous semblent pertinents\u00a0: rien n’est appliqué automatiquement.',
  'session.aiGroups.analyzing': 'Analyse des cartes…',
  'session.aiGroups.errorTitle': 'Impossible de générer des suggestions',
  'session.aiGroups.noClusters':
    'L’assistant n’a pas trouvé de cartes qui vont clairement ensemble. Vous pouvez toujours regrouper les cartes manuellement.',
  'session.aiGroups.untitledCluster': 'Regroupement sans titre',
  'session.aiGroups.ticketCountSingular': '({count} carte)',
  'session.aiGroups.ticketCountPlural': '({count} cartes)',
  'session.aiGroups.ticketCountPartial': '({included} cartes sur {total})',
  'session.aiGroups.applied': 'Appliqué',
  'session.aiGroups.dismiss': 'Ignorer',
  'session.aiGroups.accept': 'Accepter',
  'session.aiGroups.needTwoTicketsTitle': 'Incluez au moins 2 cartes pour créer ce groupe',
  'session.aiGroups.needTwoTickets': 'Incluez au moins 2 cartes pour créer ce groupe.',
  'session.aiGroups.includeTicket': 'Inclure «\u00a0{text}\u00a0» dans ce groupe',
  'session.aiGroups.allDismissed':
    'Vous avez ignoré toutes les suggestions. Régénérez-les pour réessayer, ou fermez cette fenêtre et regroupez les cartes manuellement.',
  'session.aiGroups.acceptedCount': 'Acceptées\u00a0: {accepted} sur {total}',
  'session.aiGroups.regenerate': 'Régénérer',
  'session.aiGroups.acceptAllRemaining': 'Accepter toutes les suggestions restantes',
  'session.aiGroups.close': 'Fermer',

  // Ticket comments (TicketCommentsModal.tsx)
  'session.comments.dialogLabel': 'Commentaires sur la carte\u00a0: {text}',
  'session.comments.closeTitle': 'Fermer',
  'session.comments.closeAria': 'Fermer les commentaires',
  'session.comments.empty': 'Aucun commentaire pour l’instant. Ajoutez le premier\u202f!',
  'session.comments.saveTitle': 'Enregistrer',
  'session.comments.saveAria': 'Enregistrer le commentaire',
  'session.comments.cancelTitle': 'Annuler',
  'session.comments.cancelAria': 'Annuler la modification du commentaire',
  'session.comments.edit': 'Modifier le commentaire',
  'session.comments.delete': 'Supprimer le commentaire',
  'session.comments.placeholder': 'Ajouter un commentaire…',
  'session.comments.sendTitle': 'Envoyer',
  'session.comments.sendAria': 'Envoyer le commentaire',
  'session.comments.justNow': 'à l’instant',
  'session.comments.minutesAgo': 'il y a {count} min',
  'session.comments.hoursAgo': 'il y a {count} h',
};

export default session;
