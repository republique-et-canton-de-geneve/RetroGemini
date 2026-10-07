// English messages for the "session" namespace. Every key starts with "session.".
// English is the source language: keep this text identical to what the
// component rendered before it was translated.
const session = {
  // Session.tsx — whole screen
  'session.notFound': 'Session not found',
  'session.anonymousParticipant': 'Participant {number}',

  // Context line of an action, written into the shared session by the client
  // that builds the snapshot (shared content, in that person's language).
  'session.actionContext.rotiFollowUp': 'Re: ROTI follow-up',
  'session.actionContext.ticket': 'Re: "{text}"',
  'session.actionContext.group': 'Re: Group "{title}"',

  // Phase action bar (Brainstorm / Group / Vote)
  'session.board.brainstormTitle': 'Brainstorm',
  'session.board.groupTitle': 'Group Ideas',
  'session.board.voteTitle': 'Vote',
  'session.board.votesRemaining': '{count} votes remaining',
  'session.board.suggestGroups': 'Suggest groups with AI',
  'session.board.suggestGroupsHint':
    'Ask the assistant to suggest groupings. You will validate each suggestion before it is applied.',
  'session.board.revealCards': 'Reveal cards',
  'session.board.colorBy': 'Color by:',
  'session.board.colorByAria': 'Color cards by',
  'session.board.colorByTopic': 'Topic',
  'session.board.colorByAuthor': 'Author',
  'session.board.doneEditingLayout': 'Done Editing',
  'session.board.editLayout': 'Edit Layout',
  'session.board.oneVotePerItem': '1 vote/item',
  'session.board.maxVotes': 'Max:',
  'session.board.decreaseMaxVotes': 'Decrease max votes',
  'session.board.increaseMaxVotes': 'Increase max votes',
  'session.board.finished': 'Finished!',
  'session.board.imFinished': "I'm Finished",
  'session.board.nextPhase': 'Next Phase',

  // Touch hints (role="status", phone layout only)
  'session.hint.groupSelected':
    'Card selected. Tap another card, a group, or a column to move it there. Tap the selected card again, or press Escape, to cancel.',
  'session.hint.groupIdle': 'Touch hint: tap a card to select it, then tap another card or group to move it.',
  'session.hint.moveSelected':
    'Selected. Tap "Move here" in another column to move it there. Tap the selection again, or press Escape, to cancel.',
  'session.hint.moveIdleRevealed': 'Touch hint: tap a card to select it, then choose the column to move it to.',
  'session.hint.moveIdleOwnCards':
    'Touch hint: tap one of your own cards to select it, then choose the column to move it to.',

  // Columns
  'session.column.moveTo': 'Move to {title}',
  'session.column.remove': 'Remove the {title} column',
  'session.column.addIdeaPlaceholder': 'Add an idea...',
  'session.column.reconnectingPlaceholder': 'Reconnecting… editing paused',
  'session.column.pressEnterToAdd': 'Press Enter to add',
  'session.column.addIdea': 'Add idea',
  'session.column.moveSelectedCardHere': 'Move selected card here',
  'session.column.newColumnTitle': 'New Column',
  'session.column.addColumn': '+ Add Column',

  // Ticket card
  'session.ticket.editTitle': 'Edit',
  'session.ticket.editAria': 'Edit ticket',
  'session.ticket.addReaction': 'Add reaction',
  'session.ticket.delete': 'Delete ticket',
  'session.ticket.comments': 'Comments',
  'session.ticket.removeVote': 'Remove a vote from this ticket',
  'session.ticket.addVote': 'Add a vote to this ticket',

  // Group container
  'session.group.label': 'Group',
  'session.group.addToGroup': 'Add to Group',
  'session.group.aiSuggestingPlaceholder': 'AI is suggesting...',
  'session.group.namePlaceholder': 'Name this group...',
  'session.group.untitled': 'Untitled Group',
  'session.group.delete': 'Delete group',
  'session.group.addSelectedCard': 'Add selected card to this group',
  'session.group.removeVote': 'Remove a vote from this group',
  'session.group.addVote': 'Add a vote to this group',

  // Grouping banners on a ticket card (TicketGroupingBanner.tsx)
  'session.groupingBanner.dropTarget': 'Group with this',
  'session.groupingBanner.selected': 'Selected - Tap to cancel',

  // Pointerless grouping (groupingKeyboard.ts)
  'session.grouping.fallback.ticket': 'Untitled ticket',
  'session.grouping.fallback.group': 'Untitled group',
  'session.grouping.fallback.column': 'Untitled column',
  'session.grouping.aria.selected': 'Selected for grouping: {label}. Activate or press Escape to cancel.',
  'session.grouping.aria.groupWithTicket': 'Group the selected ticket with {label}.',
  'session.grouping.aria.addToGroup': 'Add the selected ticket to the group {label}.',
  'session.grouping.aria.moveToColumn': 'Move the selected ticket out of its group, into {label}.',
  'session.grouping.aria.pickUp': 'Pick up the ticket {label} for grouping.',
  'session.grouping.button.cancel': 'Cancel',
  'session.grouping.button.groupHere': 'Group here',
  'session.grouping.button.pickUp': 'Pick up',

  // Brainstorm move between columns (brainstormMove.ts)
  'session.move.fallback.ticket': 'Untitled card',
  'session.move.fallback.group': 'Untitled group',
  'session.move.fallback.column': 'Untitled column',
  'session.move.aria.selected': 'Selected to move: {label}. Activate or press Escape to cancel.',
  'session.move.aria.moveCardToColumn': 'Move the selected card to {label}.',
  'session.move.aria.moveGroupToColumn': 'Move the selected group to {label}.',
  'session.move.aria.pickUpCard': 'Move the card {label} to another column.',
  'session.move.aria.pickUpGroup': 'Move the group {label} to another column.',
  'session.move.button.cancel': 'Cancel',
  'session.move.button.moveHere': 'Move here',
  'session.move.button.move': 'Move',

  // Origin chip (TicketOriginBadge.tsx)
  'session.originBadge.title': 'This ticket was originally written in "{column}"',
  'session.originBadge.from': 'from {column}',

  // AI group suggestions (Session.tsx + AiGroupSuggestionsModal.tsx)
  'session.aiGroups.analyzeFailed': 'The assistant could not analyze the tickets.',
  'session.aiGroups.requestFailed': 'AI request failed.',
  'session.aiGroups.dialogLabel': 'AI group suggestions',
  'session.aiGroups.title': 'AI Group Suggestions',
  'session.aiGroups.closeAria': 'Close suggestions',
  'session.aiGroups.intro':
    'The assistant proposes clusters based on the brainstormed tickets. Review each one, uncheck any ticket you want to leave out, and accept the groupings you find relevant — nothing is applied automatically.',
  'session.aiGroups.analyzing': 'Analyzing tickets...',
  'session.aiGroups.errorTitle': 'Could not generate suggestions',
  'session.aiGroups.noClusters':
    'The assistant did not find clusters that obviously belong together. You can still group cards manually.',
  'session.aiGroups.untitledCluster': 'Untitled cluster',
  // The original rule is `count > 1`, so 0 reads singular in English too:
  // two keys and the original condition rather than a plural pair.
  'session.aiGroups.ticketCountSingular': '({count} ticket)',
  'session.aiGroups.ticketCountPlural': '({count} tickets)',
  'session.aiGroups.ticketCountPartial': '({included} of {total} tickets)',
  'session.aiGroups.applied': 'Applied',
  'session.aiGroups.dismiss': 'Dismiss',
  'session.aiGroups.accept': 'Accept',
  'session.aiGroups.needTwoTicketsTitle': 'Include at least 2 tickets to create this group',
  'session.aiGroups.needTwoTickets': 'Include at least 2 tickets to create this group.',
  'session.aiGroups.includeTicket': 'Include "{text}" in this group',
  'session.aiGroups.allDismissed':
    "You've dismissed every suggestion. Regenerate to try again, or close and group the cards manually.",
  'session.aiGroups.acceptedCount': '{accepted} of {total} accepted',
  'session.aiGroups.regenerate': 'Regenerate',
  'session.aiGroups.acceptAllRemaining': 'Accept all remaining',
  'session.aiGroups.close': 'Close',

  // Ticket comments (TicketCommentsModal.tsx)
  'session.comments.dialogLabel': 'Comments on the ticket: {text}',
  'session.comments.closeTitle': 'Close',
  'session.comments.closeAria': 'Close comments',
  'session.comments.empty': 'No comments yet. Be the first to comment!',
  'session.comments.saveTitle': 'Save',
  'session.comments.saveAria': 'Save comment',
  'session.comments.cancelTitle': 'Cancel',
  'session.comments.cancelAria': 'Cancel editing comment',
  'session.comments.edit': 'Edit comment',
  'session.comments.delete': 'Delete comment',
  'session.comments.placeholder': 'Add a comment...',
  'session.comments.sendTitle': 'Send',
  'session.comments.sendAria': 'Send comment',
  'session.comments.justNow': 'just now',
  'session.comments.minutesAgo': '{count}m ago',
  'session.comments.hoursAgo': '{count}h ago',
};

export default session;
