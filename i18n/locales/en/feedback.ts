// English messages for the "feedback" namespace. Every key starts with "feedback.".
// English is the source language: keep this text identical to what the
// component rendered before it was translated.
const feedback = {
  // Header
  'feedback.header.title': 'Feedback Hub',
  'feedback.header.subtitle': 'Submit bugs and feature requests, and see what other teams have reported',
  'feedback.header.refreshTitle': 'Refresh',
  'feedback.header.refreshLabel': 'Refresh feedback list',
  'feedback.header.newFeedback': 'New Feedback',

  // Feedback types (badge on a card, and the radios of the form)
  'feedback.type.bug': 'Bug',
  'feedback.type.featureBadge': 'Feature',
  'feedback.type.featureRequest': 'Feature Request',

  // Statuses (badge on a card, and the status filter)
  'feedback.status.pending': 'Pending',
  'feedback.status.inProgress': 'In Progress',
  'feedback.status.resolved': 'Resolved',
  'feedback.status.rejected': 'Rejected',

  // Submission form
  'feedback.form.heading': 'Submit Feedback',
  'feedback.form.typeLabel': 'Type',
  'feedback.form.titleLabel': 'Title',
  'feedback.form.titlePlaceholder': 'Brief summary',
  'feedback.form.descriptionLabel': 'Description',
  'feedback.form.descriptionPlaceholder': 'Describe the issue or feature request...',
  'feedback.form.imagesLabel': 'Images (max 5; large images are reduced)',
  'feedback.form.uploading': 'Uploading images...',
  'feedback.form.uploadAlt': 'Upload {number}',
  'feedback.form.submit': 'Submit',
  'feedback.form.sending': 'Sending...',

  // Browser dialogs
  'feedback.alert.maxImages': 'Maximum 5 images allowed',
  'feedback.alert.imageTooLarge': 'Image {name} is too large. Maximum 15MB per image.',
  'feedback.alert.imagesTooLargeTotal': 'This image is too large to send with the others. Remove an image or attach a smaller one.',
  'feedback.alert.readError': 'Error reading file',
  'feedback.alert.fillAllFields': 'Please fill in all fields',

  // Why a submission was not stored; the draft stays on screen
  'feedback.submit.tooLarge': 'Your feedback was not sent: its images are too large. Remove one and try again.',
  'feedback.submit.sessionExpired': 'Your feedback was not sent: your session has expired. Copy your text, log in again and send it again.',
  'feedback.submit.notSaved': 'Your feedback could not be saved. Try again in a moment.',
  'feedback.submit.failed': 'Your feedback was not sent. Check your connection and try again.',
  'feedback.confirm.deleteComment': 'Are you sure you want to delete this comment?',
  'feedback.confirm.deleteFeedback': 'Are you sure you want to delete this feedback?',

  // Filters
  'feedback.filter.all': 'All ({count})',
  'feedback.filter.myTeam': 'My Team ({count})',
  'feedback.filter.bugs': 'Bugs ({count})',
  'feedback.filter.features': 'Features ({count})',
  'feedback.filter.statusLabel': 'Status:',
  'feedback.filter.statusAll': 'All',

  // List and cards
  'feedback.list.loading': 'Loading feedbacks...',
  'feedback.list.empty': 'No feedback matches the current filter',
  'feedback.card.myTeam': 'My Team',
  'feedback.card.imageAlt': 'Attached image {number}',
  'feedback.card.meta': 'Team: {team} · Submitted by {name} on {date}',
  'feedback.card.delete': 'Delete feedback',

  // Comment thread
  'feedback.comments.toggle': 'Comments ({count})',
  'feedback.comments.delete': 'Delete comment',
  'feedback.comments.empty': 'No comments yet',
  'feedback.comments.placeholder': 'Add a comment...',
  'feedback.comments.send': 'Send',
  // The author the server writes on the super administrator's replies; any other
  // author is the name a person typed and is shown as stored.
  'feedback.comments.adminAuthor': 'Super Admin',
};

export default feedback;
