
import { Team, TeamSummary, User, RetroSession, ActionItem, Column, Template, HealthCheckSession, HealthCheckTemplate, HealthCheckDimension, TeamFeedback } from '../types';

// ==================== SECURE API CLIENT ====================
// Uses team-scoped endpoints that require authentication

// Store authenticated team credentials in memory (never persisted to storage)
let authenticatedTeamId: string | null = null;
let authenticatedTeamPassword: string | null = null;
let authenticatedTeam: Team | null = null;

// Track pending persist operations
let persistQueue: Promise<void> = Promise.resolve();

export class InviteAutoJoinError extends Error {
  code: 'INVITE_NOT_VERIFIED';

  constructor(message: string) {
    super(message);
    this.name = 'InviteAutoJoinError';
    this.code = 'INVITE_NOT_VERIFIED';
  }
}

const getHex = (twClass: string) => {
    if(twClass.includes('emerald')) return '#10B981';
    if(twClass.includes('rose')) return '#F43F5E';
    if(twClass.includes('sky')) return '#0EA5E9';
    if(twClass.includes('amber')) return '#F59E0B';
    if(twClass.includes('purple')) return '#A855F7';
    if(twClass.includes('indigo')) return '#6366F1';
    if(twClass.includes('orange')) return '#F97316';
    if(twClass.includes('slate')) return '#64748B';
    return '#CBD5E1';
};

const USER_COLORS = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-fuchsia-500', 'bg-lime-500', 'bg-pink-500'];

const normalizeEmail = (email?: string | null) => email?.trim().toLowerCase();

