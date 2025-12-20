
import {
  Team,
  User,
  RetroSession,
  ActionItem,
  Column,
  Template,
  HealthCheckModel,
  HealthCheckSession,
  HealthDimensionRating,
} from '../types';

const DATA_ENDPOINT = '/api/data';

let hydratedFromServer = false;
let hydrateInFlight: Promise<void> | null = null;
let dataCache: { teams: Team[] } = { teams: [] };

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

const DEFAULT_HEALTH_MODELS: HealthCheckModel[] = [
  {
    id: 'builtin-health-en',
    name: 'Team Health (EN)',
    language: 'en',
    description: 'Baseline model to inspect team wellbeing across autonomy, objectives, and collaboration.',
    dimensions: [
      { id: 'autonomy', title: 'Autonomy', good: 'I have the freedom, flexibility, and ability to do the work. There is room to be creative about solutions.', bad: 'There are too many processes, rules, external dependencies, and obstacles to getting work done autonomously. The path is already paved.' },
      { id: 'objective', title: 'Objective', good: 'My work is meaningful and the goals are clear.', bad: "I'm busy without really knowing where we are going or why. I am not sure what is expected of me." },
      { id: 'challenge', title: 'Challenge', good: 'The work is neither too easy nor too hard, and the effort is balanced. The workload is adequate.', bad: 'Mismatch between my skills and my work. (Too easy/too hard). I am overloaded.' },
      { id: 'growth', title: 'Fulfillment', good: 'I give and receive in return. My activity contributes to my personal development and career.', bad: "I do not get as much from my activity as I would like." },
      { id: 'teamwork', title: 'Teamwork', good: 'I share the same objectives with my teammates. We organize ourselves to achieve them and rely on each other.', bad: "We are a group of individuals with different goals. I am not concerned or I do not always know others' objectives." },
      { id: 'org_link', title: 'Link with the organization', good: 'There is synergy between the team and the organization it sits in. Collective intelligence is valued and sought. Communication is facilitated and bidirectional; the team can influence the organization.', bad: 'One-way communication, top-down. Collective intelligence is not sought. Concerns raised are not addressed.' },
      { id: 'learning', title: 'Learning & initiative', good: 'I have room to learn and take initiative. If I make a mistake, it will never be held against me. I can always contribute without risk.', bad: "Mistakes are seen as failure rather than learning. The environment does not encourage initiative. It is safer to keep quiet than to try to contribute." },
      { id: 'transparency', title: 'Transparency', good: 'Transparency is valued, pursued, and present. Its absence is immediately pointed out.', bad: 'Appearances often matter more. Transparency is missing. People prefer not to address the lack of transparency.' },
      { id: 'communication', title: 'Communication inside the team', good: 'The team can calmly address difficult topics. Debate is healthy and the goal is to reach the best option/resolution.', bad: 'Difficult topics create lasting tension. Conflicts sometimes focus on people instead of ideas.' },
      { id: 'accountability', title: 'Holding each other accountable', good: 'Feedback is given and received smoothly. Team members hold each other accountable; gaps are addressed.', bad: 'Feedback often creates conflict. Team members prefer to avoid discussing gaps and do not hold each other accountable.' },
      { id: 'energy', title: 'Team energy (synthesis)', good: 'Conversations are healthy and constructive, engagement is collective, the pace is sustainable and fun; we feel good in this team.', bad: 'Fatigue, disengagement, unsustainable pace, tensions; things could be better in the team.' },
    ],
  },
  {
    id: 'builtin-health-fr',
    name: 'Bilan santé (FR)',
    language: 'fr',
    description: 'Modèle de référence pour suivre la santé de l’équipe en français.',
    dimensions: [
      { id: 'autonomie', title: 'Autonomie', good: "J'ai la liberté, la flexibilité et la capacité de faire le travail. Il y a de l'espace pour être créatif sur les solutions", bad: 'Il y a trop de processus, des règles, des dépendances externes et des obstacles pour réaliser le travail en autonomie. La route est déjà pré-tracée.' },
      { id: 'objectif', title: 'Objectif', good: 'Mon travail a du sens et les buts à atteindre sont clairs.', bad: "Je suis occupé sans forcément savoir vers où on va et pourquoi. Je ne vois pas bien ce qu'on attend de moi." },
      { id: 'challenge', title: 'Challenge', good: 'Le travail n’est ni trop facile, ni trop difficile et l’effort nécessaire est équilibré. La charge de travail est adéquate.', bad: "Inadéquation entre mes compétences et mon travail. (C'est trop facile/difficile). Je suis surchargé." },
      { id: 'epanouissement', title: 'Épanouissement', good: 'Je donne et je reçois en retour. Mon activité contribue à mon développement personnel et ma carrière', bad: "Je ne tire pas de mon activité autant que je souhaiterais" },
      { id: 'travail_equipe', title: 'Travail d’équipe', good: 'Je partage avec mes collègues les mêmes objectifs. Nous nous organisons pour les atteindre et dépendons les uns des autres.', bad: 'Nous sommes un groupe d’individus avec des objectifs différents. Je ne suis pas concerné ou je ne connais pas toujours quels sont les objectifs des autres.' },
      { id: 'lien_org', title: "Lien avec l'organisation", good: "Il y a une synergie entre l'équipe et l'organisation dans laquelle elle se situe. L'intelligence collective est valorisée et recherchée. La communication facilitée et bidirectionnelle, l'équipe est capable d'avoir une influence sur l'organisation.", bad: "Communication unidirectionnelle, Rapport dirigeant -> exécutant. L'intelligence collective n'est pas recherchée. Les préoccupations remontées ne sont pas adressées." },
      { id: 'apprentissage', title: 'Apprentissages et initiatives', good: "J'ai de l'espace pour apprendre et mener des initiatives. Si je fais une erreur, elle ne sera jamais retenue contre moi. Je peux toujours contribuer sans risque que ça se retourne contre moi.", bad: "Les erreurs sont vues comme un échec plutôt qu'un apprentissage. L'environnement ne pousse pas à la prise d'initiative. Il est plus prudent de garder le silence que d'essayer de contribuer." },
      { id: 'transparence', title: 'Transparence', good: 'La transparence est valorisée, recherchée et présente. Son absence est immédiatement pointée', bad: 'Les apparences sont souvent plus importantes. La transparence n’est pas présente. On préfère ne pas aborder l’absence de transparence.' },
      { id: 'communication_equipe', title: "Communication dans l'équipe", good: "L'équipe arrive à aborder sereinement les sujet difficiles. Le débat est sain et l'objectif est toujours d'arriver à la meilleure option/résolution", bad: 'Les sujets difficiles créent des tensions qui demeurent. Les conflits se déportent parfois sur les personnes et non plus les idées.' },
      { id: 'responsabilite', title: 'Se tenir mutuellement responsables', good: 'Les feedbacks sont donnés et reçus de manière fluide. Les membres de l’équipe se tiennent responsables, les manquements sont adressés.', bad: "Les feedbacks sont souvent source de conflit. Les membres de l'équipes préfèrent éviter d'évoquer les manquement et ne se tiennent pas mutuellement responsables." },
      { id: 'energie', title: "Energie de l'équipe (synthèse)", good: "Les échanges sont sains et constructifs, l'engagement est collectif, le rythme est soutenable c'est fun, on est bien dans cette équipe", bad: "Fatigue, désengagement, rythme insoutenable, tensions, ça pourrait aller mieux dans l'équipe" },
    ],
  },
];

