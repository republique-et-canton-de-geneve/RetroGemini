import type { Column } from '../../types';
import type { Language } from '../languages';

/**
 * The built-in retrospective templates, in both languages.
 *
 * This is **content**, not interface text: the column titles end up on the
 * session that every participant sees, so they follow the *template language*
 * the facilitator picks when starting the retro — never the language of
 * whoever happens to be looking at the screen. A French-speaking facilitator
 * can run an English retro, and the reverse.
 *
 * A template has one set of column ids and styles, shared by both languages,
 * and only the words differ. That keeps a French and an English Sailboat
 * structurally identical (same ids, colours and icons), and makes it a compile
 * error to translate a template and forget one of its columns.
 */

export type RetroTemplateId =
  | 'start_stop_continue'
  | '4l'
  | 'mad_sad_glad'
  | 'sailboat'
  | 'went_well'
  | 'kalm'
  | 'daki'
  | 'starfish'
  | 'rose_thorn_bud'
  | 'hot_air_balloon'
  | 'speed_car'
  | 'lean_coffee'
  | 'three_little_pigs';

type ColumnStyle = Omit<Column, 'title'>;

interface TemplateWords {
  name: string;
  description: string;
  /** Column id -> title. */
  columns: Record<string, string>;
}

interface RetroTemplateDefinition {
  id: RetroTemplateId;
  columns: ColumnStyle[];
  words: Record<Language, TemplateWords>;
}

type Tone = 'emerald' | 'rose' | 'sky' | 'orange' | 'purple' | 'slate' | 'cyan' | 'amber';