const PRESETS: Record<string, Column[]> = {
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

// ==================== HEALTH CHECK TEMPLATES ====================

const HEALTH_CHECK_TEMPLATES: HealthCheckTemplate[] = [
    {
        id: 'team_health_en',
        name: 'Team Health Check',
        isDefault: true,
        dimensions: [
            {
                id: 'autonomy',
                name: 'Autonomy',
                goodDescription: "I have the freedom, flexibility and ability to do my work. There's space to be creative with solutions",
                badDescription: "There are too many processes, rules, external dependencies and obstacles to work autonomously. The path is already laid out."
            },
            {
                id: 'purpose',
                name: 'Purpose',
                goodDescription: "My work is meaningful and the goals are clear.",
                badDescription: "I'm busy without really knowing where we're going and why. I don't clearly see what's expected of me."
            },
            {
                id: 'challenge',
                name: 'Challenge',
                goodDescription: "The work is neither too easy nor too difficult and the required effort is balanced. The workload is adequate.",
                badDescription: "Mismatch between my skills and my work (too easy/difficult). I'm overloaded."
            },
            {
                id: 'fulfillment',
                name: 'Fulfillment',
                goodDescription: "I give and receive in return. My work contributes to my personal development and career",
                badDescription: "I don't get as much from my work as I would like"
            },
            {
                id: 'teamwork',
                name: 'Teamwork',
                goodDescription: "I share the same objectives with my colleagues. We organize ourselves to achieve them and depend on each other.",
                badDescription: "We are a group of individuals with different objectives. I'm not concerned or don't always know what the others' objectives are."
            },
            {
                id: 'org_connection',
                name: 'Connection with Organization',
                goodDescription: "There's synergy between the team and the organization. Collective intelligence is valued and sought. Communication is easy and two-way, the team can influence the organization.",
                badDescription: "One-way communication, Manager -> Executor relationship. Collective intelligence is not sought. Raised concerns are not addressed."
            },
            {
                id: 'learning',
                name: 'Learning & Initiatives',
                goodDescription: "I have space to learn and lead initiatives. If I make a mistake, it will never be held against me. I can always contribute without risk of it backfiring.",
                badDescription: "Mistakes are seen as failure rather than learning. The environment doesn't encourage taking initiative. It's safer to stay silent than try to contribute."
            },
            {
                id: 'transparency',
                name: 'Transparency',
                goodDescription: "Transparency is valued, sought and present. Its absence is immediately pointed out",
                badDescription: "Appearances are often more important. Transparency is not present. People prefer not to address the lack of transparency."
            },
            {
                id: 'team_communication',
                name: 'Team Communication',
                goodDescription: "The team can calmly address difficult topics. Debate is healthy and the goal is always to reach the best option/resolution",
                badDescription: "Difficult topics create lasting tensions. Conflicts sometimes shift to people rather than ideas."
            },
            {
                id: 'mutual_accountability',
                name: 'Mutual Accountability',
                goodDescription: "Feedback is given and received fluidly. Team members hold each other accountable, shortcomings (agreed practices, team contract) are addressed.",
                badDescription: "Feedback is often a source of conflict. Team members prefer to avoid mentioning shortcomings and don't hold each other accountable."
            },
            {
                id: 'team_energy',
                name: 'Team Energy (Summary)',
                goodDescription: "Exchanges are healthy and constructive, engagement is collective, pace is sustainable, it's fun, we're happy in this team",
                badDescription: "Fatigue, disengagement, unsustainable pace, tensions, things could be better in the team"
            }
        ]
    },
    {
        id: 'team_health_fr',
        name: 'Bilan de santé (FR)',
        isDefault: true,
        dimensions: [
            {
                id: 'autonomie',
                name: 'Autonomie',
                goodDescription: "J'ai la liberté, la flexibilité et la capacité de faire le travail. Il y a de l'espace pour être créatif sur les solutions",
                badDescription: "Il y a trop de processus, des règles, des dépendances externes et des obstacles pour réaliser le travail en autonomie. La route est déjà pré-tracée."
            },
            {
                id: 'objectif',
                name: 'Objectif',
                goodDescription: "Mon travail a du sens et les buts à atteindre sont clairs.",
                badDescription: "Je suis occupé sans forcément savoir vers où on va et pourquoi. Je ne vois pas bien ce qu'on attend de moi."
            },
            {
                id: 'challenge',
                name: 'Challenge',
                goodDescription: "Le travail n'est ni trop facile, ni trop difficile et l'effort nécessaire est équilibré. La charge de travail est adéquate.",
                badDescription: "Inadéquation entre mes compétences et mon travail. (C'est trop facile/difficile). Je suis surchargé."
            },
            {
                id: 'epanouissement',
                name: 'Epanouissement',
                goodDescription: "Je donne et je reçois en retour. Mon activité contribue à mon développement personnel et ma carrière",
                badDescription: "Je ne tire pas de mon activité autant que je souhaiterais"
            },
            {
                id: 'travail_equipe',
                name: "Travail d'équipe",
                goodDescription: "Je partage avec mes collègues les mêmes objectifs. Nous nous organisons pour les atteindre et dépendons les uns des autres.",
                badDescription: "Nous sommes un groupe d'individus avec des objectifs différents. Je ne suis pas concerné ou je ne connais pas toujours quels sont les objectifs des autres."
            },
            {
                id: 'lien_organisation',
                name: "Lien avec l'organisation",
                goodDescription: "Il y a une synergie entre l'équipe et l'organisation dans laquelle elle se situe. L'intelligence collective est valorisée et recherchée. La communication facilitée et bidirectionnelle, l'équipe est capable d'avoir une influence sur l'organisation.",
                badDescription: "Communication unidirectionnelle, Rapport dirigeant -> exécutant. L'intelligence collective n'est pas recherchée. Les préoccupations remontées ne sont pas adressées."
            },
            {
                id: 'apprentissages',
                name: 'Apprentissages et initiatives',
                goodDescription: "J'ai de l'espace pour apprendre et mener des initiatives. Si je fais une erreur, elle ne sera jamais retenue contre moi. Je peux toujours contribuer sans risque que ça se retourne contre moi.",
                badDescription: "Les erreurs sont vues comme un échec plutôt qu'un apprentissage. L'environnement ne pousse pas à la prise d'initiative. Il est plus prudent de garder le silence que d'essayer de contribuer."
            },
            {
                id: 'transparence',
                name: 'Transparence',
                goodDescription: "La transparence est valorisée, recherchée et présente. Son absence est immédiatement pointée",
                badDescription: "Les apparences sont souvent plus importantes. La transparence n'est pas présente. On préfère ne pas aborder l'absence de transparence."
            },
            {
                id: 'communication_equipe',
                name: "Communication dans l'équipe",
                goodDescription: "L'équipe arrive à aborder sereinement les sujet difficiles. Le débat est sain et l'objectif est toujours d'arriver à la meilleure option/résolution",
                badDescription: "Les sujets difficiles créent des tensions qui demeurent. Les conflits se déportent parfois sur les personnes et non plus les idées."
            },
            {
                id: 'responsabilite_mutuelle',
                name: 'Se tenir mutuellement responsables',
                goodDescription: "Les feedbacks sont donnés et reçus de manière fluide. Les membres de l'équipe se tiennent responsables, les manquements (pratiques décidées, contrat d'équipe) sont adressés.",
                badDescription: "Les feedbacks sont souvent source de conflit. Les membres de l'équipes préfèrent éviter d'évoquer les manquement et ne se tiennent pas mutuellement responsables."
            },
            {
                id: 'energie_equipe',
                name: "Energie de l'équipe (synthèse)",
                goodDescription: "Les échanges sont sains et constructifs, l'engagement est collectif, le rythme est soutenable c'est fun, on est bien dans cette équipe",
                badDescription: "Fatigue, désengagement, rythme insoutenable, tensions, ça pourrait aller mieux dans l'équipe"
            }
        ]
    }
];

/**
 * Get the currently authenticated team
 */
const getAuthenticatedTeam = (): Team | null => authenticatedTeam;

/**
 * Set authentication credentials for the current session
 */
const setAuthCredentials = (teamId: string, password: string, team: Team) => {
  authenticatedTeamId = teamId;
  authenticatedTeamPassword = password;
  authenticatedTeam = team;
};

/**
 * Clear authentication credentials (logout)
 */
const clearAuthCredentials = () => {
  authenticatedTeamId = null;
  authenticatedTeamPassword = null;
  authenticatedTeam = null;
};

/**
 * Make an authenticated API call to the server
 */
const apiCall = async <T>(
  endpoint: string,
  body: Record<string, unknown> = {}
): Promise<{ data: T | null; error: string | null }> => {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: authenticatedTeamPassword,
        ...body
      })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'unknown_error' }));
      return { data: null, error: errorData.error || 'request_failed' };
    }

    const data = await res.json();
    return { data, error: null };
  } catch (err) {
    console.warn('[dataService] API call failed', err);
    return { data: null, error: 'network_error' };
  }
};

/**
 * Persist a retrospective to the server (granular update)
 */
const persistRetrospective = async (teamId: string, retro: RetroSession): Promise<void> => {
  if (!authenticatedTeamPassword) return;

  const { error } = await apiCall(`/api/team/${teamId}/retrospective/${retro.id}`, {
    retrospective: retro
  });

  if (error) {
    console.warn('[dataService] Failed to persist retrospective', error);
  }
};

/**
 * Persist a health check to the server (granular update)
 */
const persistHealthCheck = async (teamId: string, healthCheck: HealthCheckSession): Promise<void> => {
  if (!authenticatedTeamPassword) return;

  const { error } = await apiCall(`/api/team/${teamId}/healthcheck/${healthCheck.id}`, {
    healthCheck
  });

  if (error) {
    console.warn('[dataService] Failed to persist health check', error);
  }
};

