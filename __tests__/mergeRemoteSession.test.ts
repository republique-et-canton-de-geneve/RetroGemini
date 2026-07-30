import { describe, it, expect } from 'vitest';
import {
  mergeRemoteRetroSession,
  mergeRemoteHealthCheckSession,
  PendingCreation
} from '../components/session/mergeRemoteSession';
import { RetroSession, HealthCheckSession, Ticket, ActionItem } from '../types';

const ME = 'me';
const OTHER = 'other';

const baseSettings = () => ({
  isAnonymous: false,
  maxVotes: 3,
  oneVotePerTicket: false,
  revealBrainstorm: true,
  revealHappiness: false,
  revealRoti: false,
  timerSeconds: 0,
  timerRunning: false,
  timerInitial: 0
});

const makeTicket = (id: string, overrides: Partial<Ticket> = {}): Ticket => ({
  id,
  colId: 'col-1',
  text: `ticket ${id}`,
  authorId: ME,
  groupId: null,
  votes: [],
  ...overrides
});

const makeAction = (id: string, overrides: Partial<ActionItem> = {}): ActionItem => ({
  id,
  text: `action ${id}`,
  assigneeId: null,
  done: false,
  type: 'proposal',
  proposalVotes: {},
  ...overrides
});

const makeSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 's1',
  teamId: 't1',
  name: 'Retro',
  date: '2026-01-01',
  status: 'IN_PROGRESS',
  phase: 'VOTE',
  participants: [],
  icebreakerQuestion: 'q',
  columns: [],
  settings: baseSettings(),
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
});

const ctx = (overrides = {}) => ({
  currentUserId: ME,
  preserveIcebreaker: false,
  editingTicketId: null as string | null,
  editingGroupId: null as string | null,
  now: 1_000_000,
  ...overrides
});

const noPending = () => new Map<string, PendingCreation>();

