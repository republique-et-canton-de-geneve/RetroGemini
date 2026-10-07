// English messages shared by every screen. Every key starts with "common.".
// Feature screens keep their own wording in their own namespace even when it
// matches one of these — a shared word is only shared while both screens mean
// the same thing by it.
const common = {
  'common.language.label': 'Language',
  'common.language.switchTo': 'Switch the interface to {language}',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.edit': 'Edit',
  'common.back': 'Back',
  'common.loading': 'Loading…',
  'common.yes': 'Yes',
  'common.no': 'No',
  // Phase names as the phase navigation shows them (it renders the id with the
  // underscore replaced, upper-cased by CSS). The English values are exactly
  // that output, so e2e selectors such as "OPEN ACTIONS" keep matching.
  'common.phase.ICEBREAKER': 'ICEBREAKER',
  'common.phase.WELCOME': 'WELCOME',
  'common.phase.OPEN_ACTIONS': 'OPEN ACTIONS',
  'common.phase.BRAINSTORM': 'BRAINSTORM',
  'common.phase.GROUP': 'GROUP',
  'common.phase.VOTE': 'VOTE',
  'common.phase.DISCUSS': 'DISCUSS',
  'common.phase.REVIEW': 'REVIEW',
  'common.phase.CLOSE': 'CLOSE',
  'common.phase.SURVEY': 'SURVEY',
};

export default common;
