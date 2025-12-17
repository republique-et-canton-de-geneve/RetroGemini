
import { Team, User, RetroSession, ActionItem, Column, Template } from '../types';

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
      customTemplates: [],
      retrospectives: [],
      globalActions: []
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
    return team;
  },

  getTeam: (id: string): Team | undefined => {
    return loadData().teams.find(t => t.id === id);
  },

  addMember: (teamId: string, name: string, email?: string): User => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');

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
        timerRunning: false
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

  createMemberInvite: (teamId: string, email: string, sessionId?: string, nameHint?: string) => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');

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

    const inviteData = {
      id: team.id,
      name: team.name,
      password: team.passwordHash,
      sessionId,
      memberId: user.id,
      memberEmail: user.email,
      inviteToken: user.inviteToken
    };

    const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(inviteData))));
    const link = `${window.location.origin}?join=${encodedData}`;

    return { user, inviteLink: link };
  },

  persistParticipants: (teamId: string, participants: User[]) => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) return;

    let changed = false;

    participants.forEach(p => {
      const normalizedEmail = normalizeEmail(p.email);
      const existing = team.members.find(m => {
        if (p.inviteToken && m.inviteToken === p.inviteToken) return true;
        if (normalizedEmail && normalizeEmail(m.email) === normalizedEmail) return true;
        return m.id === p.id || m.name.toLowerCase() === p.name.toLowerCase();
      });

      if (existing) {
        if (existing.name !== p.name) { existing.name = p.name; changed = true; }
        if (normalizedEmail && existing.email !== normalizedEmail) { existing.email = normalizedEmail; changed = true; }
        if (!existing.inviteToken && p.inviteToken) { existing.inviteToken = p.inviteToken; changed = true; }
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
      }
      return existingById;
    }

    // Check if team exists by name (different ID - conflict)
    const existingByName = data.teams.find(t => t.name.toLowerCase() === inviteData.name.toLowerCase());
    if (existingByName) {
      // Team name exists but with different ID - return existing
      return existingByName;
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
  joinTeamAsParticipant: (teamId: string, userName: string, email?: string, inviteToken?: string): { team: Team; user: User } => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');

    const normalizedEmail = normalizeEmail(email);

    // Check if user already exists by email or invite token
    const existingUser = team.members.find(m => {
      if (inviteToken && m.inviteToken === inviteToken) return true;
      if (normalizedEmail && normalizeEmail(m.email) === normalizedEmail) return true;
      return m.name.toLowerCase() === userName.toLowerCase();
    });
    if (existingUser) {
      existingUser.name = userName;
      if (normalizedEmail) existingUser.email = normalizedEmail;
      if (inviteToken && !existingUser.inviteToken) existingUser.inviteToken = inviteToken;
      saveData(data);
      return { team, user: existingUser };
    }

    // Create new participant
    const newUser: User = {
      id: Math.random().toString(36).substr(2, 9),
      name: userName,
      color: USER_COLORS[team.members.length % USER_COLORS.length],
      role: 'participant',
      email: normalizedEmail || undefined,
      inviteToken: inviteToken || Math.random().toString(36).slice(2, 10)
    };
    team.members.push(newUser);
    saveData(data);
    return { team, user: newUser };
  }
};