// Spelled out in full on purpose: Tailwind only generates a class it can read
// verbatim in the source, so `bg-${tone}-50` would silently produce nothing.
const TONES: Record<Tone, Omit<ColumnStyle, 'id' | 'icon'>> = {
  emerald: { color: 'bg-emerald-50', border: 'border-emerald-400', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#059669' },
  rose: { color: 'bg-rose-50', border: 'border-rose-400', text: 'text-rose-700', ring: 'focus:ring-rose-200', customColor: '#e11d48' },
  sky: { color: 'bg-sky-50', border: 'border-sky-400', text: 'text-sky-700', ring: 'focus:ring-sky-200', customColor: '#2563eb' },
  orange: { color: 'bg-orange-50', border: 'border-orange-400', text: 'text-orange-700', ring: 'focus:ring-orange-200', customColor: '#ea580c' },
  purple: { color: 'bg-purple-50', border: 'border-purple-400', text: 'text-purple-700', ring: 'focus:ring-purple-200', customColor: '#9333ea' },
  slate: { color: 'bg-slate-50', border: 'border-slate-400', text: 'text-slate-700', ring: 'focus:ring-slate-200', customColor: '#475569' },
  cyan: { color: 'bg-cyan-50', border: 'border-cyan-400', text: 'text-cyan-700', ring: 'focus:ring-cyan-200', customColor: '#0891b2' },
  amber: { color: 'bg-amber-50', border: 'border-amber-400', text: 'text-amber-700', ring: 'focus:ring-amber-200', customColor: '#d97706' },
};

const style = (id: string, tone: Tone, icon: string): ColumnStyle => ({ id, icon, ...TONES[tone] });

/** In the order the "Start New Retrospective" dialog lists them. */
export const RETRO_TEMPLATES: readonly RetroTemplateDefinition[] = [
  {
    id: 'start_stop_continue',
    columns: [style('start', 'emerald', 'play_arrow'), style('stop', 'rose', 'stop'), style('continue', 'sky', 'fast_forward')],
    words: {
      en: { name: 'Start, Stop, Continue', description: 'The classic format.', columns: { start: 'Start', stop: 'Stop', continue: 'Continue' } },
      fr: { name: 'Commencer, Arrêter, Continuer', description: 'Le format classique.', columns: { start: 'Commencer', stop: 'Arrêter', continue: 'Continuer' } },
    },
  },
  {
    id: '4l',
    columns: [style('liked', 'emerald', 'thumb_up'), style('learned', 'sky', 'lightbulb'), style('lacked', 'orange', 'warning'), style('longed_for', 'purple', 'favorite')],
    words: {
      en: { name: "4 L's", description: 'Liked, Learned, Lacked, Longed For.', columns: { liked: 'Liked', learned: 'Learned', lacked: 'Lacked', longed_for: 'Longed For' } },
      fr: { name: 'Les 4 L', description: 'Aimé, Appris, Manqué, Souhaité.', columns: { liked: 'Aimé', learned: 'Appris', lacked: 'Manqué', longed_for: 'Souhaité' } },
    },
  },
  {
    id: 'mad_sad_glad',
    columns: [style('mad', 'rose', 'sentiment_very_dissatisfied'), style('sad', 'slate', 'sentiment_dissatisfied'), style('glad', 'emerald', 'sentiment_satisfied')],
    words: {
      en: { name: 'Mad / Sad / Glad', description: 'Capture the full range of feelings.', columns: { mad: 'Mad', sad: 'Sad', glad: 'Glad' } },
      fr: { name: 'Fâché / Triste / Content', description: 'Exprimer toute la palette des émotions.', columns: { mad: 'Fâché', sad: 'Triste', glad: 'Content' } },
    },
  },
  {
    id: 'sailboat',
    columns: [style('wind', 'cyan', 'sailing'), style('anchor', 'amber', 'anchor'), style('rocks', 'rose', 'report_problem'), style('island', 'emerald', 'flag')],
    words: {
      en: { name: 'Sailboat', description: 'Wind, anchors, rocks, and goals.', columns: { wind: 'Wind (Helps Us)', anchor: 'Anchors (Slow Us)', rocks: 'Rocks (Risks)', island: 'Island (Goals)' } },
      fr: { name: 'Voilier', description: 'Vent, ancres, rochers et objectifs.', columns: { wind: 'Vent (nous aide)', anchor: 'Ancres (nous freinent)', rocks: 'Rochers (risques)', island: 'Île (objectifs)' } },
    },
  },
  {
    id: 'went_well',
    columns: [style('went_well', 'emerald', 'sentiment_satisfied'), style('not_well', 'rose', 'sentiment_dissatisfied'), style('try_next', 'sky', 'lightbulb'), style('puzzles', 'amber', 'help')],
    words: {
      en: { name: 'What Went Well', description: 'Well, not well, try next, puzzles.', columns: { went_well: 'What Went Well', not_well: "What Didn't Go Well", try_next: 'What to Try Next', puzzles: 'What Puzzles Us' } },
      fr: { name: "Ce qui s'est bien passé", description: 'Bien, pas bien, à essayer, questions.', columns: { went_well: "Ce qui s'est bien passé", not_well: "Ce qui ne s'est pas bien passé", try_next: 'Ce que nous allons essayer', puzzles: 'Ce qui nous interroge' } },
    },
  },
  {
    id: 'kalm',
    columns: [style('keep', 'emerald', 'check_circle'), style('add', 'sky', 'add_circle'), style('less', 'amber', 'remove_circle'), style('more', 'purple', 'expand_circle_up')],
    words: {
      en: { name: 'KALM', description: 'Keep, Add, Less, More.', columns: { keep: 'Keep', add: 'Add', less: 'Less', more: 'More' } },
      fr: { name: 'KALM', description: 'Garder, Ajouter, Moins, Plus.', columns: { keep: 'Garder', add: 'Ajouter', less: 'Moins', more: 'Plus' } },
    },
  },
  {
    id: 'daki',
    columns: [style('drop', 'rose', 'delete'), style('add', 'sky', 'add_circle'), style('keep', 'emerald', 'check_circle'), style('improve', 'amber', 'trending_up')],
    words: {
      en: { name: 'DAKI', description: 'Drop, Add, Keep, Improve.', columns: { drop: 'Drop', add: 'Add', keep: 'Keep', improve: 'Improve' } },
      fr: { name: 'DAKI', description: 'Abandonner, Ajouter, Garder, Améliorer.', columns: { drop: 'Abandonner', add: 'Ajouter', keep: 'Garder', improve: 'Améliorer' } },
    },
  },
  {
    id: 'starfish',
    columns: [style('stop', 'rose', 'cancel'), style('less', 'amber', 'trending_down'), style('keep', 'emerald', 'check_circle'), style('more', 'sky', 'trending_up'), style('start', 'purple', 'play_circle')],
    words: {
      en: { name: 'Starfish', description: 'Stop, Less, Keep, More, Start.', columns: { stop: 'Stop Doing', less: 'Less Of', keep: 'Keep Doing', more: 'More Of', start: 'Start Doing' } },
      fr: { name: 'Étoile de mer', description: 'Arrêter, Moins, Continuer, Plus, Commencer.', columns: { stop: 'Arrêter de faire', less: 'Faire moins', keep: 'Continuer à faire', more: 'Faire plus', start: 'Commencer à faire' } },
    },
  },
  {
    id: 'rose_thorn_bud',
    columns: [style('rose', 'rose', 'local_florist'), style('thorn', 'slate', 'warning'), style('bud', 'emerald', 'eco')],
    words: {
      en: { name: 'Rose, Thorn, Bud', description: 'Positives, challenges, potential.', columns: { rose: 'Rose (Positive)', thorn: 'Thorn (Challenge)', bud: 'Bud (Potential)' } },
      fr: { name: 'Rose, Épine, Bourgeon', description: 'Points positifs, défis, potentiel.', columns: { rose: 'Rose (positif)', thorn: 'Épine (défi)', bud: 'Bourgeon (potentiel)' } },
    },
  },
  {
    id: 'hot_air_balloon',
    columns: [style('fire', 'orange', 'local_fire_department'), style('sandbags', 'amber', 'fitness_center'), style('clouds', 'slate', 'thunderstorm'), style('sun', 'sky', 'wb_sunny')],
    words: {
      en: { name: 'Hot Air Balloon', description: 'Fire, sandbags, storms, sunny skies.', columns: { fire: 'Fire (Drives Us)', sandbags: 'Sandbags (Slows Us)', clouds: 'Storm Clouds (Risks)', sun: 'Sunny Skies (Goals)' } },
      fr: { name: 'Montgolfière', description: "Feu, sacs de sable, orages, ciel dégagé.", columns: { fire: 'Feu (nous propulse)', sandbags: 'Sacs de sable (nous freinent)', clouds: "Nuages d'orage (risques)", sun: 'Ciel dégagé (objectifs)' } },
    },
  },
  {
    id: 'speed_car',
    columns: [style('engine', 'emerald', 'speed'), style('parachute', 'amber', 'paragliding'), style('abyss', 'rose', 'report_problem'), style('bridge', 'sky', 'construction')],
    words: {
      en: { name: 'Speed Car', description: 'Engine, parachute, abyss, bridge.', columns: { engine: 'Engine (Propels Us)', parachute: 'Parachute (Slows Us)', abyss: 'Abyss (Risks)', bridge: 'Bridge (Solutions)' } },
      fr: { name: 'Voiture de course', description: 'Moteur, parachute, gouffre, pont.', columns: { engine: 'Moteur (nous propulse)', parachute: 'Parachute (nous freine)', abyss: 'Gouffre (risques)', bridge: 'Pont (solutions)' } },
    },
  },
  {
    id: 'lean_coffee',
    columns: [style('to_discuss', 'slate', 'pending'), style('discussing', 'amber', 'forum'), style('discussed', 'emerald', 'check_circle')],
    words: {
      en: { name: 'Lean Coffee', description: 'To discuss, discussing, discussed.', columns: { to_discuss: 'To Discuss', discussing: 'Discussing', discussed: 'Discussed' } },
      fr: { name: 'Lean Coffee', description: 'À discuter, en discussion, discuté.', columns: { to_discuss: 'À discuter', discussing: 'En discussion', discussed: 'Discuté' } },
    },
  },
  {
    id: 'three_little_pigs',
    columns: [style('straw', 'amber', 'grass'), style('stick', 'orange', 'park'), style('brick', 'emerald', 'home'), style('wolf', 'rose', 'pets')],
    words: {
      en: { name: 'Three Little Pigs', description: 'Straw, stick, brick houses, wolf.', columns: { straw: 'Straw House (Fragile)', stick: 'Stick House (Unstable)', brick: 'Brick House (Solid)', wolf: 'Wolf (Threats)' } },
      fr: { name: 'Les trois petits cochons', description: 'Maisons de paille, de bois, de briques, et le loup.', columns: { straw: 'Maison de paille (fragile)', stick: 'Maison de bois (instable)', brick: 'Maison de briques (solide)', wolf: 'Loup (menaces)' } },
    },
  },
];

const byId = new Map(RETRO_TEMPLATES.map(template => [template.id, template]));

const definitionOf = (id: RetroTemplateId): RetroTemplateDefinition => {
  const definition = byId.get(id);
  if (!definition) throw new Error(`Unknown retrospective template: ${id}`);
  return definition;
};

/** Fresh column objects for a new session — never shared with the catalogue. */
export const getRetroTemplateColumns = (id: RetroTemplateId, language: Language): Column[] => {
  const definition = definitionOf(id);
  const words = definition.words[language];
  return definition.columns.map(column => ({ ...column, title: words.columns[column.id] }));
};

export const getRetroTemplateWords = (id: RetroTemplateId, language: Language): Pick<TemplateWords, 'name' | 'description'> => {
  const { name, description } = definitionOf(id).words[language];
  return { name, description };
};

/** Every built-in template as `id -> columns`, in one language. */
export const getRetroTemplatePresets = (language: Language): Record<RetroTemplateId, Column[]> =>
  Object.fromEntries(
    RETRO_TEMPLATES.map(template => [template.id, getRetroTemplateColumns(template.id, language)])
  ) as Record<RetroTemplateId, Column[]>;

/**
 * The two columns a custom template starts with. The ids are the editor's
 * placeholders, replaced as the facilitator edits.
 */
export const getCustomTemplateStarterColumns = (language: Language): Column[] => {
  const words = definitionOf('start_stop_continue').words[language].columns;
  return [
    { id: '1', title: words.start, color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'play_arrow', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#10B981' },
    { id: '2', title: words.stop, color: 'bg-rose-50', border: 'border-rose-400', icon: 'stop', text: 'text-rose-700', ring: 'focus:ring-rose-200', customColor: '#F43F5E' },
  ];
};

const RETRO_NAME_WORD: Record<Language, string> = { en: 'Retrospective', fr: 'Rétrospective' };

/** "Retrospective 06/10/2026" — the session name proposed when nothing better is known. */
export const getDefaultRetroName = (language: Language, date: Date = new Date()): string =>
  `${RETRO_NAME_WORD[language]} ${date.toLocaleDateString()}`;

/**
 * The template language the "Start New Retrospective" dialog opens on: the
 * team's previous retro decides (a team that runs its retros in English keeps
 * doing so whoever facilitates, in whatever interface language), and a team with
 * no such retro yet starts in the facilitator's interface language.
 */
export const initialTemplateLanguage = (
  previousRetro: { templateLanguage?: Language } | undefined,
  interfaceLanguage: Language
): Language => previousRetro?.templateLanguage ?? interfaceLanguage;
