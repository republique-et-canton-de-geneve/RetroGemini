import type en from '../en/common';

const common: Record<keyof typeof en, string> = {
  'common.language.label': 'Langue',
  'common.language.switchTo': "Afficher l'interface en {language}",
  'common.cancel': 'Annuler',
  'common.save': 'Enregistrer',
  'common.delete': 'Supprimer',
  'common.close': 'Fermer',
  'common.confirm': 'Confirmer',
  'common.edit': 'Modifier',
  'common.back': 'Retour',
  'common.loading': 'Chargement…',
  'common.yes': 'Oui',
  'common.no': 'Non',
  'common.phase.ICEBREAKER': 'BRISE-GLACE',
  'common.phase.WELCOME': 'ACCUEIL',
  // The phase bar's labels are short on purpose: it shares the header with the
  // timer and the language switcher, and each phase's own title says it in full
  // (« Revue des actions ouvertes »).
  'common.phase.OPEN_ACTIONS': 'ACTIONS',
  'common.phase.BRAINSTORM': 'BRAINSTORMING',
  'common.phase.GROUP': 'REGROUPER',
  'common.phase.VOTE': 'VOTE',
  'common.phase.DISCUSS': 'DISCUSSION',
  'common.phase.REVIEW': 'REVUE',
  'common.phase.CLOSE': 'CLÔTURE',
  'common.phase.SURVEY': 'ÉVALUATION',
};

export default common;
