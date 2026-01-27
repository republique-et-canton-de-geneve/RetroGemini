
import { Team, User, RetroSession, ActionItem, Column, Template, HealthCheckSession, HealthCheckTemplate, HealthCheckDimension, TeamFeedback } from '../types';

const DATA_ENDPOINT = '/api/data';

let hydratedFromServer = false;
let hydrateInFlight: Promise<void> | null = null;
let dataCache: { teams: Team[] } = { teams: [] };
let dataRevision = 0;
let dataUpdatedAt: string | null = null;
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
        {id: 'went_well', title: 'Went Well', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'check_circle', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#059669'},
        {id: 'to_improve', title: 'To Improve', color: 'bg-orange-50', border: 'border-orange-400', icon: 'trending_down', text: 'text-orange-700', ring: 'focus:ring-orange-200', customColor: '#ea580c'},
        {id: 'ideas', title: 'Ideas / Experiments', color: 'bg-indigo-50', border: 'border-indigo-400', icon: 'auto_fix_high', text: 'text-indigo-700', ring: 'focus:ring-indigo-200', customColor: '#4f46e5'}
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
        isDefault: false,
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

const loadData = (): { teams: Team[] } => dataCache;

type DataEnvelope = {
  teams: Team[];
  meta?: {
    revision: number;
    updatedAt: string;
  };
};

const applyServerPayload = (payload: DataEnvelope | null | undefined) => {
  if (!payload) return;
  if (Array.isArray(payload.teams)) {
    dataCache = { teams: payload.teams };
  }
  if (payload.meta?.revision !== undefined) {
    dataRevision = payload.meta.revision;
  }
  if (payload.meta?.updatedAt) {
    dataUpdatedAt = payload.meta.updatedAt;
  }
};

const persistToServer = async () => {
  const payload: DataEnvelope = {
    teams: dataCache.teams,
    meta: {
      revision: dataRevision,
      updatedAt: dataUpdatedAt || new Date().toISOString()
    }
  };

  try {
    const res = await fetch(DATA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.status === 409) {
      const serverPayload = await res.json().catch(() => null);
      console.warn('[dataService] Persist conflict detected, refreshing local cache');
      applyServerPayload(serverPayload);
      return;
    }

    if (!res.ok) {
      console.warn('[dataService] Failed to persist to server', res.status);
      return;
    }

    if (res.status !== 204) {
      const serverPayload = await res.json().catch(() => null);
      if (serverPayload) {
        applyServerPayload(serverPayload);
      }
    }
  } catch (err) {
    console.warn('[dataService] Failed to persist to server', err);
  }
};

const queuePersist = () => {
  persistQueue = persistQueue
    .then(() => persistToServer())
    .catch((err) => {
      console.warn('[dataService] Persist queue error', err);
    });
};

const saveData = (data: { teams: Team[] }) => {
  dataCache = data;
  queuePersist();
};

const ensureSessionPlaceholder = (teamId: string, sessionId: string): RetroSession | undefined => {
  const data = loadData();
  const team = data.teams.find(t => t.id === teamId);
  if (!team) return;

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
  saveData(data);

  return placeholder;
};

const hydrateFromServer = async (): Promise<void> => {
  if (hydratedFromServer) return;
  if (hydrateInFlight) return hydrateInFlight;

  hydrateInFlight = (async () => {
    try {
      const res = await fetch(DATA_ENDPOINT, { cache: 'no-store' });
      if (!res.ok) throw new Error('Bad status');
      const remote = await res.json();
      if (remote?.teams) {
        applyServerPayload(remote);
      }
    } catch (err) {
      console.warn('[dataService] Unable to hydrate from server, using in-memory cache', err);
    } finally {
      hydratedFromServer = true;
      hydrateInFlight = null;
    }
  })();

  return hydrateInFlight;
};

const refreshFromServer = async (): Promise<void> => {
  try {
    const res = await fetch(DATA_ENDPOINT, { cache: 'no-store' });
    if (!res.ok) throw new Error('Bad status');
    const remote = await res.json();
    if (remote?.teams) {
      applyServerPayload(remote);
    }
  } catch (err) {
    console.warn('[dataService] Unable to refresh from server', err);
  }
};

export const dataService = {
  hydrateFromServer,
  refreshFromServer,
  ensureSessionPlaceholder,
  createTeam: (name: string, password: string, facilitatorEmail?: string): Team => {
    const data = loadData();
    if (data.teams.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('Team name already exists');
    }
    const newTeam: Team = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      passwordHash: password,
      facilitatorEmail: facilitatorEmail || undefined,
      members: [
        { id: 'admin-' + Math.random().toString(36).substr(2, 5), name: 'Facilitator', color: USER_COLORS[0], role: 'facilitator' }
      ],
      archivedMembers: [],
      customTemplates: [],
      retrospectives: [],
      globalActions: [],
      lastConnectionDate: new Date().toISOString()
    };
    data.teams.push(newTeam);
    saveData(data);
    return newTeam;
  },

  getAllTeams: (): Team[] => {
      const teams = loadData().teams;
      // Sort alphabetically by name
      return [...teams].sort((a, b) => a.name.localeCompare(b.name));
  },

  loginTeam: (name: string, password: string): Team => {
    const data = loadData();
    const team = data.teams.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (!team) throw new Error('Team not found');
    if (team.passwordHash !== password) throw new Error('Invalid password');
    if (!team.archivedMembers) team.archivedMembers = [];
    team.lastConnectionDate = new Date().toISOString();
    saveData(data);
    return team;
  },

  getTeam: (id: string): Team | undefined => {
    const team = loadData().teams.find(t => t.id === id);
    if (team && !team.archivedMembers) team.archivedMembers = [];
    return team;
  },

  updateTeam: (team: Team): void => {
    const data = loadData();
    const idx = data.teams.findIndex(t => t.id === team.id);
    if (idx === -1) return;

    const existing = data.teams[idx];
    data.teams[idx] = {
      ...existing,
      ...team,
      archivedMembers: team.archivedMembers ?? existing.archivedMembers ?? [],
      customTemplates: team.customTemplates ?? existing.customTemplates ?? [],
      retrospectives: team.retrospectives ?? existing.retrospectives ?? [],
      globalActions: team.globalActions ?? existing.globalActions ?? [],
      healthChecks: team.healthChecks ?? existing.healthChecks,
      customHealthCheckTemplates: team.customHealthCheckTemplates ?? existing.customHealthCheckTemplates,
    };

    saveData(data);
  },

  addMember: (teamId: string, name: string, email?: string): User => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');
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
    saveData(data);
    return newUser;
  },

  updateMember: (teamId: string, memberId: string, updates: { name: string; email?: string | null }): User => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');

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
    saveData(data);
    return member;
  },

  removeMember: (teamId: string, memberId: string): void => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) return;

    if (!team.archivedMembers) team.archivedMembers = [];

    const idx = team.members.findIndex(m => m.id === memberId);
    if (idx === -1) return;

    const [removed] = team.members.splice(idx, 1);

    team.archivedMembers = team.archivedMembers.filter(m => m.id !== removed.id);
    team.archivedMembers.push(removed);

    saveData(data);
  },

  createSession: (teamId: string, name: string, templateCols: Column[], options?: { isAnonymous?: boolean }): RetroSession => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');

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
    saveData(data);
    return session;
  },

  updateSession: (teamId: string, session: RetroSession) => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) return;
    const idx = team.retrospectives.findIndex(r => r.id === session.id);
    if (idx !== -1) {
      team.retrospectives[idx] = session;
      saveData(data);
    }
  },

  updateSessionName: (teamId: string, sessionId: string, newName: string) => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) return;
    const session = team.retrospectives.find(r => r.id === sessionId);
    if (session) {
      session.name = newName;
      saveData(data);
    }
  },

  updateHealthCheckName: (teamId: string, healthCheckId: string, newName: string) => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) return;
    if (!team.healthChecks) return;
    const healthCheck = team.healthChecks.find(hc => hc.id === healthCheckId);
    if (healthCheck) {
      healthCheck.name = newName;
      saveData(data);
    }
  },

  saveTemplate: (teamId: string, template: Template) => {
      const data = loadData();
      const team = data.teams.find(t => t.id === teamId);
      if(!team) return;
      team.customTemplates.push(template);
      saveData(data);
  },

  addGlobalAction: (teamId: string, text: string, assigneeId: string | null): ActionItem => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');
    
    const action: ActionItem = {
        id: Math.random().toString(36).substr(2, 9),
        text,
        assigneeId, // If null, it remains null (unassigned)
        done: false,
        type: 'new',
        proposalVotes: {}
    };
    team.globalActions.unshift(action);
    saveData(data);
    return action;
  },

  updateGlobalAction: (teamId: string, action: ActionItem) => {
      const data = loadData();
      const team = data.teams.find(t => t.id === teamId);
      if(!team) return;

      const idx = team.globalActions.findIndex(a => a.id === action.id);
      if(idx !== -1) {
          team.globalActions[idx] = action;
          saveData(data);
          return;
      }

      // Fallback: update a retrospective action (previously created action)
      for (const retro of team.retrospectives) {
          const retroIdx = retro.actions.findIndex(a => a.id === action.id);
          if (retroIdx !== -1) {
              retro.actions[retroIdx] = { ...retro.actions[retroIdx], ...action };
              saveData(data);
              break;
          }
      }
  },

  toggleGlobalAction: (teamId: string, actionId: string) => {
      const data = loadData();
      const team = data.teams.find(t => t.id === teamId);
      if (!team) return;

      const action = team.globalActions.find(a => a.id === actionId);
      if(action) {
          action.done = !action.done;
          saveData(data);
      } else {
          // Check retro actions
          for(const retro of team.retrospectives) {
              const ra = retro.actions.find(a => a.id === actionId);
              if(ra) {
                  ra.done = !ra.done;
                  saveData(data);
                  break;
              }
          }
      }
  },

  deleteAction: (teamId: string, actionId: string) => {
      const data = loadData();
      const team = data.teams.find(t => t.id === teamId);
      if (!team) return;

      const beforeGlobal = team.globalActions.length;
      team.globalActions = team.globalActions.filter(a => a.id !== actionId);

      let deleted = beforeGlobal !== team.globalActions.length;

      team.retrospectives.forEach(retro => {
          const before = retro.actions.length;
          retro.actions = retro.actions.filter(a => a.id !== actionId);
          if (before !== retro.actions.length) deleted = true;
      });

      if (deleted) {
          saveData(data);
      }
  },

  deleteRetrospective: (teamId: string, retroId: string) => {
      const data = loadData();
      const team = data.teams.find(t => t.id === teamId);
      if (!team) return;

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
      saveData(data);
  },

  getPresets: () => PRESETS,
  getHex,

  createMemberInvite: (teamId: string, email: string, sessionId?: string, nameHint?: string, healthCheckSessionId?: string) => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');
    if (!team.archivedMembers) team.archivedMembers = [];

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) throw new Error('Valid email required');

    const user = team.members.find(m => normalizeEmail(m.email) === normalizedEmail);
    if (user && !user.inviteToken) {
      user.inviteToken = Math.random().toString(36).slice(2, 10);
      saveData(data);
    }

    const inviteData: Record<string, any> = {
      id: team.id,
      name: team.name,
      password: team.passwordHash,
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
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) return;
    if (!team.archivedMembers) team.archivedMembers = [];

    let changed = false;

    participants.forEach(p => {
      const normalizedEmail = normalizeEmail(p.email);
      const existing = team.members.find(m => {
        if (p.inviteToken && m.inviteToken === p.inviteToken) return true;
        if (normalizedEmail && normalizeEmail(m.email) === normalizedEmail) return true;
        return m.id === p.id || m.name.toLowerCase() === p.name.toLowerCase();
      });

      const archived = team.archivedMembers.find(m => m.id === p.id || (normalizedEmail && normalizeEmail(m.email) === normalizedEmail));

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

    if (changed) saveData(data);
  },

  // Import a team from invitation data (for invited users)
  importTeam: (inviteData: { id: string; name: string; password: string; sessionId?: string; session?: RetroSession; members?: User[]; globalActions?: ActionItem[]; retrospectives?: RetroSession[]; memberId?: string; memberEmail?: string; memberName?: string; inviteToken?: string }): Team => {
    const data = loadData();

    // Check if team already exists by ID
    const existingById = data.teams.find(t => t.id === inviteData.id);
    if (existingById) {
      const sessionId = inviteData.session?.id || inviteData.sessionId;
      // Update the session if provided and it doesn't exist yet
      if (inviteData.session) {
        const existingSession = existingById.retrospectives.find(r => r.id === inviteData.session!.id);
        if (!existingSession) {
          existingById.retrospectives.unshift(inviteData.session);
          saveData(data);
        } else {
          // Update the existing session with fresh data from facilitator
          const idx = existingById.retrospectives.findIndex(r => r.id === inviteData.session!.id);
          if (idx !== -1) {
            existingById.retrospectives[idx] = inviteData.session;
            saveData(data);
          }
        }
      } else if (sessionId && !existingById.retrospectives.some(r => r.id === sessionId)) {
        const placeholder = ensureSessionPlaceholder(inviteData.id, sessionId);
        if (placeholder && inviteData.members?.length) {
          placeholder.participants = inviteData.members;
          saveData(data);
        }
      }
      return existingById;
    }

    // Create the team in the shared cache for this invited user
    const invitedMember = inviteData.memberId
      ? {
        id: inviteData.memberId,
        name: inviteData.memberName || 'Guest',
        color: USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)],
        role: 'participant' as const,
        email: normalizeEmail((inviteData as any).memberEmail),
        inviteToken: (inviteData as any).inviteToken
      }
      : null;

      const enrichedSession: RetroSession | undefined = inviteData.session
        ? { ...inviteData.session, participants: inviteData.session.participants ?? inviteData.members ?? [] }
        : inviteData.sessionId
          ? {
              id: inviteData.sessionId,
              teamId: inviteData.id,
              name: 'Retrospective',
              date: new Date().toLocaleDateString(),
              status: 'IN_PROGRESS',
              phase: 'ICEBREAKER',
              participants: inviteData.members ?? [],
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
            }
          : undefined;

    const newTeam: Team = {
      id: inviteData.id,
      name: inviteData.name,
      passwordHash: inviteData.password,
      members: inviteData.members && inviteData.members.length > 0
        ? inviteData.members
        : [
          { id: 'admin-' + Math.random().toString(36).substr(2, 5), name: 'Facilitator', color: USER_COLORS[0], role: 'facilitator' }
        ],
      archivedMembers: [],
      customTemplates: [],
      retrospectives: inviteData.retrospectives ?? (enrichedSession ? [enrichedSession] : []),
      globalActions: inviteData.globalActions ?? []
    };

    if (invitedMember && !newTeam.members.some(m => m.id === invitedMember.id)) {
      newTeam.members.push(invitedMember);
    }
    data.teams.push(newTeam);
    saveData(data);
    return newTeam;
  },

  // Delete a team and all its data
  deleteTeam: (teamId: string): void => {
    const data = loadData();
    const idx = data.teams.findIndex(t => t.id === teamId);
    if (idx !== -1) {
      data.teams.splice(idx, 1);
      saveData(data);
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
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');
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

      saveData(data);
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
    saveData(data);
    return { team, user: newUser };
  },

  autoJoinFromInvite: (
    teamId: string,
    inviteData: { memberId?: string; memberEmail?: string; inviteToken?: string }
  ): { team: Team; user: User } => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');

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

    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) return defaults;

    const customTemplates = team.customHealthCheckTemplates || [];
    return [...defaults, ...customTemplates];
  },

  createHealthCheckSession: (
    teamId: string,
    name: string,
    templateId: string,
    options?: { isAnonymous?: boolean }
  ): HealthCheckSession => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');

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
    saveData(data);
    return session;
  },

  updateHealthCheckSession: (teamId: string, session: HealthCheckSession) => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) return;

    if (!team.healthChecks) team.healthChecks = [];

    const idx = team.healthChecks.findIndex(h => h.id === session.id);
    if (idx !== -1) {
      team.healthChecks[idx] = session;
      saveData(data);
    }
  },

  deleteHealthCheck: (teamId: string, healthCheckId: string) => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team || !team.healthChecks) return;

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
    saveData(data);
  },

  saveHealthCheckTemplate: (teamId: string, template: HealthCheckTemplate) => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) return;

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

    saveData(data);
  },

  deleteHealthCheckTemplate: (teamId: string, templateId: string) => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team || !team.customHealthCheckTemplates) return;

    team.customHealthCheckTemplates = team.customHealthCheckTemplates.filter(t => t.id !== templateId);
    saveData(data);
  },

  getHealthCheck: (teamId: string, healthCheckId: string): HealthCheckSession | undefined => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team || !team.healthChecks) return undefined;
    return team.healthChecks.find(h => h.id === healthCheckId);
  },

  ensureHealthCheckPlaceholder: (teamId: string, sessionId: string): HealthCheckSession | undefined => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) return;

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
    saveData(data);

    return placeholder;
  },

  // Create invite link for health check session
  createHealthCheckInvite: (teamId: string, sessionId: string) => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');

    const inviteData = {
      id: team.id,
      name: team.name,
      password: team.passwordHash,
      healthCheckSessionId: sessionId,
    };

    const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(inviteData))));
    const link = `${window.location.origin}?join=${encodeURIComponent(encodedData)}`;

    return { inviteLink: link };
  },

  // Password recovery functions
  updateFacilitatorEmail: (teamId: string, email: string): void => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');
    team.facilitatorEmail = email || undefined;
    saveData(data);
  },

  changeTeamPassword: (teamId: string, newPassword: string): void => {
    if (!newPassword || newPassword.length < 4) {
      throw new Error('Password must be at least 4 characters');
    }
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');
    team.passwordHash = newPassword;
    saveData(data);
  },

  renameTeam: (teamId: string, newName: string): void => {
    if (!newName || newName.trim().length === 0) {
      throw new Error('Team name cannot be empty');
    }
    const trimmedName = newName.trim();
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');
    // Check if another team already has this name (case-insensitive)
    const existingTeam = data.teams.find(t => t.id !== teamId && t.name.toLowerCase() === trimmedName.toLowerCase());
    if (existingTeam) {
      throw new Error('A team with this name already exists');
    }
    team.name = trimmedName;
    saveData(data);
  },

  requestPasswordReset: async (teamName: string, email: string): Promise<{ success: boolean; message: string }> => {
    const data = loadData();
    const team = data.teams.find(t => t.name.toLowerCase() === teamName.toLowerCase());

    if (!team) {
      // Return success even if team not found for security (don't leak team existence)
      return { success: true, message: 'If the team and email match, a reset link has been sent.' };
    }

    if (!team.facilitatorEmail || team.facilitatorEmail.toLowerCase() !== email.toLowerCase()) {
      // Return success even if email doesn't match for security
      return { success: true, message: 'If the team and email match, a reset link has been sent.' };
    }

    // Generate reset token (valid for 1 hour)
    const resetToken = Math.random().toString(36).substr(2, 20) + Date.now().toString(36);
    const resetExpiry = Date.now() + 3600000; // 1 hour from now

    // Store token temporarily (in production, this should be in a separate secure store)
    const resetData = {
      teamId: team.id,
      token: resetToken,
      expiry: resetExpiry
    };

    // Store in localStorage temporarily (in production, use backend)
    const resetTokens = JSON.parse(localStorage.getItem('passwordResetTokens') || '[]');
    resetTokens.push(resetData);
    localStorage.setItem('passwordResetTokens', JSON.stringify(resetTokens));

    // Send email with reset link
    const resetLink = `${window.location.origin}?reset=${resetToken}`;

    try {
      const response = await fetch('/api/send-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: team.facilitatorEmail,
          teamName: team.name,
          resetLink
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

  resetPassword: (token: string, newPassword: string): { success: boolean; message: string; teamName?: string } => {
    // Retrieve stored tokens
    const resetTokens = JSON.parse(localStorage.getItem('passwordResetTokens') || '[]');
    const resetDataIndex = resetTokens.findIndex((r: any) => r.token === token && r.expiry > Date.now());

    if (resetDataIndex === -1) {
      return { success: false, message: 'The reset link is invalid or has expired.' };
    }

    const resetData = resetTokens[resetDataIndex];
    const data = loadData();
    const team = data.teams.find(t => t.id === resetData.teamId);

    if (!team) {
      return { success: false, message: 'Team not found.' };
    }

    // Update password
    team.passwordHash = newPassword;
    saveData(data);

    // Remove used token
    resetTokens.splice(resetDataIndex, 1);
    localStorage.setItem('passwordResetTokens', JSON.stringify(resetTokens));

    return { success: true, message: 'Password successfully reset.', teamName: team.name };
  },

  verifyResetToken: (token: string): { valid: boolean; teamName?: string } => {
    const resetTokens = JSON.parse(localStorage.getItem('passwordResetTokens') || '[]');
    const resetData = resetTokens.find((r: any) => r.token === token && r.expiry > Date.now());

    if (!resetData) {
      return { valid: false };
    }

    const data = loadData();
    const team = data.teams.find(t => t.id === resetData.teamId);

    if (!team) {
      return { valid: false };
    }

    return { valid: true, teamName: team.name };
  },

  // ==================== TEAM FEEDBACK METHODS ====================

  createTeamFeedback: (teamId: string, feedback: Omit<TeamFeedback, 'id' | 'submittedAt' | 'isRead' | 'status'>): TeamFeedback => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');

    if (!team.teamFeedbacks) team.teamFeedbacks = [];

    const newFeedback: TeamFeedback = {
      ...feedback,
      id: 'feedback_' + Math.random().toString(36).substr(2, 9),
      submittedAt: new Date().toISOString(),
      isRead: false,
      status: 'pending'
    };

    team.teamFeedbacks.unshift(newFeedback);
    saveData(data);
    return newFeedback;
  },

  updateTeamFeedback: (teamId: string, feedbackId: string, updates: Partial<TeamFeedback>): void => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team || !team.teamFeedbacks) return;

    const idx = team.teamFeedbacks.findIndex(f => f.id === feedbackId);
    if (idx !== -1) {
      team.teamFeedbacks[idx] = { ...team.teamFeedbacks[idx], ...updates };
      saveData(data);
    }
  },

  deleteTeamFeedback: (teamId: string, feedbackId: string): void => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team || !team.teamFeedbacks) return;

    team.teamFeedbacks = team.teamFeedbacks.filter(f => f.id !== feedbackId);
    saveData(data);
  },

  getTeamFeedbacks: (teamId: string): TeamFeedback[] => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    return team?.teamFeedbacks || [];
  },

  getAllFeedbacks: (): TeamFeedback[] => {
    const data = loadData();
    const allFeedbacks: TeamFeedback[] = [];

    data.teams.forEach(team => {
      if (team.teamFeedbacks && team.teamFeedbacks.length > 0) {
        allFeedbacks.push(...team.teamFeedbacks);
      }
    });

    // Sort by submission date (newest first)
    return allFeedbacks.sort((a, b) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  },

  markFeedbackAsRead: (teamId: string, feedbackId: string): void => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team || !team.teamFeedbacks) return;

    const feedback = team.teamFeedbacks.find(f => f.id === feedbackId);
    if (feedback) {
      feedback.isRead = true;
      saveData(data);
    }
  },

  getUnreadFeedbackCount: (): number => {
    const data = loadData();
    let count = 0;

    data.teams.forEach(team => {
      if (team.teamFeedbacks) {
        count += team.teamFeedbacks.filter(f => !f.isRead).length;
      }
    });

    return count;
  }
};
