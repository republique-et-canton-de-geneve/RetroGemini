// English messages for the "healthCheck" namespace. Every key starts with "healthCheck.".
// English is the source language: keep this text identical to what the
// component rendered before it was translated.
//
// Dimension names and their good/bad descriptions are NOT here: they are
// template data, authored in both languages (team_health_en / team_health_fr)
// and stored on the session, so every participant reads the same wording.
const healthCheck = {
  'healthCheck.notFound': 'Session not found',
  'healthCheck.anonymousParticipant': 'Participant {number}',
  'healthCheck.unknownMember': 'Unknown',
  'healthCheck.comment.you': 'You',
  'healthCheck.comment.ownName': '{name} (you)',

  'healthCheck.header.leave': 'Leave the health check',
  'healthCheck.header.expandParticipants': 'Click to expand participants panel',
  'healthCheck.header.finishedLabel': 'finished',
  'healthCheck.header.votedLabel': 'voted',
  'healthCheck.header.participantsLabel': 'participants',
  'healthCheck.header.invite': 'Invite / Join',
  'healthCheck.header.user': 'User',

  'healthCheck.dimension.bad': 'Bad:',
  'healthCheck.dimension.good': 'Good:',

  'healthCheck.survey.title': 'Rate each health dimension',
  'healthCheck.survey.finishedCount': '{finished} / {total} participants finished',
  'healthCheck.survey.next': 'Next: Discuss',
  'healthCheck.survey.anonymousNotice': 'Your ratings are anonymous',
  'healthCheck.survey.visibleNotice': 'Your ratings are visible to the team',
  'healthCheck.survey.scale.stronglyDisagree': 'Strongly Disagree',
  'healthCheck.survey.scale.neutral': 'Neutral',
  'healthCheck.survey.scale.stronglyAgree': 'Strongly Agree',
  'healthCheck.survey.commentPlaceholder': 'Additional comments (optional)...',
  'healthCheck.survey.saved': 'SAVED',

  'healthCheck.discuss.title': 'Discuss survey results and identify actions',
  'healthCheck.discuss.showVotes': 'Show votes',
  'healthCheck.discuss.next': 'Next: Review',
  'healthCheck.discuss.ratingCount_one': '{count} rating',
  'healthCheck.discuss.ratingCount_other': '{count} ratings',
  'healthCheck.discuss.commentCount_one': '{count} comment',
  'healthCheck.discuss.commentCount_other': '{count} comments',
  'healthCheck.discuss.hideDetails': 'Hide dimension details',
  'healthCheck.discuss.showDetails': 'Show dimension details (Good / Bad)',
  'healthCheck.discuss.toggleDetails': 'Toggle dimension details',
  'healthCheck.discuss.voteDistribution': 'Vote Distribution',
  'healthCheck.discuss.actions': 'Actions',
  'healthCheck.discuss.proposePlaceholder': 'Propose an action...',
  'healthCheck.discuss.propose': 'Propose',
  'healthCheck.discuss.directAccept': 'Directly accept action',
  'healthCheck.discuss.accepted': 'Accepted:',
  'healthCheck.discuss.deleteAction': 'Delete action',
  'healthCheck.discuss.confirmDelete': 'Confirm?',

  'healthCheck.review.title': 'Review Actions',
  'healthCheck.review.next': 'Next: Close',
  'healthCheck.review.sessionActions': 'Actions from this session ({count})',
  'healthCheck.review.empty': 'No actions created yet.',
  'healthCheck.review.general': 'General',
  'healthCheck.review.markNotDone': 'Mark action as not done',
  'healthCheck.review.markDone': 'Mark action as done',
  'healthCheck.review.assigneeFor': 'Assignee for the action: {action}',
  'healthCheck.review.unassigned': 'Unassigned',

  'healthCheck.close.title': 'Health Check Complete',
  'healthCheck.close.thanks': 'Thank you for your contribution!',
  'healthCheck.close.rotiTitle': 'ROTI (Return on Time Invested)',
  'healthCheck.close.votedCount': '{voted} / {total} members have voted',
  'healthCheck.close.reveal': 'Reveal Results',
  'healthCheck.close.returnToDashboard': 'Return to Dashboard',
  'healthCheck.close.leave': 'Leave Health Check',

  'healthCheck.participants.surveyProgress': '{finished} / {total} completed survey',
  'healthCheck.participants.closeProgress': '{voted} / {total} voted in close-out',
  'healthCheck.participants.count_one': '{count} participant',
  'healthCheck.participants.count_other': '{count} participants',
};

export default healthCheck;
