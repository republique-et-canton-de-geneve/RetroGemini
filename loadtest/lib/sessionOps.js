// Pure builders and mutators for the simulated retro session blob.
//
// Every mutator is IDEMPOTENT (applying it twice yields the same state) and
// keyed by stable ids. This matters because the load-test client retries an
// operation on a fresh authoritative snapshot whenever its optimistic write
// loses the compare-and-swap race, and an idempotent re-apply can never
// produce duplicates.
//
// The shapes mirror types.ts (RetroSession, Ticket, Group, ActionItem) so the
// server-side session guard and the real front-end see indistinguishable blobs.

const DEFAULT_COLUMNS = [
  {
    id: 'col-well',
    title: 'What Went Well',
    color: 'bg-emerald-500',
    border: 'border-emerald-500',
    icon: 'sentiment_satisfied',
    text: 'text-emerald-700',
    ring: 'ring-emerald-300'
  },
  {
    id: 'col-improve',
    title: 'To Improve',
    color: 'bg-rose-500',
    border: 'border-rose-500',
    icon: 'sentiment_dissatisfied',
    text: 'text-rose-700',
    ring: 'ring-rose-300'
  },
  {
    id: 'col-ideas',
    title: 'Ideas',
    color: 'bg-amber-500',
    border: 'border-amber-500',
    icon: 'lightbulb',
    text: 'text-amber-700',
    ring: 'ring-amber-300'
  }
];

const buildInitialSession = ({ sessionId, teamId, name, maxVotes }) => ({
  id: sessionId,
  teamId,
  name,
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'ICEBREAKER',
  participants: [],
  discussionFocusId: null,
  icebreakerQuestion: 'If your last sprint were a weather forecast, what would it be?',
  columns: DEFAULT_COLUMNS.map(col => ({ ...col })),
  settings: {
    isAnonymous: false,
    maxVotes,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  autoFinishedUsers: []
});

const ensureParticipant = (session, user) => {
  if (!Array.isArray(session.participants)) session.participants = [];
  if (!session.participants.some(p => p.id === user.id)) {
    session.participants.push({ ...user });
  }
};

const setHappiness = (session, userId, score) => {
  if (!session.happiness) session.happiness = {};
  session.happiness[userId] = score;
};

const setRoti = (session, userId, score) => {
  if (!session.roti) session.roti = {};
  session.roti[userId] = score;
};

const addTicket = (session, { id, colId, text, authorId }) => {
  if (session.tickets.some(t => t.id === id)) return;
  session.tickets.push({ id, colId, text, authorId, groupId: null, votes: [] });
};

const markFinished = (session, userId) => {
  if (!Array.isArray(session.finishedUsers)) session.finishedUsers = [];
  if (!session.finishedUsers.includes(userId)) {
    session.finishedUsers.push(userId);
  }
};

const createGroup = (session, { id, title, colId, ticketIds }) => {
  if (!session.groups.some(g => g.id === id)) {
    session.groups.push({ id, title, colId, votes: [], anchorTicketId: ticketIds[0] });
  }
  for (const ticketId of ticketIds) {
    const ticket = session.tickets.find(t => t.id === ticketId);
    if (ticket) ticket.groupId = id;
  }
};

// A vote target is either a ticket or a group; both carry a `votes` array of
// user ids where multiplicity encodes multiple votes by the same user.
const findTarget = (session, targetId) =>
  session.groups.find(g => g.id === targetId) ?? session.tickets.find(t => t.id === targetId);

const countOwnVotes = (session, targetId, userId) => {
  const target = findTarget(session, targetId);
  if (!target) return 0;
  return target.votes.filter(v => v === userId).length;
};

// Set the caller's vote multiplicity on one target to an exact count, leaving
// every other user's votes untouched. Mirrors how the real client only ever
// adds/removes its own entries, and stays idempotent for safe retries.
const setOwnVotes = (session, targetId, userId, count) => {
  const target = findTarget(session, targetId);
  if (!target) return;
  const others = target.votes.filter(v => v !== userId);
  target.votes = [...others, ...Array(count).fill(userId)];
};

const addProposal = (session, { id, text, authorId }) => {
  if (session.actions.some(a => a.id === id)) return;
  session.actions.push({
    id,
    text,
    assigneeId: authorId,
    done: false,
    type: 'proposal',
    proposalVotes: {},
    createdAt: new Date().toISOString()
  });
};

const setProposalVote = (session, proposalId, userId, value) => {
  const action = session.actions.find(a => a.id === proposalId);
  if (!action) return;
  if (!action.proposalVotes) action.proposalVotes = {};
  action.proposalVotes[userId] = value;
};

const decideProposal = (session, proposalId, decision) => {
  const action = session.actions.find(a => a.id === proposalId);
  if (!action) return;
  if (decision === 'accept') {
    action.type = 'new';
    action.rejected = false;
  } else {
    action.rejected = true;
  }
};

const setDiscussionFocus = (session, targetId) => {
  session.discussionFocusId = targetId;
};

const setReviewSummary = (session, text) => {
  session.reviewSummary = text;
};

// Mirrors the real client's phase navigation: advancing the phase clears the
// finished lists and resets the timer runtime fields.
const setPhase = (session, phase) => {
  session.phase = phase;
  session.finishedUsers = [];
  session.autoFinishedUsers = [];
  session.settings.timerRunning = false;
  session.settings.timerStartedAt = undefined;
  session.settings.timerAcknowledged = false;
};

const closeSession = (session) => {
  session.status = 'CLOSED';
};

export {
  DEFAULT_COLUMNS,
  buildInitialSession,
  ensureParticipant,
  setHappiness,
  setRoti,
  addTicket,
  markFinished,
  createGroup,
  findTarget,
  countOwnVotes,
  setOwnVotes,
  addProposal,
  setProposalVote,
  decideProposal,
  setDiscussionFocus,
  setReviewSummary,
  setPhase,
  closeSession
};