describe('mergeRemoteRetroSession', () => {
  it('returns the incoming session untouched when there is no previous state', () => {
    const incoming = makeSession();
    const { merged, divergent } = mergeRemoteRetroSession(incoming, null, ctx(), noPending());
    expect(merged).toBe(incoming);
    expect(divergent).toBe(false);
  });

  it('preserves own happiness and roti and flags divergence when the server lost them', () => {
    const incoming = makeSession({ happiness: { [OTHER]: 2 }, roti: {} });
    const prev = makeSession({ happiness: { [ME]: 4, [OTHER]: 1 }, roti: { [ME]: 5 } });
    const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), noPending());
    expect(merged.happiness).toEqual({ [OTHER]: 2, [ME]: 4 });
    expect(merged.roti).toEqual({ [ME]: 5 });
    expect(divergent).toBe(true);
  });

  it('does not flag divergence when the incoming state already matches own data', () => {
    const incoming = makeSession({ happiness: { [ME]: 4 }, roti: { [ME]: 5 } });
    const prev = makeSession({ happiness: { [ME]: 4 }, roti: { [ME]: 5 } });
    const { divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), noPending());
    expect(divergent).toBe(false);
  });

  it('preserves own votes on tickets and groups, keeping other users votes from the server', () => {
    const incoming = makeSession({
      tickets: [makeTicket('t1', { votes: [OTHER, OTHER] })],
      groups: [{ id: 'g1', title: 'G', colId: 'col-1', votes: [OTHER] }]
    });
    const prev = makeSession({
      tickets: [makeTicket('t1', { votes: [ME, ME] })],
      groups: [{ id: 'g1', title: 'G', colId: 'col-1', votes: [ME] }]
    });
    const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), noPending());
    expect(merged.tickets[0].votes.filter(v => v === OTHER)).toHaveLength(2);
    expect(merged.tickets[0].votes.filter(v => v === ME)).toHaveLength(2);
    expect(merged.groups[0].votes).toContain(ME);
    expect(merged.groups[0].votes).toContain(OTHER);
    expect(divergent).toBe(true);
  });

  it('lets the server win on votes when oneVotePerTicket is on or maxVotes changed', () => {
    const incomingOneVote = makeSession({
      settings: { ...baseSettings(), oneVotePerTicket: true },
      tickets: [makeTicket('t1', { votes: [] })]
    });
    const prevOneVote = makeSession({
      settings: { ...baseSettings(), oneVotePerTicket: true },
      tickets: [makeTicket('t1', { votes: [ME] })]
    });
    const oneVote = mergeRemoteRetroSession(incomingOneVote, prevOneVote, ctx(), noPending());
    expect(oneVote.merged.tickets[0].votes).toEqual([]);
    expect(oneVote.divergent).toBe(false);

    const incomingMaxChanged = makeSession({
      settings: { ...baseSettings(), maxVotes: 1 },
      tickets: [makeTicket('t1', { votes: [] })]
    });
    const prevMaxChanged = makeSession({ tickets: [makeTicket('t1', { votes: [ME] })] });
    const maxChanged = mergeRemoteRetroSession(incomingMaxChanged, prevMaxChanged, ctx(), noPending());
    expect(maxChanged.merged.tickets[0].votes).toEqual([]);
    expect(maxChanged.divergent).toBe(false);
  });

  it('preserves own votes on action proposals', () => {
    const incoming = makeSession({
      actions: [makeAction('a1', { proposalVotes: { [OTHER]: 'down' } })]
    });
    const prev = makeSession({
      actions: [makeAction('a1', { proposalVotes: { [ME]: 'up', [OTHER]: 'down' } })]
    });
    const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), noPending());
    expect(merged.actions[0].proposalVotes).toEqual({ [OTHER]: 'down', [ME]: 'up' });
    expect(divergent).toBe(true);
  });

  it('re-injects a pending ticket the server does not know yet and confirms it once it appears', () => {
    const myTicket = makeTicket('t-new');
    const pending = new Map<string, PendingCreation>([
      ['t-new', { kind: 'ticket', expiresAt: 2_000_000 }]
    ]);

    const incoming = makeSession({ tickets: [makeTicket('t-other', { authorId: OTHER })] });
    const prev = makeSession({ tickets: [makeTicket('t-other', { authorId: OTHER }), myTicket] });
    const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), pending);
    expect(merged.tickets.map(t => t.id)).toContain('t-new');
    expect(divergent).toBe(true);
    expect(pending.has('t-new')).toBe(true); // still unconfirmed

    // Once an authoritative state contains it, the pending entry is confirmed.
    const confirming = makeSession({ tickets: [myTicket] });
    const second = mergeRemoteRetroSession(confirming, merged, ctx(), pending);
    expect(pending.has('t-new')).toBe(false);
    expect(second.divergent).toBe(false);
  });

  it('re-injects a pending action proposal', () => {
    const myProposal = makeAction('a-new');
    const pending = new Map<string, PendingCreation>([
      ['a-new', { kind: 'action', expiresAt: 2_000_000 }]
    ]);
    const incoming = makeSession({ actions: [] });
    const prev = makeSession({ actions: [myProposal] });
    const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), pending);
    expect(merged.actions.map(a => a.id)).toContain('a-new');
    expect(divergent).toBe(true);
  });

  it('drops expired pending creations instead of re-injecting them', () => {
    const pending = new Map<string, PendingCreation>([
      ['t-old', { kind: 'ticket', expiresAt: 500_000 }]
    ]);
    const incoming = makeSession({ tickets: [] });
    const prev = makeSession({ tickets: [makeTicket('t-old')] });
    const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx({ now: 1_000_000 }), pending);
    expect(merged.tickets).toHaveLength(0);
    expect(divergent).toBe(false);
    expect(pending.has('t-old')).toBe(false);
  });

  it('re-adds own finished flag only while the phase is unchanged', () => {
    const incomingSamePhase = makeSession({ finishedUsers: [OTHER] });
    const prev = makeSession({ finishedUsers: [ME, OTHER] });
    const samePhase = mergeRemoteRetroSession(incomingSamePhase, prev, ctx(), noPending());
    expect(samePhase.merged.finishedUsers).toContain(ME);
    expect(samePhase.divergent).toBe(true);

    // Advancing the phase legitimately clears finishedUsers: server wins.
    const incomingNewPhase = makeSession({ phase: 'DISCUSS', finishedUsers: [] });
    const newPhase = mergeRemoteRetroSession(incomingNewPhase, prev, ctx(), noPending());
    expect(newPhase.merged.finishedUsers).not.toContain(ME);
    expect(newPhase.divergent).toBe(false);
  });

  it('preserves own next-topic votes symmetrically (adds and removals)', () => {
    const incoming = makeSession({
      discussionNextTopicVotes: { topicA: [OTHER], topicB: [ME, OTHER] }
    });
    const prev = makeSession({
      discussionNextTopicVotes: { topicA: [ME, OTHER], topicB: [OTHER] }
    });
    const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), noPending());
    expect(merged.discussionNextTopicVotes?.topicA).toContain(ME);
    expect(merged.discussionNextTopicVotes?.topicB).not.toContain(ME);
    expect(divergent).toBe(true);
  });

  it('keeps the ticket text being edited without flagging divergence', () => {
    const incoming = makeSession({ tickets: [makeTicket('t1', { text: 'server text' })] });
    const prev = makeSession({ tickets: [makeTicket('t1', { text: 'my draft' })] });
    const { merged, divergent } = mergeRemoteRetroSession(
      incoming,
      prev,
      ctx({ editingTicketId: 't1' }),
      noPending()
    );
    expect(merged.tickets[0].text).toBe('my draft');
    expect(divergent).toBe(false);
  });

  it('does not mutate the incoming session object', () => {
    const incoming = makeSession({
      tickets: [makeTicket('t1', { votes: [OTHER] })],
      happiness: { [OTHER]: 3 }
    });
    const snapshot = JSON.parse(JSON.stringify(incoming));
    const prev = makeSession({
      tickets: [makeTicket('t1', { votes: [ME] })],
      happiness: { [ME]: 4 }
    });
    mergeRemoteRetroSession(incoming, prev, ctx(), noPending());
    expect(incoming).toEqual(snapshot);
  });

  // Regression: a healing state from a lost write race (e.g. the snapshot
  // init emitted right after the phase change) must not erase the open /
  // history action snapshots — otherwise toggling an action "done" later
  // seeds a snapshot containing only that action and the rest disappear.
  it('re-adds openActionsSnapshot entries the incoming state lost and flags divergence', () => {
    const prev = makeSession({
      openActionsSnapshot: [
        makeAction('a1', { type: 'new', done: true }),
        makeAction('a2', { type: 'new' }),
        makeAction('a3', { type: 'new' })
      ]
    });

    // Incoming state lost the snapshot entirely (healed phase-change blob).
    const incomingWithout = makeSession();
    const lostAll = mergeRemoteRetroSession(incomingWithout, prev, ctx(), noPending());
    expect(lostAll.merged.openActionsSnapshot?.map(a => a.id)).toEqual(['a1', 'a2', 'a3']);
    expect(lostAll.divergent).toBe(true);

    // Incoming state degenerated to only the toggled action.
    const incomingDegenerate = makeSession({
      openActionsSnapshot: [makeAction('a1', { type: 'new', done: true })]
    });
    const lostSome = mergeRemoteRetroSession(incomingDegenerate, prev, ctx(), noPending());
    expect(lostSome.merged.openActionsSnapshot?.map(a => a.id).sort()).toEqual(['a1', 'a2', 'a3']);
    expect(lostSome.divergent).toBe(true);
  });

  // Regression (audit H14): sending invites writes `invitedUsers` through the
  // ordinary update-session path, so it can lose the CAS race against a
  // concurrent timer or roster write. Without a merge the healed state erases
  // the invitee list and the "Invited · waiting to join" section never appears
  // — the facilitator loses the record of who was invited, with no retry.
  it('re-adds invitedUsers the incoming state lost and flags divergence', () => {
    const prev = makeSession({
      invitedUsers: [
        { id: 'u1', name: 'zoe.waiting', email: 'zoe.waiting@example.com', invitedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'u2', name: 'ada', email: 'ada@example.com' }
      ]
    });

    // Healed blob from a write race: the invite write never landed.
    const lostAll = mergeRemoteRetroSession(makeSession(), prev, ctx(), noPending());
    expect(lostAll.merged.invitedUsers?.map(u => u.id)).toEqual(['u1', 'u2']);
    expect(lostAll.divergent).toBe(true);

    // Only part of the batch landed.
    const incomingPartial = makeSession({
      invitedUsers: [{ id: 'u1', name: 'zoe.waiting', email: 'zoe.waiting@example.com' }]
    });
    const lostSome = mergeRemoteRetroSession(incomingPartial, prev, ctx(), noPending());
    expect(lostSome.merged.invitedUsers?.map(u => u.id).sort()).toEqual(['u1', 'u2']);
    expect(lostSome.divergent).toBe(true);
  });

  it('lets the incoming invitee values win and stays silent when nothing was lost', () => {
    const prev = makeSession({
      invitedUsers: [{ id: 'u1', name: 'zoe', email: 'zoe@example.com' }]
    });
    // Another client renamed the invitee (invites upsert the team member), so
    // the server's value is authoritative and this is not a divergence.
    const incoming = makeSession({
      invitedUsers: [{ id: 'u1', name: 'Zoe Waiting', email: 'zoe@example.com' }]
    });

    const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), noPending());

    expect(merged.invitedUsers).toEqual([{ id: 'u1', name: 'Zoe Waiting', email: 'zoe@example.com' }]);
    expect(divergent).toBe(false);
  });

  it('leaves invitedUsers untouched when neither side has any', () => {
    const { merged, divergent } = mergeRemoteRetroSession(makeSession(), makeSession(), ctx(), noPending());

    expect(merged.invitedUsers).toBeUndefined();
    expect(divergent).toBe(false);
  });

  it('lets incoming snapshot entry values win and stays silent when nothing was lost', () => {
    const prev = makeSession({
      openActionsSnapshot: [makeAction('a1', { type: 'new' }), makeAction('a2', { type: 'new' })]
    });
    const incoming = makeSession({
      openActionsSnapshot: [
        makeAction('a1', { type: 'new', done: true, assigneeId: OTHER }),
        makeAction('a2', { type: 'new' })
      ]
    });
    const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), noPending());
    expect(merged.openActionsSnapshot?.find(a => a.id === 'a1')?.done).toBe(true);
    expect(merged.openActionsSnapshot?.find(a => a.id === 'a1')?.assigneeId).toBe(OTHER);
    expect(divergent).toBe(false);
  });

  it('re-adds historyActionsSnapshot entries the incoming state lost and flags divergence', () => {
    const prev = makeSession({
      phase: 'REVIEW',
      historyActionsSnapshot: [makeAction('h1', { type: 'new' }), makeAction('h2', { type: 'new' })]
    });
    const incoming = makeSession({
      phase: 'REVIEW',
      historyActionsSnapshot: [makeAction('h1', { type: 'new', done: true })]
    });
    const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), noPending());
    expect(merged.historyActionsSnapshot?.map(a => a.id).sort()).toEqual(['h1', 'h2']);
    expect(merged.historyActionsSnapshot?.find(a => a.id === 'h1')?.done).toBe(true);
    expect(divergent).toBe(true);
  });
});

