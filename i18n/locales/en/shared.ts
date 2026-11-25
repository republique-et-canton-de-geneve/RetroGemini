// English messages for the "shared" namespace. Every key starts with "shared.".
// English is the source language: keep this text identical to what the
// component rendered before it was translated.
const shared = {
  // AnnouncementModal — the chrome only. The announcement text itself is
  // content: CHANGELOG.md, or its translation CHANGELOG.fr.md, served by
  // /api/version — never a dictionary entry.
  'shared.announcement.title': "What's New",
  'shared.announcement.version': 'Version {version}',
  'shared.announcement.caughtUp': "You're all caught up!",
  'shared.announcement.noUpdates': 'No new updates since your last visit.',
  'shared.announcement.later': 'Later',
  'shared.announcement.gotIt': 'Got it!',
  'shared.announcement.type.feature': 'New Feature',
  'shared.announcement.type.improvement': 'Improvement',
  'shared.announcement.type.fix': 'Bug Fix',
  'shared.announcement.type.security': 'Security Update',
  'shared.announcement.type.removed': 'Removed',

  // ColorPicker
  'shared.colorPicker.title': 'Pick a color',
  'shared.colorPicker.close': 'Close the colour picker',
  'shared.colorPicker.selected': 'Selected',
  // Each colour the picker offers, named in words: a swatch is named by its
  // colour, never by its code.
  'shared.colorPicker.color.red': 'Red',
  'shared.colorPicker.color.rose': 'Rose',
  'shared.colorPicker.color.pink': 'Pink',
  'shared.colorPicker.color.fuchsia': 'Fuchsia',
  'shared.colorPicker.color.purple': 'Purple',
  'shared.colorPicker.color.violet': 'Violet',
  'shared.colorPicker.color.indigo': 'Indigo',
  'shared.colorPicker.color.blue': 'Blue',
  'shared.colorPicker.color.sky': 'Sky blue',
  'shared.colorPicker.color.cyan': 'Cyan',
  'shared.colorPicker.color.teal': 'Teal',
  'shared.colorPicker.color.emerald': 'Emerald',
  'shared.colorPicker.color.green': 'Green',
  'shared.colorPicker.color.lime': 'Lime',
  'shared.colorPicker.color.yellow': 'Yellow',
  'shared.colorPicker.color.orange': 'Orange',
  'shared.colorPicker.color.slate': 'Slate grey',

  // IconPicker — icon ligature names are data and are never translated.
  'shared.iconPicker.title': 'Pick an icon',
  'shared.iconPicker.close': 'Close the icon picker',
  'shared.iconPicker.searchPlaceholder': 'Search icons...',
  'shared.iconPicker.found_one': '{count} icon found',
  'shared.iconPicker.found_other': '{count} icons found',
  'shared.iconPicker.selected': 'Selected Icon',
  'shared.iconPicker.choose': 'Choose the {name} icon',
  'shared.iconPicker.emptyTitle': 'No icons found',
  'shared.iconPicker.emptyHint': 'Try a different search term',
};

export default shared;
