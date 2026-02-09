
export type Role = 'facilitator' | 'participant';

export interface User {
  id: string;
  name: string;
  color: string;
  role: Role;
  email?: string;
  inviteToken?: string;
  joinedBefore?: boolean;
}

export interface Column {
  id: string;
  title: string;
  color: string;
  border: string;
  icon: string;
  text: string;
  ring: string;
  customColor?: string; // Optional hex color (e.g., '#6366F1') - overrides Tailwind classes
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
  contextText?: string;
}

export interface RetroSettings {
  isAnonymous: boolean;
  maxVotes: number;
  oneVotePerTicket: boolean;
  revealBrainstorm: boolean;
  revealHappiness: boolean;
  revealRoti: boolean;
  timerSeconds: number; // Remaining time (for display, calculated locally)
  timerRunning: boolean;
  timerInitial: number;
  timerStartedAt?: number; // Unix timestamp when timer was started (for sync)
  timerAcknowledged?: boolean;
  participantsPanelCollapsed?: boolean; // Whether participants panel is collapsed
  colorBy?: 'author' | 'topic'; // Color post-its by author or by topic/column
  showParticipantVotes?: boolean; // Show individual vote types in proposal vote tooltip
}

export interface RetroSession {
  id: string;
  teamId: string;
  name: string;
  date: string;
  status: 'IN_PROGRESS' | 'CLOSED';
  phase: string;
  participants?: User[];
  discussionFocusId?: string | null;
  discussionNextTopicVotes?: Record<string, string[]>; // topic ID -> array of user IDs who voted next
  icebreakerQuestion: string;
  columns: Column[];
  settings: RetroSettings;
  tickets: Ticket[];
  groups: Group[];
  actions: ActionItem[];
  openActionsSnapshot?: ActionItem[];
  historyActionsSnapshot?: ActionItem[];
  happiness: Record<string, number>;
  roti: Record<string, number>;
  finishedUsers: string[]; // List of user IDs who clicked "I'm finished"
  autoFinishedUsers?: string[]; // Tracks which users were auto-finished due to using all votes
}

export interface FeedbackComment {
  id: string;
  feedbackId: string;
  teamId: string;
  teamName: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string; // ISO date
  isAdmin?: boolean; // true if comment is from super admin
}

export interface TeamFeedback {
  id: string;
  teamId: string;
  teamName: string; // For display in super admin
  type: 'bug' | 'feature';
  title: string;
  description: string;
  images?: string[]; // Base64 encoded images
  submittedBy: string; // Facilitator user ID
  submittedByName: string; // Name for display
  submittedAt: string; // ISO date
  isRead: boolean; // For unread indicator
  status: 'pending' | 'in_progress' | 'resolved' | 'rejected';
  comments?: FeedbackComment[]; // Comments from teams and admins
}

export interface Team {
  id: string;
  name: string;
  passwordHash: string;
  facilitatorEmail?: string; // Email for password recovery (separate from participant emails)
  members: User[];
  archivedMembers?: User[];
  customTemplates: { name: string; cols: Column[] }[];
  retrospectives: RetroSession[];
  globalActions: ActionItem[];
  // Health checks
  healthChecks?: HealthCheckSession[];
  customHealthCheckTemplates?: HealthCheckTemplate[];
  lastConnectionDate?: string;
  // Team feedbacks
  teamFeedbacks?: TeamFeedback[];
}

export interface TeamSummary {
  id: string;
  name: string;
  memberCount: number;
  lastConnectionDate?: string;
}

export interface Template {
    name: string;
    cols: Column[];
}

// ==================== HEALTH CHECK TYPES ====================

export interface HealthCheckDimension {
  id: string;
  name: string;
  goodDescription: string;
  badDescription: string;
}

export interface HealthCheckTemplate {
  id: string;
  name: string;
  dimensions: HealthCheckDimension[];
  isDefault?: boolean;
}

export interface HealthCheckRating {
  odimensionId: string;
  rating: number; // 1-5
  comment?: string;
}

export interface HealthCheckSettings {
  isAnonymous: boolean;
  revealRoti: boolean;
  participantsPanelCollapsed?: boolean; // Whether participants panel is collapsed
}

export interface HealthCheckSession {
  id: string;
  teamId: string;
  name: string;
  date: string;
  status: 'IN_PROGRESS' | 'CLOSED';
  phase: 'SURVEY' | 'DISCUSS' | 'REVIEW' | 'CLOSE';
  templateId: string;
  templateName: string;
  dimensions: HealthCheckDimension[];
  participants?: User[];
  settings: HealthCheckSettings;
  // Ratings: userId -> dimensionId -> { rating, comment }
  ratings: Record<string, Record<string, { rating?: number; comment?: string }>>;
  // Actions created during this session
  actions: ActionItem[];
  // Discussion focus
  discussionFocusId?: string | null;
  // ROTI for close phase
  roti: Record<string, number>;
  // Track who has finished each phase
  finishedUsers: string[];
}

// ==================== ANNOUNCEMENT TYPES ====================

export type AnnouncementType = 'feature' | 'improvement' | 'fix' | 'security' | 'removed';

export interface AnnouncementItem {
  type: AnnouncementType;
  description: string;
}

export interface VersionAnnouncement {
  version: string;
  date: string;
  items: AnnouncementItem[];
}

export interface AppVersion {
  current: string;
  announcements: VersionAnnouncement[];
}

// ==================== GLOBAL SETTINGS ====================

export interface GlobalSettings {
  infoMessage?: string; // Global info message displayed on team selection and dashboard
  adminEmail?: string; // Email address for admin notifications (feedback alerts)
  notifyNewTeam?: boolean; // Send email notification to admin when a new team is created
}

// ==================== ACTIVE SESSIONS (LIVE MONITORING) ====================

export interface ActiveSessionMember {
  id: string;
  name: string;
}

export interface ActiveSession {
  sessionId: string;
  type: 'retrospective' | 'healthcheck';
  teamId: string;
  teamName: string;
  sessionName: string;
  phase: string;
  status: 'IN_PROGRESS' | 'CLOSED';
  participants: ActiveSessionMember[];
  connectedCount: number;
  startedAt?: string;
}

// ==================== SERVER LOGS ====================

export type LogLevel = 'error' | 'warn' | 'info';
export type LogSource = 'postgres' | 'server' | 'socket' | 'email';

export interface ServerLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  details?: string;
}