const PRESETS: Record<string, Column[]> = {
    'start_stop_continue': [
        {id: 'start', title: 'Start', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'play_arrow', text: 'text-emerald-700', ring: 'focus:ring-emerald-200'},
        {id: 'stop', title: 'Stop', color: 'bg-rose-50', border: 'border-rose-400', icon: 'stop', text: 'text-rose-700', ring: 'focus:ring-rose-200'},
        {id: 'continue', title: 'Continue', color: 'bg-sky-50', border: 'border-sky-400', icon: 'fast_forward', text: 'text-sky-700', ring: 'focus:ring-sky-200'}
    ],
    '4l': [
        {id: 'liked', title: 'Liked', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'thumb_up', text: 'text-emerald-700', ring: 'focus:ring-emerald-200'},
        {id: 'learned', title: 'Learned', color: 'bg-sky-50', border: 'border-sky-400', icon: 'lightbulb', text: 'text-sky-700', ring: 'focus:ring-sky-200'},
        {id: 'lacked', title: 'Lacked', color: 'bg-orange-50', border: 'border-orange-400', icon: 'warning', text: 'text-orange-700', ring: 'focus:ring-orange-200'},
        {id: 'longed_for', title: 'Longed For', color: 'bg-purple-50', border: 'border-purple-400', icon: 'favorite', text: 'text-purple-700', ring: 'focus:ring-purple-200'}
    ],
    'mad_sad_glad': [
        {id: 'mad', title: 'Mad', color: 'bg-rose-50', border: 'border-rose-400', icon: 'sentiment_very_dissatisfied', text: 'text-rose-700', ring: 'focus:ring-rose-200'},
        {id: 'sad', title: 'Sad', color: 'bg-slate-50', border: 'border-slate-400', icon: 'sentiment_dissatisfied', text: 'text-slate-700', ring: 'focus:ring-slate-200'},
        {id: 'glad', title: 'Glad', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'sentiment_satisfied', text: 'text-emerald-700', ring: 'focus:ring-emerald-200'}
    ],
    'sailboat': [
        {id: 'wind', title: 'Wind (Helps Us)', color: 'bg-cyan-50', border: 'border-cyan-400', icon: 'sailing', text: 'text-cyan-700', ring: 'focus:ring-cyan-200'},
        {id: 'anchor', title: 'Anchors (Slow Us)', color: 'bg-amber-50', border: 'border-amber-400', icon: 'anchor', text: 'text-amber-700', ring: 'focus:ring-amber-200'},
        {id: 'rocks', title: 'Rocks (Risks)', color: 'bg-rose-50', border: 'border-rose-400', icon: 'report_problem', text: 'text-rose-700', ring: 'focus:ring-rose-200'},
        {id: 'island', title: 'Island (Goals)', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'flag', text: 'text-emerald-700', ring: 'focus:ring-emerald-200'}
    ],
    'went_well': [
        {id: 'went_well', title: 'Went Well', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'check_circle', text: 'text-emerald-700', ring: 'focus:ring-emerald-200'},
        {id: 'to_improve', title: 'To Improve', color: 'bg-orange-50', border: 'border-orange-400', icon: 'trending_down', text: 'text-orange-700', ring: 'focus:ring-orange-200'},
        {id: 'ideas', title: 'Ideas / Experiments', color: 'bg-indigo-50', border: 'border-indigo-400', icon: 'auto_fix_high', text: 'text-indigo-700', ring: 'focus:ring-indigo-200'}
    ]
};

