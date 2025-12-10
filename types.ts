
export type Role = 'facilitator' | 'participant';

export interface User {
  id: string;
  name: string;
  color: string;
  role: Role;
}

export interface Column {
  id: string;
  title: string;
  color: string;
  border: string;
  icon: string;
  text: string;
  ring: string;
}

export interface Ticket {
  id: string;
  colId: string;
  text: string;
  authorId: string;
  groupId: string | null;
  votes: string[]; // Array of user IDs
  reactions?: Record<string, string[]>; // Emoji -> Array of UserIDs
}

export interface Group {
  id: string;
  title: string;
  colId: string;
  votes: string[];
}

export interface ActionItem {
  id: string;
  text: string;
  assigneeId: string | null;
  done: boolean;
  type: 'prev' | 'new' | 'proposal'; // 'proposal' needs validation
  linkedTicketId?: string;
  proposalVotes: Record<string, 'up' | 'down' | 'neutral'>; // UserID -> Vote
  originRetro?: string;
}

export interface RetroSettings {
  isAnonymous: boolean;
  maxVotes: number;
  oneVotePerTicket: boolean;
  revealBrainstorm: boolean;
  revealHappiness: boolean;
  revealRoti: boolean;
  timerSeconds: number; // Remaining time
  timerRunning: boolean;
  timerInitial: number;
}

export interface RetroSession {
  id: string;
  teamId: string;
  name: string;
  date: string;
  status: 'IN_PROGRESS' | 'CLOSED';
  phase: string;
  icebreakerQuestion: string;
  columns: Column[];
  settings: RetroSettings;
  tickets: Ticket[];
  groups: Group[];
  actions: ActionItem[];
  happiness: Record<string, number>;
  roti: Record<string, number>;
  finishedUsers: string[]; // List of user IDs who clicked "I'm finished"
}

export interface Team {
  id: string;
  name: string;
  passwordHash: string;
  members: User[];
  customTemplates: { name: string; cols: Column[] }[];
  retrospectives: RetroSession[];
  globalActions: ActionItem[];
}

export interface Template {
    name: string;
    cols: Column[];
}