describe('mergeRemoteHealthCheckSession', () => {
  const makeHc = (overrides: Partial<HealthCheckSession> = {}): HealthCheckSession => ({
    id: 'h1',
    teamId: 't1',
    name: 'HC',
    date: '2026-01-01',
    status: 'IN_PROGRESS',
    phase: 'SURVEY',
    templateId: 'tpl',
    templateName: 'Default',
    dimensions: [],
    participants: [],
    settings: { isAnonymous: false, revealRoti: false },
    ratings: {},
    actions: [],
    roti: {},
    finishedUsers: [],
    ...overrides
  });

  it('preserves own ratings and roti and reports divergence when the server lost them', () => {
    const incoming = makeHc({ ratings: { [OTHER]: { d1: { rating: 2 } } }, roti: {} });
    const prev = makeHc({
      ratings: { [ME]: { d1: { rating: 4, comment: 'ok' } } },
      roti: { [ME]: 3 }
    });
    const { merged, divergent } = mergeRemoteHealthCheckSession(incoming, prev, { currentUserId: ME });
    expect(merged.ratings[ME]).toEqual({ d1: { rating: 4, comment: 'ok' } });
    expect(merged.ratings[OTHER]).toEqual({ d1: { rating: 2 } });
    expect(merged.roti[ME]).toBe(3);
    expect(divergent).toBe(true);
  });

  it('re-adds own finished flag only while the phase is unchanged', () => {
    const prev = makeHc({ finishedUsers: [ME] });
    const samePhase = mergeRemoteHealthCheckSession(makeHc({ finishedUsers: [] }), prev, { currentUserId: ME });
    expect(samePhase.merged.finishedUsers).toContain(ME);
    expect(samePhase.divergent).toBe(true);

    const newPhase = mergeRemoteHealthCheckSession(
      makeHc({ phase: 'DISCUSS', finishedUsers: [] }),
      prev,
      { currentUserId: ME }
    );
    expect(newPhase.merged.finishedUsers).not.toContain(ME);
    expect(newPhase.divergent).toBe(false);
  });

  it('does not flag divergence when own data already matches', () => {
    const incoming = makeHc({ ratings: { [ME]: { d1: { rating: 4 } } }, roti: { [ME]: 3 } });
    const prev = makeHc({ ratings: { [ME]: { d1: { rating: 4 } } }, roti: { [ME]: 3 } });
    const { divergent } = mergeRemoteHealthCheckSession(incoming, prev, { currentUserId: ME });
    expect(divergent).toBe(false);
  });

  it('preserves own votes on health check action proposals', () => {
    const incoming = makeHc({ actions: [makeAction('a1', { proposalVotes: { [OTHER]: 'up' } })] });
    const prev = makeHc({ actions: [makeAction('a1', { proposalVotes: { [ME]: 'down' } })] });
    const { merged, divergent } = mergeRemoteHealthCheckSession(incoming, prev, { currentUserId: ME });
    expect(merged.actions[0].proposalVotes).toEqual({ [OTHER]: 'up', [ME]: 'down' });
    expect(divergent).toBe(true);
  });
});
