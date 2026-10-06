// English messages for the "adminFeedbacks" namespace (the super-admin Feedbacks tab). Every key starts
// with "adminFeedbacks.". English is the source language: keep this text identical to
// what the console rendered before it was translated.
//
// A feedback's type and status are read through `feedback.type.*` and
// `feedback.status.*`: the operator sets the very status the team reads on its
// own board, so the two screens must name it with the same word. The author of
// an administrator's reply is `feedback.comments.adminAuthor` for the same reason.
const adminFeedbacks = {
  // Filters
  'adminFeedbacks.filter.all': 'All ({count})',
  'adminFeedbacks.filter.unread': 'Unread ({count})',
  'adminFeedbacks.filter.bugs': 'Bugs ({count})',
  'adminFeedbacks.filter.features': 'Features ({count})',
  'adminFeedbacks.filter.statusLabel': 'Status:',
  'adminFeedbacks.filter.statusAll': 'All',

  // List and cards
  'adminFeedbacks.empty': 'No feedback to display',
  'adminFeedbacks.card.new': 'New',
  'adminFeedbacks.card.imageAlt': 'Feedback {number}',
  'adminFeedbacks.card.team': 'Team: {team}',
  'adminFeedbacks.card.comments': 'Comments ({count}):',
  'adminFeedbacks.card.markRead': 'Mark as Read',
  'adminFeedbacks.card.statusLabel': 'Status of the feedback: {title}',
  'adminFeedbacks.confirm.delete': 'Are you sure you want to delete this feedback from "{team}"?',

  // Comment composer (the card's button, the dialog title and its submit)
  'adminFeedbacks.addComment': 'Add Comment',
  'adminFeedbacks.comment.feedback': 'Feedback: {title}',
  'adminFeedbacks.comment.placeholder': 'Write your comment here...',
  'adminFeedbacks.comment.maxLength': 'Max 1000 characters',

  // Notices
  'adminFeedbacks.notice.loadFailed': 'Failed to load feedbacks',
  'adminFeedbacks.notice.gone': 'That feedback no longer exists — its team deleted it.',
  'adminFeedbacks.notice.updateFailed': 'Failed to update feedback',
  'adminFeedbacks.notice.deleteFailed': 'Failed to delete feedback',
  'adminFeedbacks.notice.deleted': 'Feedback deleted successfully',
  'adminFeedbacks.notice.commentAdded': 'Comment added successfully',
  'adminFeedbacks.notice.commentLost':
    'That feedback no longer exists — its team deleted it. Your comment was not saved.',
  'adminFeedbacks.notice.commentFailed': 'Failed to add comment',
};

export default adminFeedbacks;
