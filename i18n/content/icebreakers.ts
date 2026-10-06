import type { Language } from '../languages';

/**
 * Icebreaker questions, in both languages. Like the templates, this is session
 * **content**: the question is written onto the retro and everyone reads the
 * same one, so it follows the retro's template language, not the reader's
 * interface language.
 *
 * The two lists are parallel — entry N in French is the translation of entry N
 * in English — which is what lets a question carried over from the previous
 * retro switch language with the template (see `localizeIcebreaker`).
 */
export const ICEBREAKER_QUESTIONS: Record<Language, readonly string[]> = {
  en: [
    'What was the highlight of your week?',
    'If you could have any superpower, what would it be?',
    'What is your favorite book/movie of all time?',
    'What’s one thing you’re learning right now?',
    'If you could travel anywhere tomorrow, where would you go?',
    'What is your favorite meal to cook or eat?',
    'What’s a hobby you’d love to get into?',
    'Who is your favorite fictional character?',
    'What’s the best advice you’ve ever received?',
    'If you were a vegetable, what would you be?',
    'What was your first job?',
    'Coffee or Tea? And how do you take it?',
    'What is one thing you are grateful for today?',
    'If you could meet any historical figure, who would it be?',
    'What is your favorite season and why?',
    'What was the last thing you binge-watched?',
    'Do you have any pets? Tell us about them.',
    'What’s your favorite board game?',
    'If you could instantly master a skill, what would it be?',
    "What is the most adventurous thing you've ever done?",
  ],
  fr: [
    'Quel a été le meilleur moment de votre semaine ?',
    'Si vous pouviez avoir un super-pouvoir, lequel choisiriez-vous ?',
    'Quel est votre livre ou film préféré de tous les temps ?',
    'Qu’êtes-vous en train d’apprendre en ce moment ?',
    'Si vous pouviez partir n’importe où demain, où iriez-vous ?',
    'Quel est votre plat préféré, à cuisiner ou à déguster ?',
    'Quel loisir aimeriez-vous commencer ?',
    'Quel est votre personnage de fiction préféré ?',
    'Quel est le meilleur conseil que vous ayez reçu ?',
    'Si vous étiez un légume, lequel seriez-vous ?',
    'Quel a été votre premier emploi ?',
    'Café ou thé ? Et comment le prenez-vous ?',
    'Pour quoi êtes-vous reconnaissant aujourd’hui ?',
    'Si vous pouviez rencontrer un personnage historique, qui serait-ce ?',
    'Quelle est votre saison préférée, et pourquoi ?',
    'Quelle est la dernière série que vous avez dévorée ?',
    'Avez-vous des animaux de compagnie ? Parlez-nous d’eux.',
    'Quel est votre jeu de société préféré ?',
    'Si vous pouviez maîtriser instantanément une compétence, laquelle choisiriez-vous ?',
    'Quelle est la chose la plus audacieuse que vous ayez faite ?',
  ],
};

export const getDefaultIcebreaker = (language: Language): string => ICEBREAKER_QUESTIONS[language][0];

export const getRandomIcebreaker = (language: Language, random: () => number = Math.random): string => {
  const questions = ICEBREAKER_QUESTIONS[language];
  return questions[Math.floor(random() * questions.length)];
};

/**
 * A built-in question in the requested language. A question the facilitator
 * wrote themselves is returned untouched: it is theirs, and there is nothing to
 * translate it from.
 */
export const localizeIcebreaker = (question: string, language: Language): string => {
  for (const questions of Object.values(ICEBREAKER_QUESTIONS)) {
    const index = questions.indexOf(question);
    if (index !== -1) return ICEBREAKER_QUESTIONS[language][index];
  }
  return question;
};
