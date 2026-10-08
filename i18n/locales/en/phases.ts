// English messages for the "phases" namespace. Every key starts with "phases.".
// English is the source language: keep this text identical to what the
// component rendered before it was translated.
//
// Scope: the retrospective session chrome (header, timer, connection status,
// tips, participants panel) and the phase screens other than
// Brainstorm/Group/Vote (icebreaker, welcome, open actions, discuss, review,
// close), plus the timer, the sync status, the participants panel and the
// comment block the health check reuses.
const phases = {
  // Shared by several phase screens.
  'phases.shared.nextPhase': 'Next Phase',
  'phases.shared.revealResults': 'Reveal Results',
  'phases.shared.propose': 'Propose',
  'phases.shared.directAccept': 'Directly Accept Action',
  'phases.shared.unassigned': 'Unassigned',

  // Session header.
  'phases.header.leave': 'Leave the retrospective',
  'phases.header.showTips': 'Show retro tips',
  'phases.header.hideTips': 'Hide retro tips',
  'phases.header.tips': 'Tips',
  'phases.header.expandParticipants': 'Click to expand participants panel',
  'phases.header.progressFinished': 'finished',
  'phases.header.progressVoted': 'voted',
  'phases.header.user': 'User',
  'phases.header.invite': 'Invite / Join',

  // Session timer (shared with the health check session).
  'phases.timer.start': 'Start timer',
  'phases.timer.pause': 'Pause timer',
  'phases.timer.set': 'Set the timer ({time})',
  'phases.timer.acknowledge': 'Time is up ({time}): stop the alarm',
  'phases.timer.add30Title': 'Add 30 seconds',
  'phases.timer.add30': '+30s',
  'phases.timer.add60Title': 'Add 1 minute',
  'phases.timer.add60': '+1m',
  'phases.timer.minutesPlaceholder': 'MM',
  'phases.timer.secondsPlaceholder': 'SS',
  'phases.timer.minutes': 'Minutes',
  'phases.timer.seconds': 'Seconds',

  // Live-sync chip and banner (shared with the health check session).
  'phases.sync.deniedForbidden':
    'This session belongs to another team. Nothing you do here is being saved — log in with that team to join it.',
  'phases.sync.deniedExpired':
    'Your session has expired, so nothing you do here is being saved. Log in again to rejoin the session.',
  'phases.sync.signedOutTitle': 'Session expired — log in again to rejoin',
  'phases.sync.signedOut': 'Signed out',
  'phases.sync.reconnectingTitle': 'Disconnected — reconnecting',
  'phases.sync.reconnecting': 'Reconnecting…',
  'phases.sync.liveTitle': 'Real-time sync active',
  'phases.sync.live': 'Live',
  'phases.sync.logInAgain': 'Log in again',
  'phases.sync.reconnectingBanner':
    "Reconnecting… editing is paused until you're back online. Nothing you already submitted is lost.",

  // Retro tips panel, and the per-phase tips (components/session/retroTips.ts
  // keeps the timer defaults next to the minutes these timeboxes print).
  'phases.tips.title': 'Retro tips',
  'phases.tips.closePanel': 'Close retro tips panel',
  'phases.tips.hide': 'Hide',
  'phases.tips.purpose': 'Purpose',
  'phases.tips.fallbackPurpose':
    'Use the current stage to keep the conversation focused and move the retrospective forward.',
  'phases.tips.fallbackTimebox': 'Adjust to team size',
  'phases.tips.timeboxMinutes': '{minutes} min',
  'phases.tips.timeboxMinutesPerTopic': '{minutes} min per topic',
  'phases.tips.icebreaker.label': 'Icebreaker',
  'phases.tips.icebreaker.purpose':
    'Help everyone speak early and lower the barrier to participation. Keep it light: one quick answer per person is enough.',
  'phases.tips.welcome.label': 'Welcome',
  'phases.tips.welcome.purpose':
    "Check the room before starting the retrospective. This step helps the facilitator understand the team's energy and gives everyone a quick way to signal how they arrive today.",
  'phases.tips.openActions.label': 'Open actions',
  'phases.tips.openActions.purpose':
    'Review actions from previous retrospectives and decide which ones are still worth pursuing. Some unfinished actions should continue, while others may be outdated and can be closed without carrying them forward.',
  'phases.tips.brainstorm.label': 'Brainstorm',
  'phases.tips.brainstorm.purpose':
    'Give everyone time to think and write silently on their own before any group discussion starts. The goal is to collect as many observations, frustrations, wins, and ideas as possible without influence from others.',
  'phases.tips.group.label': 'Group',
  'phases.tips.group.purpose':
    'Go through the topics raised by the whole group, clarify what each ticket means, and cluster similar tickets together. Avoid debating solutions at this stage, but clarification questions are welcome.',
  'phases.tips.vote.label': 'Vote',
  'phases.tips.vote.purpose':
    'Prioritize which topics deserve discussion in this session. Voting helps the team focus its time on the themes that feel most important right now.',
  'phases.tips.discuss.label': 'Discuss',
  'phases.tips.discuss.purpose':
    'Go through the topics starting with the ones that received the most votes. For each topic, aim to agree on one or more concrete actions that the team validates to improve the situation.',
  'phases.tips.review.label': 'Review',
  'phases.tips.review.purpose':
    'Review the actions selected during discussion, make sure each one is clear, and assign every action to an owner.',
  'phases.tips.close.label': 'Close',
  'phases.tips.close.purpose':
    'Wrap up the retrospective with a quick ROTI vote and close the session cleanly. If the feedback shows the retro did not feel like a good use of time, use this step to capture actions that will improve future retrospectives.',

  // Icebreaker phase.
  'phases.icebreaker.title': 'Icebreaker',
  'phases.icebreaker.placeholder': 'Type or generate a question...',
  'phases.icebreaker.random': 'Random',
  'phases.icebreaker.start': 'Start Session',
  'phases.icebreaker.waiting': 'Waiting for facilitator to start...',

  // Welcome (happiness check) phase.
  'phases.welcome.title': 'Happiness Check',
  'phases.welcome.question': 'How are you feeling about the last sprint?',
  'phases.welcome.votedCount': '{voted} / {total} voted',
  'phases.welcome.participantsVoted': '{voted} / {total} participants voted',

  // Open actions phase.
  'phases.openActions.title': 'Review Open Actions',
  'phases.openActions.listTitle': 'Open actions',
  'phases.openActions.empty': 'No open actions from previous sprints.',
  'phases.openActions.rateNowTitle':
    'Ask the team to rate this action now instead of at the next retrospective',
  'phases.openActions.rateNow': 'Rate now',

  // Action rows shared by the open actions and review phases.
  'phases.actions.contextTicket': 'Re: "{text}"',
  'phases.actions.contextGroup': 'Re: Group "{title}"',
  'phases.actions.markDone': 'Mark action as done',
  'phases.actions.markNotDone': 'Mark action as not done',
  'phases.actions.assignee': 'Assignee for the action: {text}',

  // Discuss phase.
  'phases.discuss.title': 'Discuss & Propose Actions',
  'phases.discuss.showVotes': 'Show votes',
  'phases.discuss.myVotesTitle': 'You put {count} of your votes on this topic',
  'phases.discuss.myVotes_one': 'Your {count} vote',
  'phases.discuss.myVotes_other': 'Your {count} votes',
  // English has always printed "votes" here, even for one: the `_one` form
  // keeps that output while letting French agree with the number.
  'phases.discuss.totalVotes_one': '{count} vote',
  'phases.discuss.totalVotes_other': '{count} votes',
  'phases.discuss.uniqueVotersTitle_one': '{count} distinct participant voted on this topic',
  'phases.discuss.uniqueVotersTitle_other': '{count} distinct participants voted on this topic',
  'phases.discuss.uniqueVoters_one': '{count} voter',
  'phases.discuss.uniqueVoters_other': '{count} voters',
  'phases.discuss.group': 'Group',
  'phases.discuss.moveOnTitle': '{voted}/{total} voted to move on — vote to skip this discussion',
  'phases.discuss.moveOn': 'Move On',
  'phases.discuss.clickToDiscuss': 'Click to discuss',
  'phases.discuss.proposals': 'Proposals',
  'phases.discuss.accepted': 'Accepted: {text}',
  'phases.discuss.undoAcceptTitle': 'Undo accept (back to proposals)',
  'phases.discuss.undoAccept': 'Undo accept',
  'phases.discuss.rejected': 'Rejected: {text}',
  'phases.discuss.undoRejectTitle': 'Undo reject (back to proposals)',
  'phases.discuss.undoReject': 'Undo reject',
  'phases.discuss.proposePlaceholder': 'Propose an action...',

  // A proposal row and its vote-status tooltip (discuss and close phases).
  'phases.proposal.votedRatio': '{voted}/{total} voted',
  // The English verb does not change with the number; the French one does.
  'phases.proposal.votedCount_one': '{count} voted',
  'phases.proposal.votedCount_other': '{count} voted',
  'phases.proposal.notVoted': 'Not voted ({count})',
  'phases.proposal.everyoneVoted': 'Everyone voted',
  'phases.proposal.voted': 'Voted ({count})',
  'phases.proposal.facilitatorTag': '(facilitator)',
  'phases.proposal.leftTag': '(left)',
  'phases.proposal.noOneYet': 'No one yet',
  'phases.proposal.facilitatorNotCounted': 'Facilitator is not counted in the vote total.',
  'phases.proposal.save': 'Save the action',
  'phases.proposal.cancelEdit': 'Cancel the edit',
  'phases.proposal.clickToEdit': 'Click to edit',
  'phases.proposal.delete': 'Delete proposal',
  'phases.proposal.votedBadge': 'Voted',
  'phases.proposal.voteNeeded': 'Vote needed',
  'phases.proposal.rejectTitle': 'Reject proposal (can be undone)',
  'phases.proposal.reject': 'Reject',
  'phases.proposal.accept': 'Accept',

  // Review phase.
  'phases.review.deleteAction': 'Delete action',
  'phases.review.confirmDelete': 'Confirm?',
  'phases.review.rotiFollowUp': 'ROTI Follow-up',
  'phases.review.untitled': 'Untitled',
  'phases.review.title': 'Review Actions',
  'phases.review.next': 'Next: Close Retro',
  'phases.review.summaryTitle': 'Retro Report Summary',
  'phases.review.generating': 'Generating...',
  'phases.review.generate': 'Generate with AI',
  'phases.review.summaryPlaceholder': 'Write the retrospective report summary here...',
  'phases.review.noSummary': 'No retrospective summary yet.',
  'phases.review.newActions': 'New Actions from this Session',
  'phases.review.noNewActions': 'No new actions created.',
  'phases.review.previousActions': 'All Previous Actions (Unfinished)',
  'phases.review.noHistory': 'No history found.',

  // Close phase.
  'phases.close.title': 'Session Closed',
  'phases.close.thanks': 'Thank you for your contribution!',
  'phases.close.rotiTitle': 'ROTI (Return on Time Invested)',
  'phases.close.membersVoted': '{voted} / {total} members have voted',
  'phases.close.returnToDashboard': 'Return to Dashboard',
  'phases.close.leave': 'Leave Retrospective',

  // ROTI follow-up actions (close phase).
  'phases.rotiFollowUp.title': 'ROTI Follow-up Actions',
  'phases.rotiFollowUp.assignee': 'Assignee for the follow-up action: {text}',
  'phases.rotiFollowUp.owner': 'Owner: {name}',
  'phases.rotiFollowUp.unknownOwner': 'Unknown',
  'phases.rotiFollowUp.placeholder': 'Propose a follow-up action from ROTI feedback...',

  // Impact rating of recently closed actions (open actions phase).
  'phases.rating.score1': 'No real impact',
  'phases.rating.score2': 'Some impact',
  'phases.rating.score3': 'Clear impact',
  'phases.rating.scaleHint': '1 = no real impact · 3 = clear impact',
  'phases.rating.noRatingYet': 'No rating yet',
  'phases.rating.averageSentence': 'Average impact {score} out of 3.',
  'phases.rating.spreadScore1': '{count} no real impact',
  'phases.rating.spreadScore2': '{count} some impact',
  'phases.rating.spreadScore3': '{count} clear impact',
  'phases.rating.spreadAbstained': '{count} not concerned',
  'phases.rating.reinstateTitle': 'Put this action back into this round',
  'phases.rating.deferTitle': 'Ask the team again at the next retrospective',
  'phases.rating.rateLater': 'Rate later',
  'phases.rating.postponed': 'Postponed to the next retrospective',
  'phases.rating.groupLabel': 'Impact of the action: {text}',
  'phases.rating.starLabel': '{value} of 3 — {label}',
  'phases.rating.notConcerned': 'Not concerned',
  'phases.rating.castCount': '{cast} of {total} rated',
  'phases.rating.title': 'Recently closed — rate the impact',
  'phases.rating.question': 'Did this change anything for the team?',
  'phases.rating.hideResults': 'Hide results',
  'phases.rating.revealResults': 'Reveal results',
  'phases.rating.notice':
    'Your team can now rate the impact of closed actions. You can turn this off any time in Team Settings.',
  'phases.rating.dismissNotice': 'Dismiss the impact rating notice',

  // Participants panel (shared with the health check session).
  'phases.participants.activityBrainstorm': 'writing a ticket',
  'phases.participants.activityProposal': 'proposing action',
  'phases.participants.noTicketsTitle': 'No tickets added yet',
  'phases.participants.noTickets': 'no tickets',
  'phases.participants.ticketsAdded_one': '{count} ticket added',
  'phases.participants.ticketsAdded_other': '{count} tickets added',
  'phases.participants.title': 'Participants ({count})',
  'phases.participants.expand': 'Expand panel',
  'phases.participants.collapse': 'Collapse panel',
  'phases.participants.online': 'Online',
  'phases.participants.you': '(you)',
  'phases.participants.leftTitle':
    'Marked by the facilitator as having left the session — not counted in vote totals',
  'phases.participants.left': 'Left the session',
  // Lower-case on purpose: the panel capitalises the role with CSS.
  'phases.participants.roleFacilitator': 'facilitator',
  'phases.participants.roleParticipant': 'participant',
  'phases.participants.markReturned': 'Mark {name} as returned',
  'phases.participants.markLeft': 'Mark {name} as having left the session',
  'phases.participants.ratedAll': 'Rated every action',
  'phases.participants.ratedSome': 'Rated {rated} of {total} actions',
  'phases.participants.voteRecorded': 'Vote recorded',
  'phases.participants.finished': 'Finished',
  'phases.participants.invitedHeading': 'Invited · waiting to join ({count})',
  'phases.participants.invitationSentTo': 'Invitation sent to {email}',
  'phases.participants.invitationSent': 'Invitation sent',
  'phases.participants.invited': 'Invited',
  'phases.participants.footerRated': '{done} / {total} rated all actions',
  'phases.participants.footerHappiness': '{done} / {total} submitted happiness',
  'phases.participants.footerRoti': '{done} / {total} voted in close-out',
  'phases.participants.footerTickets_one': '{count} ticket added so far',
  'phases.participants.footerTickets_other': '{count} tickets added so far',
  'phases.participants.footerFinished': '{done} / {total} finished',
  'phases.participants.invite': 'Invite Team',

  // Comment block of a health check dimension (discuss phase).
  'phases.comments.title': 'Comments',
  'phases.comments.empty': 'No comments yet.',
  'phases.comments.placeholder': 'Add a comment...',
  'phases.comments.submit': 'Comment',
  'phases.comments.editTitle': 'Edit your comment',
  'phases.comments.edit': 'Edit comment',
  'phases.comments.deleteTitle': 'Delete your comment',
  'phases.comments.delete': 'Delete comment',
  'phases.comments.confirmDelete': 'Delete?',
  'phases.comments.authorLabel': '{name}:',
};

export default phases;
