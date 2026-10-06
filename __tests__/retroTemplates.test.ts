import { describe, expect, it } from 'vitest';
import type { Column } from '../types';
import {
  RETRO_TEMPLATES,
  getCustomTemplateStarterColumns,
  getDefaultRetroName,
  getRetroTemplateColumns,
  getRetroTemplatePresets,
  getRetroTemplateWords,
  initialTemplateLanguage
} from '../i18n/content/retroTemplates';
import {
  ICEBREAKER_QUESTIONS,
  getDefaultIcebreaker,
  getRandomIcebreaker,
  localizeIcebreaker
} from '../i18n/content/icebreakers';
import { SUPPORTED_LANGUAGES, intlLocaleFor } from '../i18n/languages';

/**
 * The retro templates became bilingual: one set of column ids and styles, two
 * sets of words. The template language is chosen when the retro starts and is
 * independent of the interface language, so these tests pin the catalogue
 * itself — the English half must be exactly what the product shipped before.
 */

// services/dataService.ts PRESETS as they were before the catalogue moved to
// i18n/content/retroTemplates.ts. Every English retro started from now on must
// be indistinguishable from one started before the change.
const LEGACY_PRESETS: Record<string, Column[]> = {
    'start_stop_continue': [
        {id: 'start', title: 'Start', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'play_arrow', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#059669'},
        {id: 'stop', title: 'Stop', color: 'bg-rose-50', border: 'border-rose-400', icon: 'stop', text: 'text-rose-700', ring: 'focus:ring-rose-200', customColor: '#e11d48'},
        {id: 'continue', title: 'Continue', color: 'bg-sky-50', border: 'border-sky-400', icon: 'fast_forward', text: 'text-sky-700', ring: 'focus:ring-sky-200', customColor: '#2563eb'}
    ],
    '4l': [
        {id: 'liked', title: 'Liked', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'thumb_up', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#059669'},
        {id: 'learned', title: 'Learned', color: 'bg-sky-50', border: 'border-sky-400', icon: 'lightbulb', text: 'text-sky-700', ring: 'focus:ring-sky-200', customColor: '#2563eb'},
        {id: 'lacked', title: 'Lacked', color: 'bg-orange-50', border: 'border-orange-400', icon: 'warning', text: 'text-orange-700', ring: 'focus:ring-orange-200', customColor: '#ea580c'},
        {id: 'longed_for', title: 'Longed For', color: 'bg-purple-50', border: 'border-purple-400', icon: 'favorite', text: 'text-purple-700', ring: 'focus:ring-purple-200', customColor: '#9333ea'}
    ],
    'mad_sad_glad': [
        {id: 'mad', title: 'Mad', color: 'bg-rose-50', border: 'border-rose-400', icon: 'sentiment_very_dissatisfied', text: 'text-rose-700', ring: 'focus:ring-rose-200', customColor: '#e11d48'},
        {id: 'sad', title: 'Sad', color: 'bg-slate-50', border: 'border-slate-400', icon: 'sentiment_dissatisfied', text: 'text-slate-700', ring: 'focus:ring-slate-200', customColor: '#475569'},
        {id: 'glad', title: 'Glad', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'sentiment_satisfied', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#059669'}
    ],
    'sailboat': [
        {id: 'wind', title: 'Wind (Helps Us)', color: 'bg-cyan-50', border: 'border-cyan-400', icon: 'sailing', text: 'text-cyan-700', ring: 'focus:ring-cyan-200', customColor: '#0891b2'},
        {id: 'anchor', title: 'Anchors (Slow Us)', color: 'bg-amber-50', border: 'border-amber-400', icon: 'anchor', text: 'text-amber-700', ring: 'focus:ring-amber-200', customColor: '#d97706'},
        {id: 'rocks', title: 'Rocks (Risks)', color: 'bg-rose-50', border: 'border-rose-400', icon: 'report_problem', text: 'text-rose-700', ring: 'focus:ring-rose-200', customColor: '#e11d48'},
        {id: 'island', title: 'Island (Goals)', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'flag', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#059669'}
    ],
    'went_well': [
        {id: 'went_well', title: 'What Went Well', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'sentiment_satisfied', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#059669'},
        {id: 'not_well', title: "What Didn't Go Well", color: 'bg-rose-50', border: 'border-rose-400', icon: 'sentiment_dissatisfied', text: 'text-rose-700', ring: 'focus:ring-rose-200', customColor: '#e11d48'},
        {id: 'try_next', title: 'What to Try Next', color: 'bg-sky-50', border: 'border-sky-400', icon: 'lightbulb', text: 'text-sky-700', ring: 'focus:ring-sky-200', customColor: '#2563eb'},
        {id: 'puzzles', title: 'What Puzzles Us', color: 'bg-amber-50', border: 'border-amber-400', icon: 'help', text: 'text-amber-700', ring: 'focus:ring-amber-200', customColor: '#d97706'}
    ],
    'kalm': [
        {id: 'keep', title: 'Keep', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'check_circle', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#059669'},
        {id: 'add', title: 'Add', color: 'bg-sky-50', border: 'border-sky-400', icon: 'add_circle', text: 'text-sky-700', ring: 'focus:ring-sky-200', customColor: '#2563eb'},
        {id: 'less', title: 'Less', color: 'bg-amber-50', border: 'border-amber-400', icon: 'remove_circle', text: 'text-amber-700', ring: 'focus:ring-amber-200', customColor: '#d97706'},
        {id: 'more', title: 'More', color: 'bg-purple-50', border: 'border-purple-400', icon: 'expand_circle_up', text: 'text-purple-700', ring: 'focus:ring-purple-200', customColor: '#9333ea'}
    ],
    'daki': [
        {id: 'drop', title: 'Drop', color: 'bg-rose-50', border: 'border-rose-400', icon: 'delete', text: 'text-rose-700', ring: 'focus:ring-rose-200', customColor: '#e11d48'},
        {id: 'add', title: 'Add', color: 'bg-sky-50', border: 'border-sky-400', icon: 'add_circle', text: 'text-sky-700', ring: 'focus:ring-sky-200', customColor: '#2563eb'},
        {id: 'keep', title: 'Keep', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'check_circle', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#059669'},
        {id: 'improve', title: 'Improve', color: 'bg-amber-50', border: 'border-amber-400', icon: 'trending_up', text: 'text-amber-700', ring: 'focus:ring-amber-200', customColor: '#d97706'}
    ],
    'starfish': [
        {id: 'stop', title: 'Stop Doing', color: 'bg-rose-50', border: 'border-rose-400', icon: 'cancel', text: 'text-rose-700', ring: 'focus:ring-rose-200', customColor: '#e11d48'},
        {id: 'less', title: 'Less Of', color: 'bg-amber-50', border: 'border-amber-400', icon: 'trending_down', text: 'text-amber-700', ring: 'focus:ring-amber-200', customColor: '#d97706'},
        {id: 'keep', title: 'Keep Doing', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'check_circle', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#059669'},
        {id: 'more', title: 'More Of', color: 'bg-sky-50', border: 'border-sky-400', icon: 'trending_up', text: 'text-sky-700', ring: 'focus:ring-sky-200', customColor: '#2563eb'},
        {id: 'start', title: 'Start Doing', color: 'bg-purple-50', border: 'border-purple-400', icon: 'play_circle', text: 'text-purple-700', ring: 'focus:ring-purple-200', customColor: '#9333ea'}
    ],
    'rose_thorn_bud': [
        {id: 'rose', title: 'Rose (Positive)', color: 'bg-rose-50', border: 'border-rose-400', icon: 'local_florist', text: 'text-rose-700', ring: 'focus:ring-rose-200', customColor: '#e11d48'},
        {id: 'thorn', title: 'Thorn (Challenge)', color: 'bg-slate-50', border: 'border-slate-400', icon: 'warning', text: 'text-slate-700', ring: 'focus:ring-slate-200', customColor: '#475569'},
        {id: 'bud', title: 'Bud (Potential)', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'eco', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#059669'}
    ],
    'hot_air_balloon': [
        {id: 'fire', title: 'Fire (Drives Us)', color: 'bg-orange-50', border: 'border-orange-400', icon: 'local_fire_department', text: 'text-orange-700', ring: 'focus:ring-orange-200', customColor: '#ea580c'},
        {id: 'sandbags', title: 'Sandbags (Slows Us)', color: 'bg-amber-50', border: 'border-amber-400', icon: 'fitness_center', text: 'text-amber-700', ring: 'focus:ring-amber-200', customColor: '#d97706'},
        {id: 'clouds', title: 'Storm Clouds (Risks)', color: 'bg-slate-50', border: 'border-slate-400', icon: 'thunderstorm', text: 'text-slate-700', ring: 'focus:ring-slate-200', customColor: '#475569'},
        {id: 'sun', title: 'Sunny Skies (Goals)', color: 'bg-sky-50', border: 'border-sky-400', icon: 'wb_sunny', text: 'text-sky-700', ring: 'focus:ring-sky-200', customColor: '#2563eb'}
    ],
    'speed_car': [
        {id: 'engine', title: 'Engine (Propels Us)', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'speed', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#059669'},
        {id: 'parachute', title: 'Parachute (Slows Us)', color: 'bg-amber-50', border: 'border-amber-400', icon: 'paragliding', text: 'text-amber-700', ring: 'focus:ring-amber-200', customColor: '#d97706'},
        {id: 'abyss', title: 'Abyss (Risks)', color: 'bg-rose-50', border: 'border-rose-400', icon: 'report_problem', text: 'text-rose-700', ring: 'focus:ring-rose-200', customColor: '#e11d48'},
        {id: 'bridge', title: 'Bridge (Solutions)', color: 'bg-sky-50', border: 'border-sky-400', icon: 'construction', text: 'text-sky-700', ring: 'focus:ring-sky-200', customColor: '#2563eb'}
    ],
    'lean_coffee': [
        {id: 'to_discuss', title: 'To Discuss', color: 'bg-slate-50', border: 'border-slate-400', icon: 'pending', text: 'text-slate-700', ring: 'focus:ring-slate-200', customColor: '#475569'},
        {id: 'discussing', title: 'Discussing', color: 'bg-amber-50', border: 'border-amber-400', icon: 'forum', text: 'text-amber-700', ring: 'focus:ring-amber-200', customColor: '#d97706'},
        {id: 'discussed', title: 'Discussed', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'check_circle', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#059669'}
    ],
    'three_little_pigs': [
        {id: 'straw', title: 'Straw House (Fragile)', color: 'bg-amber-50', border: 'border-amber-400', icon: 'grass', text: 'text-amber-700', ring: 'focus:ring-amber-200', customColor: '#d97706'},
        {id: 'stick', title: 'Stick House (Unstable)', color: 'bg-orange-50', border: 'border-orange-400', icon: 'park', text: 'text-orange-700', ring: 'focus:ring-orange-200', customColor: '#ea580c'},
        {id: 'brick', title: 'Brick House (Solid)', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'home', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#059669'},
        {id: 'wolf', title: 'Wolf (Threats)', color: 'bg-rose-50', border: 'border-rose-400', icon: 'pets', text: 'text-rose-700', ring: 'focus:ring-rose-200', customColor: '#e11d48'}
    ]
};

describe('retro template catalogue', () => {
  it('produces exactly the English templates the product shipped before', () => {
    expect(getRetroTemplatePresets('en')).toEqual(LEGACY_PRESETS);
    expect(Object.keys(getRetroTemplatePresets('en'))).toEqual(Object.keys(LEGACY_PRESETS));
  });

  it('gives the French version of every template the same columns, colours and icons', () => {
    for (const template of RETRO_TEMPLATES) {
      const en = getRetroTemplateColumns(template.id, 'en');
      const fr = getRetroTemplateColumns(template.id, 'fr');
      expect(fr.map(({ title: _title, ...rest }) => rest)).toEqual(en.map(({ title: _title, ...rest }) => rest));
      for (const column of fr) {
        expect(column.title, `${template.id}/${column.id}`).toBeTruthy();
      }
    }
  });

  it('actually translates the French column titles', () => {
    const fr = getRetroTemplateColumns('start_stop_continue', 'fr').map(c => c.title);
    expect(fr).toEqual(['Commencer', 'Arrêter', 'Continuer']);
    expect(getRetroTemplateColumns('sailboat', 'fr')[0].title).toBe('Vent (nous aide)');
    expect(getRetroTemplateWords('mad_sad_glad', 'fr').name).toBe('Fâché / Triste / Content');
  });

  it('names and describes every template in both languages, with no stray column', () => {
    for (const template of RETRO_TEMPLATES) {
      const ids = template.columns.map(c => c.id).sort();
      for (const language of SUPPORTED_LANGUAGES) {
        const words = template.words[language];
        expect(words.name, `${template.id} name (${language})`).toBeTruthy();
        expect(words.description, `${template.id} description (${language})`).toBeTruthy();
        expect(Object.keys(words.columns).sort(), `${template.id} columns (${language})`).toEqual(ids);
      }
    }
  });

  it('hands out fresh column objects, so a session can never mutate the catalogue', () => {
    const first = getRetroTemplateColumns('kalm', 'en');
    first[0].title = 'Mutated';
    expect(getRetroTemplateColumns('kalm', 'en')[0].title).toBe('Keep');
  });

  it('starts a custom template from Start/Stop in the template language', () => {
    expect(getCustomTemplateStarterColumns('en').map((c: Column) => c.title)).toEqual(['Start', 'Stop']);
    expect(getCustomTemplateStarterColumns('fr').map((c: Column) => c.title)).toEqual(['Commencer', 'Arrêter']);
  });

  it('proposes a session name in the template language, with a date its readers parse correctly', () => {
    const date = new Date(2026, 9, 6);
    expect(getDefaultRetroName('en', date)).toBe(`Retrospective ${date.toLocaleDateString()}`);
    // Shared content: a French name carries a French date, so "10/6/2026" from
    // an en-US browser can never be read as 10 June by the French team.
    expect(getDefaultRetroName('fr', date)).toBe(`Rétrospective ${date.toLocaleDateString(intlLocaleFor('fr'))}`);
    expect(getDefaultRetroName('fr', date)).toContain('06.10.2026');
  });

  it("opens on the team's previous template language, else on the interface language", () => {
    expect(initialTemplateLanguage({ templateLanguage: 'en' }, 'fr')).toBe('en');
    expect(initialTemplateLanguage({ templateLanguage: 'fr' }, 'en')).toBe('fr');
    // A retro from before the feature carries no language and was English.
    expect(initialTemplateLanguage({}, 'fr')).toBe('en');
    // Only a team with no retro yet follows the screen.
    expect(initialTemplateLanguage(undefined, 'fr')).toBe('fr');
    expect(initialTemplateLanguage(undefined, 'en')).toBe('en');
  });
});

// components/Session.tsx ICEBREAKERS before the questions moved to
// i18n/content/icebreakers.ts — curly apostrophes included. Beyond the wording,
// localizeIcebreaker only recognises a carried-over question by exact text, so
// "tidying" one of these would also stop older retros' questions translating.
const LEGACY_ICEBREAKERS = [
    "What was the highlight of your week?",
    "If you could have any superpower, what would it be?",
    "What is your favorite book/movie of all time?",
    "What’s one thing you’re learning right now?",
    "If you could travel anywhere tomorrow, where would you go?",
    "What is your favorite meal to cook or eat?",
    "What’s a hobby you’d love to get into?",
    "Who is your favorite fictional character?",
    "What’s the best advice you’ve ever received?",
    "If you were a vegetable, what would you be?",
    "What was your first job?",
    "Coffee or Tea? And how do you take it?",
    "What is one thing you are grateful for today?",
    "If you could meet any historical figure, who would it be?",
    "What is your favorite season and why?",
    "What was the last thing you binge-watched?",
    "Do you have any pets? Tell us about them.",
    "What’s your favorite board game?",
    "If you could instantly master a skill, what would it be?",
    "What is the most adventurous thing you've ever done?"
];

describe('retro phase tips', () => {
  it('starts each phase timer at the timebox its tip suggests', async () => {
    const { RETRO_PHASE_TIPS, getRetroPhaseDefaultTimerSeconds } = await import('../components/session/retroTips');
    expect(RETRO_PHASE_TIPS.length).toBeGreaterThan(5);
    for (const tip of RETRO_PHASE_TIPS) {
      const minutes = Number.parseInt(tip.suggestedTimebox, 10);
      expect(getRetroPhaseDefaultTimerSeconds(tip.phase), tip.phase).toBe(minutes * 60);
    }
  });
});

describe('icebreaker questions', () => {
  it('keeps exactly the English questions the product shipped before', () => {
    expect(ICEBREAKER_QUESTIONS.en).toEqual(LEGACY_ICEBREAKERS);
  });

  it('keeps the two lists parallel', () => {
    expect(ICEBREAKER_QUESTIONS.fr).toHaveLength(ICEBREAKER_QUESTIONS.en.length);
    expect(new Set(ICEBREAKER_QUESTIONS.fr).size).toBe(ICEBREAKER_QUESTIONS.fr.length);
  });

  it('keeps the English default question the product always proposed', () => {
    expect(getDefaultIcebreaker('en')).toBe('What was the highlight of your week?');
    expect(getDefaultIcebreaker('fr')).toBe('Quel a été le meilleur moment de votre semaine\u202f?');
  });

  it('draws a random question from the requested language only', () => {
    expect(getRandomIcebreaker('fr', () => 0)).toBe(ICEBREAKER_QUESTIONS.fr[0]);
    expect(getRandomIcebreaker('en', () => 0.999)).toBe(ICEBREAKER_QUESTIONS.en[ICEBREAKER_QUESTIONS.en.length - 1]);
    for (let i = 0; i < 20; i++) {
      expect(ICEBREAKER_QUESTIONS.fr).toContain(getRandomIcebreaker('fr'));
    }
  });

  it('switches a built-in question to the other language and leaves a written one alone', () => {
    expect(localizeIcebreaker(ICEBREAKER_QUESTIONS.en[3], 'fr')).toBe(ICEBREAKER_QUESTIONS.fr[3]);
    expect(localizeIcebreaker(ICEBREAKER_QUESTIONS.fr[7], 'en')).toBe(ICEBREAKER_QUESTIONS.en[7]);
    expect(localizeIcebreaker(ICEBREAKER_QUESTIONS.fr[7], 'fr')).toBe(ICEBREAKER_QUESTIONS.fr[7]);
    expect(localizeIcebreaker('Our own question?', 'fr')).toBe('Our own question?');
  });
});