const cloneDefaultModels = (): HealthCheckModel[] => DEFAULT_HEALTH_MODELS.map(model => ({
  ...model,
  dimensions: model.dimensions.map(d => ({ ...d })),
}));

const ensureHealthCollections = (team: Team) => {
  if (!team.healthModels) {
    team.healthModels = cloneDefaultModels();
  } else {
    const existingIds = new Set(team.healthModels.map(m => m.id));
    DEFAULT_HEALTH_MODELS.forEach(model => {
      if (!existingIds.has(model.id)) {
        team.healthModels!.push({
          ...model,
          dimensions: model.dimensions.map(d => ({ ...d })),
        });
      }
    });
  }

  if (!team.healthChecks) team.healthChecks = [];
};

const loadData = (): { teams: Team[] } => dataCache;

const persistToServer = async (data: { teams: Team[] }) => {
  try {
    await fetch(DATA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch (err) {
    console.warn('[dataService] Failed to persist to server', err);
  }
};

const saveData = (data: { teams: Team[] }) => {
  dataCache = data;
  persistToServer(data);
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

const ensureHealthPlaceholder = (teamId: string, healthId: string): HealthCheckSession | undefined => {
  const data = loadData();
  const team = data.teams.find(t => t.id === teamId);
  if (!team) return;

  ensureHealthCollections(team);

  const existing = team.healthChecks?.find(h => h.id === healthId);
  if (existing) return existing;

  const model = (team.healthModels && team.healthModels[0]) || cloneDefaultModels()[0];

  const placeholder: HealthCheckSession = {
    id: healthId,
    teamId,
    name: 'Health check',
    modelId: model.id,
    date: new Date().toLocaleDateString(),
    isAnonymous: false,
    phase: 'SURVEY',
    participants: [...(team.members || [])],
    responses: [],
  };

  team.healthChecks?.unshift(placeholder);
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
        dataCache = { teams: remote.teams };
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

export const dataService = {
  hydrateFromServer,
  ensureSessionPlaceholder,
  ensureHealthPlaceholder,
  createTeam: (name: string, password: string): Team => {
    const data = loadData();
    if (data.teams.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('Team name already exists');
    }
    const newTeam: Team = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      passwordHash: password,
      members: [
        { id: 'admin-' + Math.random().toString(36).substr(2, 5), name: 'Facilitator', color: USER_COLORS[0], role: 'facilitator' }
      ],
      archivedMembers: [],
      customTemplates: [],
      retrospectives: [],
      globalActions: [],
      healthModels: cloneDefaultModels(),
      healthChecks: [],
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
    ensureHealthCollections(team);
    return team;
  },

  getTeam: (id: string): Team | undefined => {
    const team = loadData().teams.find(t => t.id === id);
    if (team && !team.archivedMembers) team.archivedMembers = [];
    if (team) ensureHealthCollections(team);
    return team;
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

  createMemberInvite: (teamId: string, email: string, sessionId?: string, nameHint?: string, sessionType: 'retro' | 'health' = 'retro') => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');
    if (!team.archivedMembers) team.archivedMembers = [];

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) throw new Error('Valid email required');

    let user = team.members.find(m => normalizeEmail(m.email) === normalizedEmail);
    if (user) {
      user.name = nameHint || user.name || normalizedEmail.split('@')[0];
      if (!user.inviteToken) user.inviteToken = Math.random().toString(36).slice(2, 10);
    } else {
      user = {
        id: Math.random().toString(36).substr(2, 9),
        name: nameHint || email.split('@')[0],
        color: USER_COLORS[team.members.length % USER_COLORS.length],
        role: 'participant',
        email: normalizedEmail,
        inviteToken: Math.random().toString(36).slice(2, 10)
      };
      team.members.push(user);
    }

    saveData(data);

    const activeSession = sessionType === 'retro' && sessionId ? team.retrospectives.find(r => r.id === sessionId) : undefined;
    const activeHealth = sessionType === 'health' && sessionId ? team.healthChecks?.find(h => h.id === sessionId) : undefined;

    const inviteData = {
      id: team.id,
      name: team.name,
      password: team.passwordHash,
      sessionId,
      sessionType,
      session: activeSession,
      healthSessionId: sessionType === 'health' ? sessionId : undefined,
      healthSession: activeHealth,
      memberId: user.id,
      memberEmail: user.email,
      inviteToken: user.inviteToken
    };

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
  importTeam: (inviteData: { id: string; name: string; password: string; sessionId?: string; session?: RetroSession; healthSessionId?: string; healthSession?: HealthCheckSession; sessionType?: 'retro' | 'health'; members?: User[]; globalActions?: ActionItem[]; retrospectives?: RetroSession[]; memberId?: string; memberEmail?: string; memberName?: string; inviteToken?: string }): Team => {
    const data = loadData();

    const targetType: 'retro' | 'health' = inviteData.sessionType || 'retro';

    // Check if team already exists by ID
    const existingById = data.teams.find(t => t.id === inviteData.id);
    if (existingById) {
      const sessionId =
        targetType === 'health'
          ? inviteData.healthSession?.id || inviteData.healthSessionId || inviteData.sessionId
          : inviteData.session?.id || inviteData.sessionId;

      // Update the session if provided and it doesn't exist yet
      if (targetType === 'retro' && inviteData.session) {
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
      } else if (targetType === 'health' && inviteData.healthSession) {
        ensureHealthCollections(existingById);
        const already = existingById.healthChecks?.find(h => h.id === inviteData.healthSession!.id);
        if (!already) {
          existingById.healthChecks!.unshift(inviteData.healthSession);
          saveData(data);
        }
      } else if (sessionId) {
        if (targetType === 'health') {
          const placeholder = ensureHealthPlaceholder(inviteData.id, sessionId);
          if (placeholder && inviteData.members?.length) {
            placeholder.participants = inviteData.members;
            saveData(data);
          }
        } else if (!existingById.retrospectives.some(r => r.id === sessionId)) {
          const placeholder = ensureSessionPlaceholder(inviteData.id, sessionId);
          if (placeholder && inviteData.members?.length) {
            placeholder.participants = inviteData.members;
            saveData(data);
          }
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

    const enrichedSession = inviteData.session
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

    const enrichedHealth = inviteData.healthSession
      ? { ...inviteData.healthSession, participants: inviteData.healthSession.participants ?? inviteData.members ?? [] }
      : inviteData.healthSessionId || (inviteData.sessionType === 'health' ? inviteData.sessionId : undefined)
        ? ensureHealthPlaceholder(inviteData.id, (inviteData.healthSessionId || inviteData.sessionId)!)
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
      globalActions: inviteData.globalActions ?? [],
      healthModels: cloneDefaultModels(),
      healthChecks: enrichedHealth ? [enrichedHealth] : [],
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
    ensureHealthCollections(team);

    const normalizedEmail = normalizeEmail(email);

    const existingByToken = inviteToken
      ? team.members.find((m) => m.inviteToken === inviteToken)
      : undefined;
    const existingByEmail = normalizedEmail
      ? team.members.find((m) => normalizeEmail(m.email) === normalizedEmail)
      : undefined;

    const existingUser = existingByToken || existingByEmail;
    if (existingUser) {
      const matchedByIdentity = (inviteToken && existingUser.inviteToken === inviteToken) ||
        (normalizedEmail && normalizeEmail(existingUser.email) === normalizedEmail);

      if (normalizedEmail && existingUser.email !== normalizedEmail) existingUser.email = normalizedEmail;
      if (inviteToken && !existingUser.inviteToken) existingUser.inviteToken = inviteToken;

      const shouldUpdateName =
        !existingUser.joinedBefore ||
        (!matchedByIdentity && existingUser.name !== userName) ||
        !existingUser.name;

      if (shouldUpdateName) {
        existingUser.name = userName;
      }

      existingUser.joinedBefore = true;

      saveData(data);
      return { team, user: existingUser };
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

  getHealthModels: (teamId: string): HealthCheckModel[] => {
    const team = dataService.getTeam(teamId);
    if (!team) return [];
    ensureHealthCollections(team);
    return team.healthModels || [];
  },

  saveHealthModel: (teamId: string, model: Omit<HealthCheckModel, 'id' | 'language' | 'isCustom'>): HealthCheckModel => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');
    ensureHealthCollections(team);

    const newModel: HealthCheckModel = {
      ...model,
      id: 'custom-' + Math.random().toString(36).slice(2, 9),
      language: 'custom',
      isCustom: true,
      dimensions: model.dimensions.map(d => ({ ...d })),
    };

    team.healthModels!.push(newModel);
    saveData(data);
    return newModel;
  },

  createHealthCheck: (teamId: string, name: string, modelId: string, isAnonymous = false): HealthCheckSession => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');
    ensureHealthCollections(team);

    const modelExists = (team.healthModels || []).some(m => m.id === modelId);
    if (!modelExists) throw new Error('Health model not found');

    const session: HealthCheckSession = {
      id: 'health-' + Math.random().toString(36).slice(2, 9),
      teamId,
      name,
      modelId,
      date: new Date().toLocaleDateString(),
      isAnonymous,
      phase: 'SURVEY',
      participants: [...team.members],
      responses: [],
    };

    team.healthChecks!.unshift(session);
    saveData(data);
    return session;
  },

  submitHealthResponse: (
    teamId: string,
    healthCheckId: string,
    userId: string,
    ratings: Record<string, HealthDimensionRating>,
    anonymousName?: string,
  ): void => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');
    ensureHealthCollections(team);

    const check = team.healthChecks?.find(h => h.id === healthCheckId);
    if (!check) throw new Error('Health check not found');

    // Only allow collecting ratings during the survey phase
    if (check.phase !== 'SURVEY') {
      return;
    }

    const existing = check.responses.find(r => r.userId === userId);
    if (existing) {
      existing.ratings = ratings;
      if (anonymousName) existing.anonymousName = anonymousName;
    } else {
      check.responses.push({ userId, ratings, anonymousName });
    }

    saveData(data);
  },

  advanceHealthPhase: (teamId: string, healthCheckId: string): void => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');
    ensureHealthCollections(team);

    const check = team.healthChecks?.find(h => h.id === healthCheckId);
    if (!check) throw new Error('Health check not found');

    const order: HealthCheckSession['phase'][] = ['SURVEY', 'DISCUSS', 'REVIEW', 'CLOSED'];
    const currentIdx = order.indexOf(check.phase);
    check.phase = order[Math.min(currentIdx + 1, order.length - 1)];

    saveData(data);
  }
};
