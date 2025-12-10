
import { Team, User, RetroSession, ActionItem, Column, Template } from '../types';

const STORAGE_KEY = 'retrogemini_data_v2'; // Bump version to clear old data structure issues

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
    ]
};

const loadData = (): { teams: Team[] } => {
  const s = localStorage.getItem(STORAGE_KEY);
  return s ? JSON.parse(s) : { teams: [] };
};

const saveData = (data: { teams: Team[] }) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

export const dataService = {
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
      return teams.sort((a, b) => a.name.localeCompare(b.name));
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

  addMember: (teamId: string, name: string): User => {
    const data = loadData();
    const team = data.teams.find(t => t.id === teamId);
    if (!team) throw new Error('Team not found');
    
    // Check if user exists simply by name for this prototype to avoid dups on reload
    const existing = team.members.find(m => m.name === name);
    if(existing) return existing;

    const newUser: User = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      color: USER_COLORS[team.members.length % USER_COLORS.length],
      role: 'participant'
    };
    team.members.push(newUser);
    saveData(data);
    return newUser;
  },

  createSession: (teamId: string, name: string, templateCols: Column[]): RetroSession => {
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
      icebreakerQuestion: icebreakerQuestion,
      columns: templateCols,
      settings: {
        isAnonymous: false,
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
      happiness: {},
      roti: {},
      finishedUsers: []
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

  getPresets: () => PRESETS,
  getHex
};
