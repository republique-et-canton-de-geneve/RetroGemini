import type en from '../en/shared';

// French messages for the "shared" namespace. The type makes a missing or extra
// key a compile error, and i18nDictionaries.test.ts checks the placeholders.
const shared: Record<keyof typeof en, string> = {
  // AnnouncementModal (chrome only; the announcement text comes from
  // CHANGELOG.fr.md through /api/version)
  'shared.announcement.title': 'Nouveautés',
  'shared.announcement.version': 'Version {version}',
  'shared.announcement.caughtUp': 'Vous êtes à jour\u202f!',
  'shared.announcement.noUpdates': 'Aucune nouveauté depuis votre dernière visite.',
  'shared.announcement.later': 'Plus tard',
  'shared.announcement.gotIt': 'Compris\u202f!',
  'shared.announcement.type.feature': 'Nouvelle fonctionnalité',
  'shared.announcement.type.improvement': 'Amélioration',
  'shared.announcement.type.fix': 'Correction de bug',
  'shared.announcement.type.security': 'Mise à jour de sécurité',
  'shared.announcement.type.removed': 'Retiré',

  // ColorPicker
  'shared.colorPicker.title': 'Choisir une couleur',
  'shared.colorPicker.close': 'Fermer le sélecteur de couleur',
  'shared.colorPicker.selected': 'Sélectionnée',

  // IconPicker
  'shared.iconPicker.title': 'Choisir une icône',
  'shared.iconPicker.close': "Fermer le sélecteur d'icône",
  // The icon names and keywords are English data, so a French word finds nothing.
  'shared.iconPicker.searchPlaceholder': 'Rechercher des icônes (en anglais)…',
  'shared.iconPicker.found_one': '{count} icône trouvée',
  'shared.iconPicker.found_other': '{count} icônes trouvées',
  'shared.iconPicker.selected': 'Icône sélectionnée',
  'shared.iconPicker.choose': "Choisir l'icône {name}",
  'shared.iconPicker.emptyTitle': 'Aucune icône trouvée',
  'shared.iconPicker.emptyHint': 'Essayez un autre terme de recherche',
};

export default shared;
