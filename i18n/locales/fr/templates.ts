import type en from '../en/templates';

const templates: Record<keyof typeof en, string> = {
  'templates.language.label': 'Langue du modèle',
  'templates.language.hint': "Les titres des colonnes et la question brise-glace sont créés dans cette langue, quelle que soit la langue de votre écran.",
};

export default templates;