/**
 * Persist an action to the server (granular update)
 */
const persistAction = async (teamId: string, action: ActionItem, retroId?: string): Promise<void> => {
  if (!authenticatedTeamPassword) return;

  const { error } = await apiCall(`/api/team/${teamId}/action`, {
    action,
    retroId
  });

  if (error) {
    console.warn('[dataService] Failed to persist action', error);
  }
};

/**
 * Persist team members to the server
 */
const persistMembers = async (teamId: string, members: User[], archivedMembers?: User[]): Promise<void> => {
  if (!authenticatedTeamPassword) return;

  const { error } = await apiCall(`/api/team/${teamId}/members`, {
    members,
    archivedMembers
  });

  if (error) {
    console.warn('[dataService] Failed to persist members', error);
  }
};

/**
 * Persist team update to the server (partial update)
 */
const persistTeamUpdate = async (teamId: string, updates: Partial<Team>): Promise<void> => {
  if (!authenticatedTeamPassword) return;

  const { data, error } = await apiCall<{ team: Team }>(`/api/team/${teamId}/update`, {
    updates
  });

  if (error) {
    console.warn('[dataService] Failed to persist team update', error);
  } else if (data?.team) {
    authenticatedTeam = data.team;
  }
};

// Queue for serializing persist operations
const queuePersist = (operation: () => Promise<void>) => {
  persistQueue = persistQueue
    .then(operation)
    .catch((err) => {
      console.warn('[dataService] Persist queue error', err);
    });
};

const ensureSessionPlaceholder = (teamId: string, sessionId: string): RetroSession | undefined => {
  const team = getAuthenticatedTeam();
  if (!team || team.id !== teamId) return;

  const existing = team.retrospectives.find(r => r.id === sessionId);
  if (existing) return existing;

  const placeholder: RetroSession = {
    id: sessionId,
    teamId,
    name: 'Retrospective',
    date: new Date().toLocaleDateString(),
    status: 'IN_PROGRESS',
    phase: 'ICEBREAKER',
    participants: [],
    discussionFocusId: null,
    icebreakerQuestion: 'What was the highlight of your week?',
    columns: PRESETS['start_stop_continue'],
    settings: {
      isAnonymous: false,
      maxVotes: 5,
      oneVotePerTicket: false,
      revealBrainstorm: false,
      revealHappiness: false,
      revealRoti: false,
      timerSeconds: 300,
      timerInitial: 300,
      timerRunning: false,
      timerAcknowledged: false,
    },
    tickets: [],
    groups: [],
    actions: [],
    openActionsSnapshot: [],
    historyActionsSnapshot: [],
    happiness: {},
    roti: {},
    finishedUsers: [],
    autoFinishedUsers: [],
  };

  team.retrospectives.unshift(placeholder);
  queuePersist(() => persistRetrospective(teamId, placeholder));

  return placeholder;
};

/**
 * No-op for backwards compatibility - authentication happens in loginTeam
 */
const hydrateFromServer = async (): Promise<void> => {
  // No longer needed - data is fetched per-team during login
  return Promise.resolve();
};

/**
 * Refresh team data from server
 */
const refreshFromServer = async (): Promise<void> => {
  if (!authenticatedTeamId || !authenticatedTeamPassword) return;

  const { data, error } = await apiCall<{ team: Team }>(`/api/team/${authenticatedTeamId}`, {});

  if (!error && data?.team) {
    authenticatedTeam = data.team;
  }
};

export const dataService = {
  hydrateFromServer,
  refreshFromServer,
  ensureSessionPlaceholder,

  /**
   * Fetch list of team summaries for login selection.
   */
  listTeams: async (): Promise<TeamSummary[]> => {
    try {
      const res = await fetch('/api/team/list');
      if (!res.ok) {
        return [];
      }
      const data = await res.json();
      if (!data || !Array.isArray(data.teams)) {
        return [];
      }
      return data.teams.sort((a: TeamSummary, b: TeamSummary) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
    } catch (err) {
      console.warn('[dataService] Failed to load team list', err);
      return [];
    }
  },

  /**
   * Create a new team via the secure API
   */
  createTeam: async (name: string, password: string, facilitatorEmail?: string): Promise<Team> => {
    const res = await fetch('/api/team/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password, facilitatorEmail })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'unknown_error' }));
      if (errorData.error === 'team_name_exists') {
        throw new Error('Team name already exists');
      }
      throw new Error(errorData.error || 'Failed to create team');
    }

    const { team } = await res.json();
    // Automatically log in to the new team
    setAuthCredentials(team.id, password, team);
    return team;
  },

  /**
   * Get all teams - not available in secure mode (returns only authenticated team)
   */
  getAllTeams: (): Team[] => {
    // In secure mode, we only have access to the authenticated team
    const team = getAuthenticatedTeam();
    return team ? [team] : [];
  },

  /**
   * Login to a team via the secure API
   */
  loginTeam: async (name: string, password: string): Promise<Team> => {
    const res = await fetch('/api/team/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamName: name, password })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'unknown_error' }));
      if (errorData.error === 'team_not_found') {
        throw new Error('Team not found');
      }
      if (errorData.error === 'invalid_password') {
        throw new Error('Invalid password');
      }
      throw new Error(errorData.error || 'Login failed');
    }

    const { team } = await res.json();
    if (!team.archivedMembers) team.archivedMembers = [];
    setAuthCredentials(team.id, password, team);
    return team;
  },

  /**
   * Get the currently authenticated team
   */
  getTeam: (id: string): Team | undefined => {
    const team = getAuthenticatedTeam();
    if (team && team.id === id) {
      if (!team.archivedMembers) team.archivedMembers = [];
      return team;
    }
    return undefined;
  },

  /**
   * Update team data
   */
  updateTeam: (team: Team): void => {
    const current = getAuthenticatedTeam();
    if (!current || current.id !== team.id) return;

    // Update local cache
    const updated = {
      ...current,
      ...team,
      archivedMembers: team.archivedMembers ?? current.archivedMembers ?? [],
      customTemplates: team.customTemplates ?? current.customTemplates ?? [],
      retrospectives: team.retrospectives ?? current.retrospectives ?? [],
      globalActions: team.globalActions ?? current.globalActions ?? [],
      healthChecks: team.healthChecks ?? current.healthChecks,
      customHealthCheckTemplates: team.customHealthCheckTemplates ?? current.customHealthCheckTemplates,
    };

    authenticatedTeam = updated;

    // Persist to server
    queuePersist(() => persistTeamUpdate(team.id, {
      name: updated.name,
      facilitatorEmail: updated.facilitatorEmail,
      members: updated.members,
      archivedMembers: updated.archivedMembers,
      customTemplates: updated.customTemplates,
      retrospectives: updated.retrospectives,
      globalActions: updated.globalActions,
      healthChecks: updated.healthChecks,
      customHealthCheckTemplates: updated.customHealthCheckTemplates,
      teamFeedbacks: updated.teamFeedbacks,
    }));
  },

  addMember: (teamId: string, name: string, email?: string): User => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');
    if (!team.archivedMembers) team.archivedMembers = [];

    // Check if user exists simply by name for this prototype to avoid dups on reload
    const existing = team.members.find(m => m.name === name || (email && normalizeEmail(m.email) === normalizeEmail(email)));
    if(existing) return existing;

    const newUser: User = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      color: USER_COLORS[team.members.length % USER_COLORS.length],
      role: 'participant',
      email: normalizeEmail(email) || undefined
    };
    team.members.push(newUser);
    queuePersist(() => persistMembers(teamId, team.members, team.archivedMembers));
    return newUser;
  },

  updateMember: (teamId: string, memberId: string, updates: { name: string; email?: string | null }): User => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');

    const member = team.members.find(m => m.id === memberId);
    if (!member) throw new Error('Member not found');

    const nextName = updates.name.trim();
    if (!nextName) throw new Error('Name cannot be empty');

    const normalizedEmail = normalizeEmail(updates.email ?? undefined);
    if (normalizedEmail) {
      const emailTaken = [...team.members, ...(team.archivedMembers || [])]
        .some(m => m.id !== memberId && normalizeEmail(m.email) === normalizedEmail);
      if (emailTaken) {
        throw new Error('Another member already uses this email');
      }
    }

    member.name = nextName;
    member.email = normalizedEmail || undefined;
    queuePersist(() => persistMembers(teamId, team.members, team.archivedMembers));
    return member;
  },

  removeMember: (teamId: string, memberId: string): void => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    if (!team.archivedMembers) team.archivedMembers = [];

    const idx = team.members.findIndex(m => m.id === memberId);
    if (idx === -1) return;

    const [removed] = team.members.splice(idx, 1);

    team.archivedMembers = team.archivedMembers.filter(m => m.id !== removed.id);
    team.archivedMembers.push(removed);

    queuePersist(() => persistMembers(teamId, team.members, team.archivedMembers));
  },

  createSession: (teamId: string, name: string, templateCols: Column[], options?: { isAnonymous?: boolean }): RetroSession => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');

    // Default icebreaker or use the one from the previous session if available
    let icebreakerQuestion = "What was the highlight of your week?";
    if (team.retrospectives.length > 0) {
        // retrospectives are shifted (newest at 0), so we take the latest
        icebreakerQuestion = team.retrospectives[0].icebreakerQuestion;
    }

    const session: RetroSession = {
      id: Math.random().toString(36).substr(2, 9),
      teamId,
      name,
      date: new Date().toLocaleDateString(),
      status: 'IN_PROGRESS',
      phase: 'ICEBREAKER', // Skipped SETUP
      participants: [],
      discussionFocusId: null,
      icebreakerQuestion: icebreakerQuestion,
      columns: templateCols,
      settings: {
        isAnonymous: options?.isAnonymous ?? false,
        maxVotes: 5,
        oneVotePerTicket: false,
        revealBrainstorm: false,
        revealHappiness: false,
        revealRoti: false,
        timerSeconds: 300, // 5 mins default
        timerInitial: 300,
        timerRunning: false,
        timerAcknowledged: false
      },
      tickets: [],
      groups: [],
      actions: [],
      openActionsSnapshot: [],
      historyActionsSnapshot: [],
      happiness: {},
      roti: {},
      finishedUsers: [],
      autoFinishedUsers: []
    };
    team.retrospectives.unshift(session);
    queuePersist(() => persistRetrospective(teamId, session));
    return session;
  },

  updateSession: (teamId: string, session: RetroSession) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;
    const idx = team.retrospectives.findIndex(r => r.id === session.id);
    if (idx !== -1) {
      team.retrospectives[idx] = session;
      queuePersist(() => persistRetrospective(teamId, session));
    }
  },

  updateSessionName: (teamId: string, sessionId: string, newName: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;
    const session = team.retrospectives.find(r => r.id === sessionId);
    if (session) {
      session.name = newName;
      queuePersist(() => persistRetrospective(teamId, session));
    }
  },

  updateHealthCheckName: (teamId: string, healthCheckId: string, newName: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;
    if (!team.healthChecks) return;
    const healthCheck = team.healthChecks.find(hc => hc.id === healthCheckId);
    if (healthCheck) {
      healthCheck.name = newName;
      queuePersist(() => persistHealthCheck(teamId, healthCheck));
    }
  },

  saveTemplate: (teamId: string, template: Template) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;
    team.customTemplates.push(template);
    queuePersist(() => persistTeamUpdate(teamId, { customTemplates: team.customTemplates }));
  },

  addGlobalAction: (teamId: string, text: string, assigneeId: string | null): ActionItem => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');

    const action: ActionItem = {
        id: Math.random().toString(36).substr(2, 9),
        text,
        assigneeId, // If null, it remains null (unassigned)
        done: false,
        type: 'new',
        proposalVotes: {}
    };
    team.globalActions.unshift(action);
    queuePersist(() => persistAction(teamId, action));
    return action;
  },

  updateGlobalAction: (teamId: string, action: ActionItem) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    const idx = team.globalActions.findIndex(a => a.id === action.id);
    if(idx !== -1) {
        team.globalActions[idx] = action;
        queuePersist(() => persistAction(teamId, action));
        return;
    }

    // Fallback: update a retrospective action (previously created action)
    for (const retro of team.retrospectives) {
        const retroIdx = retro.actions.findIndex(a => a.id === action.id);
        if (retroIdx !== -1) {
            retro.actions[retroIdx] = { ...retro.actions[retroIdx], ...action };
            queuePersist(() => persistAction(teamId, action, retro.id));
            break;
        }
    }
  },

  toggleGlobalAction: (teamId: string, actionId: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    const action = team.globalActions.find(a => a.id === actionId);
    if(action) {
        action.done = !action.done;
        queuePersist(() => persistAction(teamId, action));
    } else {
        // Check retro actions
        for(const retro of team.retrospectives) {
            const ra = retro.actions.find(a => a.id === actionId);
            if(ra) {
                ra.done = !ra.done;
                queuePersist(() => persistAction(teamId, ra, retro.id));
                break;
            }
        }
    }
  },

  deleteAction: (teamId: string, actionId: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    const beforeGlobal = team.globalActions.length;
    team.globalActions = team.globalActions.filter(a => a.id !== actionId);

    let deleted = beforeGlobal !== team.globalActions.length;

    team.retrospectives.forEach(retro => {
        const before = retro.actions.length;
        retro.actions = retro.actions.filter(a => a.id !== actionId);
        if (before !== retro.actions.length) deleted = true;
    });

    if (deleted) {
        queuePersist(() => persistTeamUpdate(teamId, {
          globalActions: team.globalActions,
          retrospectives: team.retrospectives
        }));
    }
  },

  deleteRetrospective: (teamId: string, retroId: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    const retroIdx = team.retrospectives.findIndex(r => r.id === retroId);
    if (retroIdx === -1) return;

    const retro = team.retrospectives[retroIdx];
    // Promote actions to the global backlog before deletion
    retro.actions.forEach(action => {
        const already = team.globalActions.some(a => a.id === action.id);
        if (!already) {
            team.globalActions.unshift({ ...action });
        }
    });

    team.retrospectives.splice(retroIdx, 1);
    queuePersist(() => persistTeamUpdate(teamId, {
      globalActions: team.globalActions,
      retrospectives: team.retrospectives
    }));
  },

  getPresets: () => PRESETS,
  getHex,

  createMemberInvite: (teamId: string, email: string, sessionId?: string, nameHint?: string, healthCheckSessionId?: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');
    if (!team.archivedMembers) team.archivedMembers = [];

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) throw new Error('Valid email required');

    const user = team.members.find(m => normalizeEmail(m.email) === normalizedEmail);
    if (user && !user.inviteToken) {
      user.inviteToken = Math.random().toString(36).slice(2, 10);
      queuePersist(() => persistMembers(teamId, team.members, team.archivedMembers));
    }

    // SECURITY: Include the password in the invite for authenticated access
    // This allows invited users to access the team without knowing the password
    const inviteData: Record<string, unknown> = {
      id: team.id,
      name: team.name,
      password: authenticatedTeamPassword, // Use the stored password
      memberEmail: normalizedEmail,
      memberName: user?.name || nameHint || normalizedEmail.split('@')[0]
    };

    if (user) {
      inviteData.memberId = user.id;
      inviteData.inviteToken = user.inviteToken;
    }

    if (sessionId) {
      inviteData.sessionId = sessionId;
    }
    if (healthCheckSessionId) {
      inviteData.healthCheckSessionId = healthCheckSessionId;
    }

    const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(inviteData))));
    const link = `${window.location.origin}?join=${encodeURIComponent(encodedData)}`;

    return { user, inviteLink: link };
  },

  persistParticipants: (teamId: string, participants: User[]) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;
    if (!team.archivedMembers) team.archivedMembers = [];

    let changed = false;

    participants.forEach(p => {
      const normalizedEmail = normalizeEmail(p.email);
      const existing = team.members.find(m => {
        if (p.inviteToken && m.inviteToken === p.inviteToken) return true;
        if (normalizedEmail && normalizeEmail(m.email) === normalizedEmail) return true;
        return m.id === p.id || m.name.toLowerCase() === p.name.toLowerCase();
      });

      const archived = team.archivedMembers!.find(m => m.id === p.id || (normalizedEmail && normalizeEmail(m.email) === normalizedEmail));

      if (existing) {
        if (existing.name !== p.name) { existing.name = p.name; changed = true; }
        if (normalizedEmail && existing.email !== normalizedEmail) { existing.email = normalizedEmail; changed = true; }
        if (!existing.inviteToken && p.inviteToken) { existing.inviteToken = p.inviteToken; changed = true; }
      } else if (archived) {
        // Do not auto-readd archived members to active roster
        if (archived.name !== p.name) { archived.name = p.name; changed = true; }
        if (normalizedEmail && archived.email !== normalizedEmail) { archived.email = normalizedEmail; changed = true; }
      } else {
        const newMember: User = {
          id: p.id,
          name: p.name,
          color: p.color || USER_COLORS[team.members.length % USER_COLORS.length],
          role: 'participant',
          email: normalizedEmail || undefined,
          inviteToken: p.inviteToken || Math.random().toString(36).slice(2, 10)
        };
        team.members.push(newMember);
        changed = true;
      }
    });

    if (changed) {
      queuePersist(() => persistMembers(teamId, team.members, team.archivedMembers));
    }
  },

  // Import a team from invitation data (for invited users)
  // This is called when a user clicks an invite link - it logs them into the team
  importTeam: async (inviteData: { id: string; name: string; password: string; sessionId?: string; session?: RetroSession; members?: User[]; globalActions?: ActionItem[]; retrospectives?: RetroSession[]; memberId?: string; memberEmail?: string; memberName?: string; inviteToken?: string }): Promise<Team> => {
    // Log in using the invite credentials
    const res = await fetch('/api/team/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamName: inviteData.name, password: inviteData.password })
    });

    if (!res.ok) {
      throw new Error('Failed to join team - invalid invite link');
    }

    const { team } = await res.json();
    if (!team.archivedMembers) team.archivedMembers = [];
    setAuthCredentials(team.id, inviteData.password, team);

    return team;
  },

  // Delete a team and all its data
  deleteTeam: async (teamId: string): Promise<void> => {
    if (!authenticatedTeamPassword || authenticatedTeamId !== teamId) return;

    const { error } = await apiCall(`/api/team/${teamId}/delete`, {});

    if (!error) {
      clearAuthCredentials();
    }
  },

  // Join a team as a new participant
  joinTeamAsParticipant: (
    teamId: string,
    userName: string,
    email?: string,
    inviteToken?: string,
    allowCreateWithoutInvite?: boolean
  ): { team: Team; user: User } => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');
    if (!team.archivedMembers) team.archivedMembers = [];

    const normalizedEmail = normalizeEmail(email);
    const normalizedName = userName.trim().toLowerCase();

    const existingByToken = inviteToken
      ? team.members.find((m) => m.inviteToken === inviteToken)
      : undefined;
    const existingByEmail = normalizedEmail
      ? team.members.find((m) => normalizeEmail(m.email) === normalizedEmail)
      : undefined;

    // Allow matching by name for participants (to prevent duplicates like "Nico" vs "Niko")
    // But NOT for facilitators (security: prevents impersonation of admins)
    const existingByName = team.members.find((m) =>
      m.role !== 'facilitator' && m.name.trim().toLowerCase() === normalizedName
    );

    // Priority: token > email > name (for participants only)
    const existingUser = existingByToken || existingByEmail || existingByName;

    if (existingUser) {
      const matchedByIdentity = (inviteToken && existingUser.inviteToken === inviteToken) ||
        (normalizedEmail && normalizeEmail(existingUser.email) === normalizedEmail);
      const matchedByName = existingUser.name.trim().toLowerCase() === normalizedName;

      if (normalizedEmail && existingUser.email !== normalizedEmail) existingUser.email = normalizedEmail;
      if (inviteToken && !existingUser.inviteToken) existingUser.inviteToken = inviteToken;

      const shouldUpdateName =
        !existingUser.joinedBefore ||
        (!matchedByIdentity && !matchedByName && existingUser.name !== userName) ||
        !existingUser.name;

      if (shouldUpdateName) {
        existingUser.name = userName;
      }

      existingUser.joinedBefore = true;

      queuePersist(() => persistMembers(teamId, team.members, team.archivedMembers));
      return { team, user: existingUser };
    }

    // Security: Prevent impersonation of facilitators
    const facilitatorWithSameName = team.members.find((m) =>
      m.role === 'facilitator' && m.name.trim().toLowerCase() === normalizedName
    );
    // Block if trying to use facilitator name without proper authentication
    if (facilitatorWithSameName && !inviteToken && !normalizedEmail) {
      throw new Error('This name is reserved. Please use a different name or contact the team administrator.');
    }

    if (!existingByToken && !existingByEmail && !allowCreateWithoutInvite) {
      throw new Error('An invitation is required to join this team.');
    }

    // Create new participant when joining via a shared invite link (QR code)
    const newUser: User = {
      id: Math.random().toString(36).substr(2, 9),
      name: userName,
      color: USER_COLORS[team.members.length % USER_COLORS.length],
      role: 'participant',
      email: normalizedEmail || undefined,
      inviteToken: inviteToken || Math.random().toString(36).slice(2, 10),
      joinedBefore: true
    };

    team.members.push(newUser);
    queuePersist(() => persistMembers(teamId, team.members, team.archivedMembers));
    return { team, user: newUser };
  },

  autoJoinFromInvite: (
    teamId: string,
    inviteData: { memberId?: string; memberEmail?: string; inviteToken?: string }
  ): { team: Team; user: User } => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');

    const normalizedInviteEmail = normalizeEmail(inviteData.memberEmail);
    const matchedMember =
      (inviteData.memberId && team.members.find((member) => member.id === inviteData.memberId)) ||
      (inviteData.inviteToken && team.members.find((member) => member.inviteToken === inviteData.inviteToken)) ||
      (normalizedInviteEmail && team.members.find((member) => normalizeEmail(member.email) === normalizedInviteEmail)) ||
      null;

    if (!matchedMember) {
      throw new InviteAutoJoinError('Invitation could not be verified. Please join manually.');
    }

    return dataService.joinTeamAsParticipant(
      team.id,
      matchedMember.name,
      inviteData.memberEmail,
      inviteData.inviteToken,
      true
    );
  },

  // ==================== HEALTH CHECK METHODS ====================

  getHealthCheckTemplates: (teamId?: string): HealthCheckTemplate[] => {
    const defaults = [...HEALTH_CHECK_TEMPLATES];
    if (!teamId) return defaults;

    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return defaults;

    const customTemplates = team.customHealthCheckTemplates || [];
    return [...defaults, ...customTemplates];
  },

  createHealthCheckSession: (
    teamId: string,
    name: string,
    templateId: string,
    options?: { isAnonymous?: boolean }
  ): HealthCheckSession => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');

    // Find the template
    const allTemplates = [...HEALTH_CHECK_TEMPLATES, ...(team.customHealthCheckTemplates || [])];
    const template = allTemplates.find(t => t.id === templateId);
    if (!template) throw new Error('Template not found');

    // Initialize health checks array if needed
    if (!team.healthChecks) team.healthChecks = [];

    const session: HealthCheckSession = {
      id: Math.random().toString(36).substr(2, 9),
      teamId,
      name,
      date: new Date().toLocaleDateString(),
      status: 'IN_PROGRESS',
      phase: 'SURVEY',
      templateId: template.id,
      templateName: template.name,
      dimensions: JSON.parse(JSON.stringify(template.dimensions)), // Deep copy
      participants: [],
      settings: {
        isAnonymous: options?.isAnonymous ?? false,
        revealRoti: false
      },
      ratings: {},
      actions: [],
      discussionFocusId: null,
      roti: {},
      finishedUsers: []
    };

    team.healthChecks.unshift(session);
    queuePersist(() => persistHealthCheck(teamId, session));
    return session;
  },

  updateHealthCheckSession: (teamId: string, session: HealthCheckSession) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    if (!team.healthChecks) team.healthChecks = [];

    const idx = team.healthChecks.findIndex(h => h.id === session.id);
    if (idx !== -1) {
      team.healthChecks[idx] = session;
      queuePersist(() => persistHealthCheck(teamId, session));
    }
  },

  deleteHealthCheck: (teamId: string, healthCheckId: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId || !team.healthChecks) return;

    const idx = team.healthChecks.findIndex(h => h.id === healthCheckId);
    if (idx === -1) return;

    const healthCheck = team.healthChecks[idx];
    // Promote actions to global backlog before deletion
    healthCheck.actions.forEach(action => {
      const already = team.globalActions.some(a => a.id === action.id);
      if (!already) {
        team.globalActions.unshift({ ...action });
      }
    });

    team.healthChecks.splice(idx, 1);
    queuePersist(() => persistTeamUpdate(teamId, {
      globalActions: team.globalActions,
      healthChecks: team.healthChecks
    }));
  },

  saveHealthCheckTemplate: (teamId: string, template: HealthCheckTemplate) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    if (!team.customHealthCheckTemplates) team.customHealthCheckTemplates = [];

    // Generate ID if not present
    if (!template.id) {
      template.id = 'custom_' + Math.random().toString(36).substr(2, 9);
    }

    // Check if template with same ID already exists (update case)
    const existingIdx = team.customHealthCheckTemplates.findIndex(t => t.id === template.id);
    if (existingIdx !== -1) {
      team.customHealthCheckTemplates[existingIdx] = template;
    } else {
      team.customHealthCheckTemplates.push(template);
    }

    queuePersist(() => persistTeamUpdate(teamId, { customHealthCheckTemplates: team.customHealthCheckTemplates }));
  },

  deleteHealthCheckTemplate: (teamId: string, templateId: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId || !team.customHealthCheckTemplates) return;

    team.customHealthCheckTemplates = team.customHealthCheckTemplates.filter(t => t.id !== templateId);
    queuePersist(() => persistTeamUpdate(teamId, { customHealthCheckTemplates: team.customHealthCheckTemplates }));
  },

  getHealthCheck: (teamId: string, healthCheckId: string): HealthCheckSession | undefined => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId || !team.healthChecks) return undefined;
    return team.healthChecks.find(h => h.id === healthCheckId);
  },

  ensureHealthCheckPlaceholder: (teamId: string, sessionId: string): HealthCheckSession | undefined => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    if (!team.healthChecks) team.healthChecks = [];

    const existing = team.healthChecks.find(h => h.id === sessionId);
    if (existing) return existing;

    // Get default template
    const defaultTemplate = HEALTH_CHECK_TEMPLATES[0];

    const placeholder: HealthCheckSession = {
      id: sessionId,
      teamId,
      name: 'Health Check',
      date: new Date().toLocaleDateString(),
      status: 'IN_PROGRESS',
      phase: 'SURVEY',
      templateId: defaultTemplate.id,
      templateName: defaultTemplate.name,
      dimensions: JSON.parse(JSON.stringify(defaultTemplate.dimensions)),
      participants: [],
      settings: {
        isAnonymous: false,
        revealRoti: false
      },
      ratings: {},
      actions: [],
      discussionFocusId: null,
      roti: {},
      finishedUsers: []
    };

    team.healthChecks.unshift(placeholder);
    queuePersist(() => persistHealthCheck(teamId, placeholder));

    return placeholder;
  },

  // Create invite link for health check session
  createHealthCheckInvite: (teamId: string, sessionId: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');

    const inviteData = {
      id: team.id,
      name: team.name,
      password: authenticatedTeamPassword,
      healthCheckSessionId: sessionId,
    };

    const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(inviteData))));
    const link = `${window.location.origin}?join=${encodeURIComponent(encodedData)}`;

    return { inviteLink: link };
  },

  // Password recovery functions
  updateFacilitatorEmail: (teamId: string, email: string): void => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');
    team.facilitatorEmail = email || undefined;
    queuePersist(() => persistTeamUpdate(teamId, { facilitatorEmail: team.facilitatorEmail }));
  },

  changeTeamPassword: async (teamId: string, newPassword: string): Promise<void> => {
    if (!newPassword || newPassword.length < 4) {
      throw new Error('Password must be at least 4 characters');
    }

    if (!authenticatedTeamPassword || authenticatedTeamId !== teamId) {
      throw new Error('Team not found');
    }

    const { error } = await apiCall(`/api/team/${teamId}/password`, {
      newPassword
    });

    if (error) {
      throw new Error('Failed to change password');
    }

    // Update stored password
    authenticatedTeamPassword = newPassword;
  },

  renameTeam: async (teamId: string, newName: string): Promise<void> => {
    if (!newName || newName.trim().length === 0) {
      throw new Error('Team name cannot be empty');
    }
    const trimmedName = newName.trim();

    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');

    // Check if name is available
    const checkRes = await fetch(`/api/team/exists/${encodeURIComponent(trimmedName)}`);
    if (checkRes.ok) {
      const { exists } = await checkRes.json();
      if (exists) {
        throw new Error('A team with this name already exists');
      }
    }

    team.name = trimmedName;
    queuePersist(() => persistTeamUpdate(teamId, { name: trimmedName }));
  },

  requestPasswordReset: async (teamName: string, email: string): Promise<{ success: boolean; message: string }> => {
    // Password reset is handled via email through the server
    // We don't have access to other teams' data in secure mode
    // This request will be handled by the server

    try {
      const response = await fetch('/api/send-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          teamName,
          resetLink: `${window.location.origin}?reset=pending` // Server will generate the actual link
        })
      });

      if (!response.ok) {
        console.error('Failed to send password reset email');
      }
    } catch (error) {
      console.error('Error sending password reset email:', error);
    }

    return { success: true, message: 'If the team and email match, a reset link has been sent.' };
  },

  resetPassword: (_token: string, _newPassword: string): { success: boolean; message: string; teamName?: string } => {
    // Password reset is now handled server-side for security
    // This function is kept for backwards compatibility but should be updated
    // to make a server call instead
    return { success: false, message: 'Password reset must be done through the server.' };
  },

  verifyResetToken: (_token: string): { valid: boolean; teamName?: string } => {
    // This should make a server call to verify the token
    return { valid: false };
  },

  // ==================== TEAM FEEDBACK METHODS ====================

  createTeamFeedback: (teamId: string, feedback: Omit<TeamFeedback, 'id' | 'submittedAt' | 'isRead' | 'status'>): TeamFeedback => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');

    if (!team.teamFeedbacks) team.teamFeedbacks = [];

    const newFeedback: TeamFeedback = {
      ...feedback,
      id: 'feedback_' + Math.random().toString(36).substr(2, 9),
      submittedAt: new Date().toISOString(),
      isRead: false,
      status: 'pending'
    };

    team.teamFeedbacks.unshift(newFeedback);
    queuePersist(() => persistTeamUpdate(teamId, { teamFeedbacks: team.teamFeedbacks }));
    return newFeedback;
  },

  updateTeamFeedback: (teamId: string, feedbackId: string, updates: Partial<TeamFeedback>): void => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId || !team.teamFeedbacks) return;

    const idx = team.teamFeedbacks.findIndex(f => f.id === feedbackId);
    if (idx !== -1) {
      team.teamFeedbacks[idx] = { ...team.teamFeedbacks[idx], ...updates };
      queuePersist(() => persistTeamUpdate(teamId, { teamFeedbacks: team.teamFeedbacks }));
    }
  },

  deleteTeamFeedback: (teamId: string, feedbackId: string): void => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId || !team.teamFeedbacks) return;

    team.teamFeedbacks = team.teamFeedbacks.filter(f => f.id !== feedbackId);
    queuePersist(() => persistTeamUpdate(teamId, { teamFeedbacks: team.teamFeedbacks }));
  },

  getTeamFeedbacks: (teamId: string): TeamFeedback[] => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return [];
    return team.teamFeedbacks || [];
  },

  getAllFeedbacks: (): TeamFeedback[] => {
    // In secure mode, we only have access to our team's feedbacks
    const team = getAuthenticatedTeam();
    if (!team || !team.teamFeedbacks) return [];
    return team.teamFeedbacks.sort((a, b) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  },

  markFeedbackAsRead: (teamId: string, feedbackId: string): void => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId || !team.teamFeedbacks) return;

    const feedback = team.teamFeedbacks.find(f => f.id === feedbackId);
    if (feedback) {
      feedback.isRead = true;
      queuePersist(() => persistTeamUpdate(teamId, { teamFeedbacks: team.teamFeedbacks }));
    }
  },

  getUnreadFeedbackCount: (): number => {
    const team = getAuthenticatedTeam();
    if (!team || !team.teamFeedbacks) return 0;
    return team.teamFeedbacks.filter(f => !f.isRead).length;
  },

  // ==================== AUTH HELPERS ====================

  /**
   * Check if user is authenticated to a team
   */
  isAuthenticated: (): boolean => {
    return !!authenticatedTeamId && !!authenticatedTeamPassword;
  },

  /**
   * Get the authenticated team ID
   */
  getAuthenticatedTeamId: (): string | null => {
    return authenticatedTeamId;
  },

  /**
   * Logout - clear authentication
   */
  logout: (): void => {
    clearAuthCredentials();
  },

  /**
   * Set authentication from invite data (used when joining via invite link)
   */
  setAuthFromInvite: (teamId: string, password: string, team: Team): void => {
    setAuthCredentials(teamId, password, team);
  }
};
