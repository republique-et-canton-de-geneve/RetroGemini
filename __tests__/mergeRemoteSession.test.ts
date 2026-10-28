import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  mergeRemoteRetroSession,
  mergeRemoteHealthCheckSession,
  registerOwnRetroChanges,
  registerOwnHealthCheckChanges,
  extendOwnChanges,
  holdOwnStateWhileRefused,
  scheduleSessionResend,
  OwnChangeLedger,
  PendingCreation
} from '../components/session/mergeRemoteSession';
import { RetroSession, HealthCheckSession, Ticket, ActionItem } from '../types';

const ME = 'me';
const OTHER = 'other';
const NOW = 1_000_000;

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

// The own-change ledger a session component would hold. Built the way the
// component builds it — by diffing the state a local update was based on
// against the state it produced — so these tests exercise the registration and
// the merge together: a claim the registrar does not make is a slice the merge
// will not re-apply.
const claiming = (before: RetroSession, after: RetroSession): OwnChangeLedger => {
  const ledger: OwnChangeLedger = new Map();
  registerOwnRetroChanges(ledger, before, after, ME, NOW);
  return ledger;
};

const claimingHc = (before: HealthCheckSession, after: HealthCheckSession): OwnChangeLedger => {
  const ledger: OwnChangeLedger = new Map();
  registerOwnHealthCheckChanges(ledger, before, after, ME, NOW);
  return ledger;
};

// A client with nothing outstanding: every own slice comes from the server.
const noClaims = (): OwnChangeLedger => new Map();

const ctx = (overrides: Record<string, unknown> = {}) => ({
  currentUserId: ME,
  preserveIcebreaker: false,
  editingTicketId: null as string | null,
  editingGroupId: null as string | null,
  ownChanges: noClaims(),
  now: NOW,
  ...overrides
});

const hcCtx = (overrides: Record<string, unknown> = {}) => ({
  currentUserId: ME,
  ownChanges: noClaims(),
  now: NOW,
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
    const beforeMyClicks = makeSession({ happiness: { [OTHER]: 1 }, roti: {} });
    const { merged, divergent } = mergeRemoteRetroSession(
      incoming,
      prev,
      ctx({ ownChanges: claiming(beforeMyClicks, prev) }),
      noPending()
    );
    expect(merged.happiness).toEqual({ [OTHER]: 2, [ME]: 4 });
    expect(merged.roti).toEqual({ [ME]: 5 });
    expect(divergent).toBe(true);
  });

  it('does not flag divergence when the incoming state already matches own data', () => {
    const incoming = makeSession({ happiness: { [ME]: 4 }, roti: { [ME]: 5 } });
    const prev = makeSession({ happiness: { [ME]: 4 }, roti: { [ME]: 5 } });
    const ownChanges = claiming(makeSession(), prev);
    expect(ownChanges.size).toBe(2); // happiness + roti were claimed

    const { divergent } = mergeRemoteRetroSession(incoming, prev, ctx({ ownChanges }), noPending());
    expect(divergent).toBe(false);
    // The server agrees, so the write landed: the claims are spent and cannot
    // make a later broadcast look divergent.
    expect(ownChanges.size).toBe(0);
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
    const beforeMyVotes = makeSession({
      tickets: [makeTicket('t1', { votes: [] })],
      groups: [{ id: 'g1', title: 'G', colId: 'col-1', votes: [] }]
    });
    const { merged, divergent } = mergeRemoteRetroSession(
      incoming,
      prev,
      ctx({ ownChanges: claiming(beforeMyVotes, prev) }),
      noPending()
    );
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
    // Even with the vote claimed as an unconfirmed local write, the vote-model
    // cleanup is authoritative.
    const oneVoteClaims = claiming(
      makeSession({
        settings: { ...baseSettings(), oneVotePerTicket: true },
        tickets: [makeTicket('t1', { votes: [] })]
      }),
      prevOneVote
    );
    const oneVote = mergeRemoteRetroSession(
      incomingOneVote,
      prevOneVote,
      ctx({ ownChanges: oneVoteClaims }),
      noPending()
    );
    expect(oneVote.merged.tickets[0].votes).toEqual([]);
    expect(oneVote.divergent).toBe(false);
    expect(oneVoteClaims.size).toBe(0);

    const incomingMaxChanged = makeSession({
      settings: { ...baseSettings(), maxVotes: 1 },
      tickets: [makeTicket('t1', { votes: [] })]
    });
    const prevMaxChanged = makeSession({ tickets: [makeTicket('t1', { votes: [ME] })] });
    const maxChanged = mergeRemoteRetroSession(
      incomingMaxChanged,
      prevMaxChanged,
      ctx({
        ownChanges: claiming(makeSession({ tickets: [makeTicket('t1', { votes: [] })] }), prevMaxChanged)
      }),
      noPending()
    );
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
    const beforeMyVote = makeSession({
      actions: [makeAction('a1', { proposalVotes: { [OTHER]: 'down' } })]
    });
    const { merged, divergent } = mergeRemoteRetroSession(
      incoming,
      prev,
      ctx({ ownChanges: claiming(beforeMyVote, prev) }),
      noPending()
    );
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

  it('puts a pending ticket written in a column removed meanwhile beside it, never under nothing', () => {
    const column = (id: string) => ({
      id, title: id, color: 'bg-slate-50', border: 'border-slate-300', icon: 'star', text: 'text-slate-700', ring: 'focus:ring-slate-200'
    });
    const pending = () => new Map<string, PendingCreation>([['t-new', { kind: 'ticket', expiresAt: 2_000_000 }]]);
    const written = (colId: string) => makeSession({
      phase: 'BRAINSTORM',
      columns: [column('start'), column('stop'), column('continue')],
      tickets: [makeTicket('t-new', { colId })],
    });
    // The facilitator removed a column while I wrote a card in it
    // (retroGrouping.ts → removeColumn), and the heal does not hold my card.
    const without = (...ids: string[]) =>
      makeSession({ phase: 'BRAINSTORM', columns: ['start', 'stop', 'continue'].filter((id) => !ids.includes(id)).map(column) });

    const middle = mergeRemoteRetroSession(without('stop'), written('stop'), ctx(), pending());
    expect(middle.merged.tickets.find((t) => t.id === 't-new')?.colId).toBe('start');
    expect(middle.divergent).toBe(true);

    // The first column has none before it: the one after it.
    const first = mergeRemoteRetroSession(without('start'), written('start'), ctx(), pending());
    expect(first.merged.tickets.find((t) => t.id === 't-new')?.colId).toBe('stop');

    // Two removed at once: the nearest one left.
    const two = mergeRemoteRetroSession(without('start', 'stop'), written('stop'), ctx(), pending());
    expect(two.merged.tickets.find((t) => t.id === 't-new')?.colId).toBe('continue');

    // A column that still exists keeps its card.
    const kept = mergeRemoteRetroSession(without('stop'), written('continue'), ctx(), pending());
    expect(kept.merged.tickets.find((t) => t.id === 't-new')?.colId).toBe('continue');
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
    const beforeMyClick = makeSession({ finishedUsers: [OTHER] });
    const samePhase = mergeRemoteRetroSession(
      incomingSamePhase,
      prev,
      ctx({ ownChanges: claiming(beforeMyClick, prev) }),
      noPending()
    );
    expect(samePhase.merged.finishedUsers).toContain(ME);
    expect(samePhase.divergent).toBe(true);

    // Advancing the phase legitimately clears finishedUsers: server wins.
    const incomingNewPhase = makeSession({ phase: 'DISCUSS', finishedUsers: [] });
    const phaseClaims = claiming(beforeMyClick, prev);
    const newPhase = mergeRemoteRetroSession(
      incomingNewPhase,
      prev,
      ctx({ ownChanges: phaseClaims }),
      noPending()
    );
    expect(newPhase.merged.finishedUsers).not.toContain(ME);
    expect(newPhase.divergent).toBe(false);
    // The claim cannot survive the phase change and re-assert itself later.
    expect(phaseClaims.size).toBe(0);
  });

  // A locally cleared "I'm finished" that lost the CAS race is re-applied too:
  // the flag is a toggle (returning a vote un-finishes you), so an add-only
  // rule silently put the user back in the finished list.
  it('re-applies a local un-finish the server healed away', () => {
    const prev = makeSession({ finishedUsers: [OTHER] });
    const beforeMyUncheck = makeSession({ finishedUsers: [ME, OTHER] });
    const incoming = makeSession({ finishedUsers: [ME, OTHER] });
    const { merged, divergent } = mergeRemoteRetroSession(
      incoming,
      prev,
      ctx({ ownChanges: claiming(beforeMyUncheck, prev) }),
      noPending()
    );
    expect(merged.finishedUsers).toEqual([OTHER]);
    expect(divergent).toBe(true);
  });

  it('preserves own next-topic votes symmetrically (adds and removals)', () => {
    const incoming = makeSession({
      discussionNextTopicVotes: { topicA: [OTHER], topicB: [ME, OTHER] }
    });
    const prev = makeSession({
      discussionNextTopicVotes: { topicA: [ME, OTHER], topicB: [OTHER] }
    });
    // One local toggle on each topic: added on A, removed on B.
    const beforeMyToggles = makeSession({
      discussionNextTopicVotes: { topicA: [OTHER], topicB: [ME, OTHER] }
    });
    const { merged, divergent } = mergeRemoteRetroSession(
      incoming,
      prev,
      ctx({ ownChanges: claiming(beforeMyToggles, prev) }),
      noPending()
    );
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
    const beforeMyChanges = makeSession({ tickets: [makeTicket('t1', { votes: [] })] });
    mergeRemoteRetroSession(
      incoming,
      prev,
      ctx({ ownChanges: claiming(beforeMyChanges, prev) }),
      noPending()
    );
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

  // --- The own-change ledger gate.
  //
  // A participant who opens the invite link twice is one user id on two
  // clients. Without the gate the browser that did NOT act read the fresh state
  // as its own lost write, undid it and re-sent; the other browser undid that
  // and re-sent; the facilitator watched the counter flicker forever. A client
  // with nothing outstanding must take the server's word for its own data.
  describe('with no unconfirmed local change (a second browser of the same user)', () => {
    it('adopts an own move-on vote made in the other browser instead of undoing it', () => {
      const incoming = makeSession({ discussionNextTopicVotes: { topicA: [ME, OTHER] } });
      const prev = makeSession({ discussionNextTopicVotes: { topicA: [OTHER] } });

      const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), noPending());

      expect(merged.discussionNextTopicVotes?.topicA).toContain(ME);
      expect(divergent).toBe(false); // nothing to re-send: no ping-pong
    });

    it('adopts an own move-on vote REMOVED in the other browser', () => {
      const incoming = makeSession({ discussionNextTopicVotes: { topicA: [OTHER] } });
      const prev = makeSession({ discussionNextTopicVotes: { topicA: [ME, OTHER] } });

      const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), noPending());

      expect(merged.discussionNextTopicVotes?.topicA).not.toContain(ME);
      expect(divergent).toBe(false);
    });

    it('adopts an own impact rating made in the other browser instead of undoing it', () => {
      const incoming = makeSession({ actionImpactVotes: { a1: { [ME]: 3, [OTHER]: 1 } } });
      const prev = makeSession({ actionImpactVotes: { a1: { [OTHER]: 1 } } });

      const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), noPending());

      expect(merged.actionImpactVotes?.a1?.[ME]).toBe(3);
      expect(divergent).toBe(false); // nothing to re-send: no ping-pong
    });

    it('adopts an own impact rating CLEARED in the other browser', () => {
      const incoming = makeSession({ actionImpactVotes: { a1: { [OTHER]: 1 } } });
      const prev = makeSession({ actionImpactVotes: { a1: { [ME]: 3, [OTHER]: 1 } } });

      const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), noPending());

      expect(merged.actionImpactVotes?.a1?.[ME]).toBeUndefined();
      expect(divergent).toBe(false);
    });

    it('adopts own ticket and group votes, happiness, roti, proposal votes and finished flag', () => {
      const incoming = makeSession({
        tickets: [makeTicket('t1', { votes: [ME] })],
        groups: [{ id: 'g1', title: 'G', colId: 'col-1', votes: [ME] }],
        actions: [makeAction('a1', { proposalVotes: { [ME]: 'up' } })],
        happiness: { [ME]: 5 },
        roti: { [ME]: 5 },
        finishedUsers: [ME]
      });
      const prev = makeSession({
        tickets: [makeTicket('t1', { votes: [] })],
        groups: [{ id: 'g1', title: 'G', colId: 'col-1', votes: [] }],
        actions: [makeAction('a1', { proposalVotes: {} })],
        happiness: { [ME]: 1 },
        roti: { [ME]: 1 },
        finishedUsers: []
      });

      const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), noPending());

      expect(merged.tickets[0].votes).toEqual([ME]);
      expect(merged.groups[0].votes).toEqual([ME]);
      expect(merged.actions[0].proposalVotes).toEqual({ [ME]: 'up' });
      expect(merged.happiness[ME]).toBe(5);
      expect(merged.roti[ME]).toBe(5);
      expect(merged.finishedUsers).toEqual([ME]);
      expect(divergent).toBe(false);
    });
  });

  it('claims only the slices the local update actually changed', () => {
    const before = makeSession({
      tickets: [makeTicket('t1', { votes: [OTHER] }), makeTicket('t2', { votes: [ME] })],
      happiness: { [ME]: 3 },
      discussionNextTopicVotes: { topicA: [OTHER] }
    });
    const after = makeSession({
      // t1 gains my vote; t2 is untouched; another user's vote is not mine.
      tickets: [makeTicket('t1', { votes: [OTHER, ME] }), makeTicket('t2', { votes: [ME, OTHER] })],
      happiness: { [ME]: 3, [OTHER]: 5 },
      discussionNextTopicVotes: { topicA: [OTHER] }
    });

    const ledger: OwnChangeLedger = new Map();
    registerOwnRetroChanges(ledger, before, after, ME, NOW);

    expect([...ledger.keys()]).toEqual(['ticketVotes:t1']);
  });

  it('claims the impact slice per action, and only where my own vote moved', () => {
    const before = makeSession({
      actionImpactVotes: { a1: { [ME]: 1 }, a2: { [OTHER]: 2 } }
    });
    const after = makeSession({
      // a1: my vote changed. a2: someone else's vote appeared, not mine.
      actionImpactVotes: { a1: { [ME]: 3 }, a2: { [OTHER]: 2, [`${OTHER}-2`]: 1 } }
    });

    const ledger: OwnChangeLedger = new Map();
    registerOwnRetroChanges(ledger, before, after, ME, NOW);

    expect([...ledger.keys()]).toEqual(['actionImpact:a1']);
  });

  it('re-applies an own impact rating the server healed away while the claim is live', () => {
    const prev = makeSession({ actionImpactVotes: { a1: { [ME]: 3, [OTHER]: 1 } } });
    const incoming = makeSession({ actionImpactVotes: { a1: { [OTHER]: 1 } } });
    const ownChanges = claiming(makeSession({ actionImpactVotes: { a1: { [OTHER]: 1 } } }), prev);

    const { merged, divergent } = mergeRemoteRetroSession(
      incoming,
      prev,
      ctx({ ownChanges }),
      noPending()
    );

    expect(merged.actionImpactVotes?.a1).toEqual({ [ME]: 3, [OTHER]: 1 });
    expect(divergent).toBe(true); // re-sent, so the server converges to it
  });

  it('drops the impact claim as soon as the server reports the same vote', () => {
    const prev = makeSession({ actionImpactVotes: { a1: { [ME]: 3 } } });
    const incoming = makeSession({ actionImpactVotes: { a1: { [ME]: 3, [OTHER]: 1 } } });
    const ownChanges = claiming(makeSession({ actionImpactVotes: { a1: {} } }), prev);
    expect(ownChanges.size).toBe(1);

    const { merged, divergent } = mergeRemoteRetroSession(
      incoming,
      prev,
      ctx({ ownChanges }),
      noPending()
    );

    expect(merged.actionImpactVotes?.a1).toEqual({ [ME]: 3, [OTHER]: 1 });
    expect(divergent).toBe(false);
    expect(ownChanges.size).toBe(0);
  });

  it('stops re-applying an own change once its claim expires', () => {
    const prev = makeSession({ discussionNextTopicVotes: { topicA: [ME] } });
    const incoming = makeSession({ discussionNextTopicVotes: { topicA: [] } });
    const ownChanges = claiming(makeSession({ discussionNextTopicVotes: { topicA: [] } }), prev);
    expect(ownChanges.size).toBe(1);

    // 60s TTL: a claim that can never be confirmed must not keep a client
    // re-sending forever.
    const { merged, divergent } = mergeRemoteRetroSession(
      incoming,
      prev,
      ctx({ ownChanges, now: NOW + 60_001 }),
      noPending()
    );

    expect(merged.discussionNextTopicVotes?.topicA).not.toContain(ME);
    expect(divergent).toBe(false);
    expect(ownChanges.size).toBe(0);
  });

  // Regression (Codex review on PR #456): the TTL bounds how long an
  // unconfirmable claim keeps re-asserting itself, and nothing is re-asserted
  // while the client is receiving nothing. Editing is paused for the whole
  // disconnect, so a claim held across it describes a write whose fate the
  // re-join is about to settle — and letting wall-clock time burn it drops the
  // user's edit exactly as the re-join snapshot overwrites it.
  it('does not let a claim age out while the client is offline', () => {
    const prev = makeSession({ discussionNextTopicVotes: { topicA: [ME] } });
    const incoming = makeSession({ discussionNextTopicVotes: { topicA: [] } });
    const ownChanges = claiming(makeSession({ discussionNextTopicVotes: { topicA: [] } }), prev);

    const offlineMs = 5 * 60_000; // a slow reconnect, well past the 60s TTL
    extendOwnChanges(ownChanges, offlineMs);

    const { merged, divergent } = mergeRemoteRetroSession(
      incoming,
      prev,
      ctx({ ownChanges, now: NOW + offlineMs + 1_000 }),
      noPending()
    );

    expect(merged.discussionNextTopicVotes?.topicA).toContain(ME);
    expect(divergent).toBe(true);
  });

  it('ignores a non-positive offline span', () => {
    const prev = makeSession({ roti: { [ME]: 4 } });
    const ownChanges = claiming(makeSession(), prev);
    const before = [...ownChanges.values()].map(c => c.expiresAt);

    extendOwnChanges(ownChanges, 0);
    extendOwnChanges(ownChanges, -1_000);
    extendOwnChanges(ownChanges, Number.NaN);

    expect([...ownChanges.values()].map(c => c.expiresAt)).toEqual(before);
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
    const { merged, divergent } = mergeRemoteHealthCheckSession(
      incoming,
      prev,
      hcCtx({ ownChanges: claimingHc(makeHc(), prev) }),
      noPending()
    );
    expect(merged.ratings[ME]).toEqual({ d1: { rating: 4, comment: 'ok' } });
    expect(merged.ratings[OTHER]).toEqual({ d1: { rating: 2 } });
    expect(merged.roti[ME]).toBe(3);
    expect(divergent).toBe(true);
  });

  it('re-adds own finished flag only while the phase is unchanged', () => {
    const prev = makeHc({ finishedUsers: [ME] });
    const samePhase = mergeRemoteHealthCheckSession(
      makeHc({ finishedUsers: [] }),
      prev,
      hcCtx({ ownChanges: claimingHc(makeHc(), prev) }),
      noPending()
    );
    expect(samePhase.merged.finishedUsers).toContain(ME);
    expect(samePhase.divergent).toBe(true);

    const newPhase = mergeRemoteHealthCheckSession(
      makeHc({ phase: 'DISCUSS', finishedUsers: [] }),
      prev,
      hcCtx({ ownChanges: claimingHc(makeHc(), prev) }),
      noPending()
    );
    expect(newPhase.merged.finishedUsers).not.toContain(ME);
    expect(newPhase.divergent).toBe(false);
  });

  it('does not flag divergence when own data already matches', () => {
    const incoming = makeHc({ ratings: { [ME]: { d1: { rating: 4 } } }, roti: { [ME]: 3 } });
    const prev = makeHc({ ratings: { [ME]: { d1: { rating: 4 } } }, roti: { [ME]: 3 } });
    const ownChanges = claimingHc(makeHc(), prev);
    const { divergent } = mergeRemoteHealthCheckSession(incoming, prev, hcCtx({ ownChanges }), noPending());
    expect(divergent).toBe(false);
    expect(ownChanges.size).toBe(0);
  });

  it('preserves own votes on health check action proposals', () => {
    const incoming = makeHc({ actions: [makeAction('a1', { proposalVotes: { [OTHER]: 'up' } })] });
    const prev = makeHc({ actions: [makeAction('a1', { proposalVotes: { [ME]: 'down' } })] });
    const beforeMyVote = makeHc({ actions: [makeAction('a1', { proposalVotes: {} })] });
    const { merged, divergent } = mergeRemoteHealthCheckSession(
      incoming,
      prev,
      hcCtx({ ownChanges: claimingHc(beforeMyVote, prev) }),
      noPending()
    );
    expect(merged.actions[0].proposalVotes).toEqual({ [OTHER]: 'up', [ME]: 'down' });
    expect(divergent).toBe(true);
  });

  // The two-browser case, health-check side: a client with nothing outstanding
  // takes the server's word for its own ratings instead of re-asserting the
  // stale ones it happens to hold.
  it('adopts own ratings from the server when this client has no unconfirmed change', () => {
    const incoming = makeHc({ ratings: { [ME]: { d1: { rating: 5 } } } });
    const prev = makeHc({ ratings: { [ME]: { d1: { rating: 2 } } } });
    const { merged, divergent } = mergeRemoteHealthCheckSession(incoming, prev, hcCtx(), noPending());
    expect(merged.ratings[ME]).toEqual({ d1: { rating: 5 } });
    expect(divergent).toBe(false);
  });

  it('claims one rating per dimension, so rating d2 does not re-assert a stale d1', () => {
    const prev = makeHc({ ratings: { [ME]: { d1: { rating: 2 }, d2: { rating: 4 } } } });
    // Only d2 was just rated locally; d1 has been changed by the other browser.
    const ownChanges = claimingHc(makeHc({ ratings: { [ME]: { d1: { rating: 2 } } } }), prev);
    const incoming = makeHc({ ratings: { [ME]: { d1: { rating: 5 } } } });

    const { merged, divergent } = mergeRemoteHealthCheckSession(incoming, prev, hcCtx({ ownChanges }), noPending());

    expect(merged.ratings[ME].d1).toEqual({ rating: 5 }); // server wins, unclaimed
    expect(merged.ratings[ME].d2).toEqual({ rating: 4 }); // re-applied, claimed
    expect(divergent).toBe(true);
  });

  // Review finding C on the incident ISS branch, the same class as the
  // incident itself. A health-check participant proposes actions (Discuss, and
  // the follow-ups in Close), and the health-check merge rebuilt `actions` from
  // the incoming state alone: a proposal whose write lost a race was healed
  // away and never re-sent, while the input it was typed into had already been
  // cleared. The retro has held its own creations since it had cards; the
  // health check now holds them by the same rule.
  describe('proposals awaiting confirmation', () => {
    const mine = () => makeAction('p-mine', { text: 'Pair on deploys', linkedTicketId: 'd1' });
    const pendingFor = (id: string, expiresAt = NOW + 60_000) =>
      new Map<string, PendingCreation>([[id, { kind: 'action', expiresAt }]]);

    it('keeps a proposal the incoming state lost, and asks for a re-send', () => {
      const pending = pendingFor('p-mine');
      const incoming = makeHc({ actions: [makeAction('a-other')] });
      const prev = makeHc({ actions: [makeAction('a-other'), mine()] });

      const { merged, divergent } = mergeRemoteHealthCheckSession(incoming, prev, hcCtx(), pending);

      expect(merged.actions.map(a => a.id)).toEqual(['a-other', 'p-mine']);
      expect(merged.actions[1].text).toBe('Pair on deploys');
      expect(divergent).toBe(true);
      expect(pending.has('p-mine')).toBe(true);
    });

    it('stops holding a proposal once the server reports it', () => {
      const pending = pendingFor('p-mine');
      const confirmed = { ...mine(), proposalVotes: { [OTHER]: 'up' as const } };

      const { merged, divergent } = mergeRemoteHealthCheckSession(
        makeHc({ actions: [confirmed] }),
        makeHc({ actions: [mine()] }),
        hcCtx(),
        pending
      );

      expect(merged.actions).toEqual([confirmed]); // the server's copy, not the local one
      expect(divergent).toBe(false);
      expect(pending.size).toBe(0);
    });

    // The TTL is what bounds a proposal the server will never confirm because
    // the facilitator deleted it — resurrecting it forever would be the
    // opposite bug.
    it('drops a proposal whose hold ran out instead of resurrecting it', () => {
      const pending = pendingFor('p-mine', NOW - 1);

      const { merged, divergent } = mergeRemoteHealthCheckSession(
        makeHc({ actions: [] }),
        makeHc({ actions: [mine()] }),
        hcCtx(),
        pending
      );

      expect(merged.actions).toEqual([]);
      expect(divergent).toBe(false);
      expect(pending.size).toBe(0);
    });

    it('confirms against the first state the screen receives as well', () => {
      const pending = pendingFor('p-mine');

      mergeRemoteHealthCheckSession(makeHc({ actions: [mine()] }), null, hcCtx(), pending);

      expect(pending.size).toBe(0);
    });
  });

  // The timer the health check shares with the retrospective is session
  // state, not own data: every client writes its expiry and anyone may
  // silence it, so a local timer change that re-asserted itself over the
  // server's would make two clients fight over the clock. It claims no slice.
  describe('timer settings', () => {
    const stoppedAt = (seconds: number) => ({
      isAnonymous: false,
      revealRoti: false,
      timerSeconds: seconds,
      timerInitial: seconds,
      timerRunning: false,
      timerAcknowledged: false
    });

    it('takes the incoming timer over a local start without reporting divergence', () => {
      const before = makeHc({ settings: stoppedAt(420) });
      // This client has just started the timer...
      const prev = makeHc({ settings: { ...stoppedAt(420), timerRunning: true, timerStartedAt: NOW } });
      const ownChanges = claimingHc(before, prev);
      expect(ownChanges.size).toBe(0);
      // ...and the server holds the facilitator's phase change (Discuss, 8:00).
      const incoming = makeHc({ phase: 'DISCUSS', settings: stoppedAt(480) });

      const { merged, divergent } = mergeRemoteHealthCheckSession(incoming, prev, hcCtx({ ownChanges }), noPending());

      expect(merged.settings).toEqual(stoppedAt(480));
      expect(divergent).toBe(false);
    });

    it('takes another client\'s run and expiry over a local stopped timer', () => {
      const prev = makeHc({ settings: stoppedAt(420) });
      const runningElsewhere = { ...stoppedAt(420), timerRunning: true, timerStartedAt: NOW - 1000 };
      const expiredElsewhere = { ...runningElsewhere, timerRunning: false, timerSeconds: 0 };

      const started = mergeRemoteHealthCheckSession(makeHc({ settings: runningElsewhere }), prev, hcCtx(), noPending());
      expect(started.merged.settings).toEqual(runningElsewhere);
      expect(started.divergent).toBe(false);

      const ended = mergeRemoteHealthCheckSession(makeHc({ settings: expiredElsewhere }), started.merged, hcCtx(), noPending());
      expect(ended.merged.settings).toEqual(expiredElsewhere);
      expect(ended.divergent).toBe(false);
    });
  });
});

// Codex review finding on PR #460: the closed-action snapshot was merged
// add-only like the open/history ones. Those only ever grow; this one shrinks
// when the facilitator presses "Rate later", and an add-only merge turned that
// removal into a fight — every client still holding the row re-added it, marked
// the state divergent and re-sent, so the deferred action came straight back.
describe('the closed-action snapshot is facilitator-owned, not add-only', () => {
  const row = (id: string) => ({
    id, text: 'Pair on deploys', assigneeId: null,
    done: true, type: 'new' as const, proposalVotes: {}
  });

  it('accepts a removal instead of re-adding the row and re-sending', () => {
    const prev = makeSession({ closedActionsSnapshot: [row('a1'), row('a2')] });
    const incoming = makeSession({ closedActionsSnapshot: [row('a1')] });

    const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), noPending());

    expect(merged.closedActionsSnapshot?.map((a) => a.id)).toEqual(['a1']);
    expect(divergent).toBe(false); // nothing re-sent, so the deferral sticks
  });

  // The other half, and the one that broke the feature end to end when it was
  // missing: the facilitator builds this list once at phase entry, so any write
  // racing that one healed it away for good — the phase-entry effect does not
  // run a second time, and the round silently never appeared.
  it('re-asserts a round the facilitator built but the server has not confirmed', () => {
    const prev = makeSession({ closedActionsSnapshot: [row('a1')] });
    const incoming = makeSession({ closedActionsSnapshot: [] });
    const ownChanges = claiming(makeSession({ closedActionsSnapshot: [] }), prev);
    expect(ownChanges.size).toBe(1);

    const { merged, divergent } = mergeRemoteRetroSession(
      incoming,
      prev,
      ctx({ ownChanges }),
      noPending()
    );

    expect(merged.closedActionsSnapshot?.map((a) => a.id)).toEqual(['a1']);
    expect(divergent).toBe(true); // re-sent, so the server converges to it
  });

  it('drops the claim once the server reports the same round', () => {
    const prev = makeSession({ closedActionsSnapshot: [row('a1')] });
    const incoming = makeSession({ closedActionsSnapshot: [row('a1')] });
    const ownChanges = claiming(makeSession({ closedActionsSnapshot: [] }), prev);

    const { divergent } = mergeRemoteRetroSession(incoming, prev, ctx({ ownChanges }), noPending());

    expect(divergent).toBe(false);
    expect(ownChanges.size).toBe(0);
  });

  // A participant never claims this slice, so a deferral reaches them as a
  // plain removal rather than something to fight over.
  it('claims the slice only when the local update actually changed the round', () => {
    const ledger: OwnChangeLedger = new Map();
    const same = makeSession({ closedActionsSnapshot: [row('a1')] });
    registerOwnRetroChanges(ledger, same, makeSession({ closedActionsSnapshot: [row('a1')] }), ME, NOW);

    expect(ledger.size).toBe(0);
  });

  // "Rate later" became a toggle: the row now stays in the round, marked, so
  // the facilitator can take the click back. That means a deferral no longer
  // changes the *id list*, and both halves of this slice used to key on the id
  // list alone — so the claim was never made and the confirmation was always
  // "the server agrees". A racing write would have healed the deferral away
  // with nothing on screen reporting it.
  describe('a deferral is part of the round, not a detail inside a row', () => {
    const deferredRow = (id: string, by: string) => ({ ...row(id), impactDeferredBy: by });

    it('claims the slice when the facilitator postpones a row that stays listed', () => {
      const ledger: OwnChangeLedger = new Map();
      registerOwnRetroChanges(
        ledger,
        makeSession({ closedActionsSnapshot: [row('a1')] }),
        makeSession({ closedActionsSnapshot: [deferredRow('a1', 's1')] }),
        ME,
        NOW
      );

      expect(ledger.size).toBe(1);
    });

    it('re-asserts an unconfirmed deferral rather than letting it be healed away', () => {
      const prev = makeSession({ closedActionsSnapshot: [deferredRow('a1', 's1')] });
      const incoming = makeSession({ closedActionsSnapshot: [row('a1')] });
      const ownChanges = claiming(makeSession({ closedActionsSnapshot: [row('a1')] }), prev);

      const { merged, divergent } = mergeRemoteRetroSession(
        incoming,
        prev,
        ctx({ ownChanges }),
        noPending()
      );

      expect(merged.closedActionsSnapshot?.[0].impactDeferredBy).toBe('s1');
      expect(divergent).toBe(true);
    });

    it('drops the claim once the server reports the same deferral', () => {
      const prev = makeSession({ closedActionsSnapshot: [deferredRow('a1', 's1')] });
      const incoming = makeSession({ closedActionsSnapshot: [deferredRow('a1', 's1')] });
      const ownChanges = claiming(makeSession({ closedActionsSnapshot: [row('a1')] }), prev);

      const { divergent } = mergeRemoteRetroSession(incoming, prev, ctx({ ownChanges }), noPending());

      expect(divergent).toBe(false);
      expect(ownChanges.size).toBe(0);
    });

    // The other client of the same facilitator lifted the deferral. With
    // nothing outstanding locally, the server's word wins — otherwise the two
    // browsers ping-pong the toggle, which is the bug the ledger exists for.
    it('takes an incoming un-deferral when nothing local is outstanding', () => {
      const prev = makeSession({ closedActionsSnapshot: [deferredRow('a1', 's1')] });
      const incoming = makeSession({ closedActionsSnapshot: [row('a1')] });

      const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), noPending());

      expect(merged.closedActionsSnapshot?.[0].impactDeferredBy).toBeUndefined();
      expect(divergent).toBe(false);
    });
  });
});

// Incident ISS (2026-10-12): "tickets disappear one by one". The server
// refused every write of a participant (a stale facilitator-only field rode
// along), the client re-sent forever, and each card it had written stayed on
// its author's screen for exactly the 60 s pending-creation TTL and then
// vanished. That TTL exists to bound a creation the server will never confirm
// because someone deleted it — it was never meant to run while the server is
// refusing to hear the client at all.
describe('holdOwnStateWhileRefused', () => {
  it('keeps every pending creation and own-change claim alive for at least another 60 s', () => {
    const pending = new Map<string, PendingCreation>([
      ['t-soon', { kind: 'ticket', expiresAt: NOW + 5_000 }],
      ['a-soon', { kind: 'action', expiresAt: NOW + 1 }]
    ]);
    const ledger: OwnChangeLedger = new Map([
      ['roti', { expiresAt: NOW + 10_000 }],
      ['ticketVotes:t1', { expiresAt: NOW - 1 }]
    ]);

    holdOwnStateWhileRefused(pending, ledger, NOW);

    expect([...pending.values()].map(p => p.expiresAt)).toEqual([NOW + 60_000, NOW + 60_000]);
    expect([...ledger.values()].map(c => c.expiresAt)).toEqual([NOW + 60_000, NOW + 60_000]);
  });

  it('never shortens a deadline that is already further out', () => {
    const pending = new Map<string, PendingCreation>([
      ['t-late', { kind: 'ticket', expiresAt: NOW + 90_000 }]
    ]);
    const ledger: OwnChangeLedger = new Map([['happiness', { expiresAt: NOW + 75_000 }]]);

    holdOwnStateWhileRefused(pending, ledger, NOW);

    expect(pending.get('t-late')?.expiresAt).toBe(NOW + 90_000);
    expect(ledger.get('happiness')?.expiresAt).toBe(NOW + 75_000);
  });

  it('keeps an unconfirmed card on screen past the TTL while refusals continue', () => {
    const myTicket = makeTicket('t-mine');
    // Written at NOW: the TTL alone would drop it at NOW + 60 s.
    const pending = new Map<string, PendingCreation>([
      ['t-mine', { kind: 'ticket', expiresAt: NOW + 60_000 }]
    ]);
    const ownChanges = noClaims();

    // Refused at NOW + 50 s, then healed at NOW + 100 s with a state that
    // still does not know the card.
    holdOwnStateWhileRefused(pending, ownChanges, NOW + 50_000);
    const { merged, divergent } = mergeRemoteRetroSession(
      makeSession({ tickets: [] }),
      makeSession({ tickets: [myTicket] }),
      ctx({ ownChanges, now: NOW + 100_000 }),
      pending
    );

    expect(merged.tickets.map(t => t.id)).toEqual(['t-mine']);
    expect(divergent).toBe(true);
  });

  it('lets the TTL run again once refusals stop', () => {
    const pending = new Map<string, PendingCreation>([
      ['t-mine', { kind: 'ticket', expiresAt: NOW + 60_000 }]
    ]);
    holdOwnStateWhileRefused(pending, noClaims(), NOW + 50_000);

    // No further refusal: 60 s after the last one the creation is dropped.
    const { merged } = mergeRemoteRetroSession(
      makeSession({ tickets: [] }),
      makeSession({ tickets: [makeTicket('t-mine')] }),
      ctx({ now: NOW + 110_001 }),
      pending
    );
    expect(merged.tickets).toHaveLength(0);
    expect(pending.size).toBe(0);
  });
});

describe('scheduleSessionResend', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const refs = () => ({
    timer: { current: null as ReturnType<typeof setTimeout> | null },
    isLive: { current: true },
    session: { current: makeSession() as RetroSession | null }
  });

  it('re-sends after the usual 150-400 ms jitter by default', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const send = vi.fn();

    scheduleSessionResend(refs(), send);
    vi.advanceTimersByTime(399);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  // The incident's client re-sent about three times a second, forever. Under
  // a refusal streak syncService hands back a backoff delay, and the re-send
  // must wait at least that long.
  it('waits at least the minimum delay it is given', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const send = vi.fn();

    scheduleSessionResend(refs(), send, 3_200);
    vi.advanceTimersByTime(3_199);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps the jitter when it is longer than the minimum delay', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const send = vi.fn();

    scheduleSessionResend(refs(), send, 100);
    vi.advanceTimersByTime(399);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

// Review finding on PR #525: two quick presses of a column arrow are two writes
// stamped with the same revision. The server keeps the first and heals the
// second away, and `columns` is facilitator-only content where incoming wins,
// so the board jumped back one place a round-trip later — the keyboard flow
// the move buttons keep focus for (press, press again) lost every other press.
describe('the column order is claimed by the client that reordered', () => {
  const col = (id: string, title = id.toUpperCase()) => ({
    id, title, color: 'bg-slate-50', border: 'border-slate-300', icon: 'star', text: 'text-slate-700', ring: 'focus:ring-slate-200'
  });
  const board = (...columns: ReturnType<typeof col>[]) => makeSession({ phase: 'BRAINSTORM', columns });
  const order = (session: RetroSession) => session.columns.map((c) => c.id);

  it('claims the slice for a reorder, and not for a title, an addition or a removal', () => {
    const claims = (before: RetroSession, after: RetroSession) => claiming(before, after).size;
    expect(claims(board(col('a'), col('b')), board(col('b'), col('a')))).toBe(1);
    expect(claims(board(col('a'), col('b')), board(col('a', 'Renamed'), col('b')))).toBe(0);
    expect(claims(board(col('a'), col('b')), board(col('a'), col('b'), col('c')))).toBe(0);
    expect(claims(board(col('a'), col('b')), board(col('b')))).toBe(0);
  });

  it('answers a heal that kept only the first of two moves with the local order', () => {
    const start = board(col('a'), col('b'), col('c'));
    const twoMoves = board(col('b'), col('c'), col('a'));
    const ownChanges = claiming(start, twoMoves);
    // The server holds the first move, and a title another tab changed.
    const healed = board(col('b'), col('a'), col('c', 'Continue'));

    const { merged, divergent } = mergeRemoteRetroSession(healed, twoMoves, ctx({ ownChanges }), noPending());

    expect(order(merged)).toEqual(['b', 'c', 'a']);
    expect(merged.columns.find((c) => c.id === 'c')?.title).toBe('Continue');
    expect(divergent).toBe(true);
  });

  // Pushing it to the end would move it for everyone at the next re-send.
  it('keeps a column only the server has where the server put it', () => {
    const start = board(col('a'), col('b'));
    const moved = board(col('b'), col('a'));
    const ownChanges = claiming(start, moved);

    const added = mergeRemoteRetroSession(board(col('n', 'New'), col('a'), col('b')), moved, ctx({ ownChanges }), noPending());
    expect(order(added.merged)).toEqual(['n', 'b', 'a']);

    const between = mergeRemoteRetroSession(board(col('a'), col('n', 'New'), col('b')), moved, ctx({ ownChanges }), noPending());
    expect(order(between.merged)).toEqual(['b', 'n', 'a']);
  });

  it('takes the server order on a client that never reordered', () => {
    const prev = board(col('a'), col('b'));
    const incoming = board(col('b'), col('a'));

    const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx(), noPending());

    expect(order(merged)).toEqual(['b', 'a']);
    expect(divergent).toBe(false);
  });

  it('drops the claim once the server reports the same order', () => {
    const moved = board(col('b'), col('a'));
    const ownChanges = claiming(board(col('a'), col('b')), moved);
    expect(ownChanges.size).toBe(1);

    const { divergent } = mergeRemoteRetroSession(board(col('b'), col('a', 'Renamed')), moved, ctx({ ownChanges }), noPending());

    expect(divergent).toBe(false);
    expect(ownChanges.size).toBe(0);
  });
});

// The review summary is facilitator-only content (sessionGuard), typed one
// keystroke per write. A keystroke built on a revision another write has just
// moved — a Jira batch stamping its keys, a timer tick — is refused and
// healed, and without a claim the heal took that character away for good
// (jiraBatchSessionConvergence pinned exactly one lost keystroke).
describe('the review summary is claimed by the facilitator who typed it', () => {
  const review = (reviewSummary?: string) => makeSession({ phase: 'REVIEW', ...(reviewSummary === undefined ? {} : { reviewSummary }) });
  const facilitatorClaiming = (before: RetroSession, after: RetroSession): OwnChangeLedger => {
    const ledger: OwnChangeLedger = new Map();
    registerOwnRetroChanges(ledger, before, after, ME, NOW, { isFacilitator: true });
    return ledger;
  };

  it('claims the summary for a facilitator’s edit, and never for anyone else', () => {
    expect([...facilitatorClaiming(review('We'), review('We s')).keys()]).toEqual(['reviewSummary']);
    // A participant cannot change it: the server puts it back, and a claim
    // would re-assert the refused value at every heal.
    expect(claiming(review('We'), review('We s')).size).toBe(0);
    expect(facilitatorClaiming(review('We'), review('We')).size).toBe(0);
    // No summary and an empty one say the same thing.
    expect(facilitatorClaiming(review(), review('')).size).toBe(0);
  });

  it('answers a heal that lost the latest keystroke with the local summary, and the rest of the server’s state', () => {
    const typed = review('We ship');
    const ownChanges = facilitatorClaiming(review('We shi'), typed);
    // The server holds the keystroke before, and the key a Jira batch stamped meanwhile.
    const healed = {
      ...review('We shi'),
      actions: [makeAction('a1', { type: 'new', jira: { key: 'PROJ-1', createdAt: '2026-10-20T10:00:00.000Z' } })]
    };

    const { merged, divergent } = mergeRemoteRetroSession(healed, typed, ctx({ ownChanges }), noPending());

    expect(merged.reviewSummary).toBe('We ship');
    expect(merged.actions[0].jira).toEqual({ key: 'PROJ-1', createdAt: '2026-10-20T10:00:00.000Z' });
    expect(divergent).toBe(true);
  });

  it('drops the claim once the server holds the summary, and takes the server’s word after that', () => {
    const typed = review('We ship');
    const ownChanges = facilitatorClaiming(review('We shi'), typed);

    const confirmed = mergeRemoteRetroSession(review('We ship'), typed, ctx({ ownChanges }), noPending());
    expect(confirmed.divergent).toBe(false);
    expect(ownChanges.size).toBe(0);

    // The facilitator's other browser edits it next.
    const elsewhere = mergeRemoteRetroSession(review('We ship weekly'), confirmed.merged, ctx({ ownChanges }), noPending());
    expect(elsewhere.merged.reviewSummary).toBe('We ship weekly');
    expect(elsewhere.divergent).toBe(false);
  });

  // A summary emptied here and a state that never had one say the same thing:
  // the server holds the edit, so nothing is re-asserted or sent again.
  it('confirms an emptied summary against a state with no summary at all', () => {
    const emptied = review('');
    const ownChanges = facilitatorClaiming(review('We'), emptied);
    expect(ownChanges.size).toBe(1);

    const { divergent } = mergeRemoteRetroSession(review(), emptied, ctx({ ownChanges }), noPending());
    expect(divergent).toBe(false);
    expect(ownChanges.size).toBe(0);
  });

  it('takes the server’s summary on a client that never typed it', () => {
    const { merged, divergent } = mergeRemoteRetroSession(review('From the facilitator'), review('Old'), ctx(), noPending());
    expect(merged.reviewSummary).toBe('From the facilitator');
    expect(divergent).toBe(false);
  });

  // With two pods, the heal of a keystroke (sent by the pod holding the
  // socket) can overtake a broadcast another pod sent before it (through the
  // adapter). Taken as it comes, that older state put the summary back on the
  // facilitator's screen, and the next keystroke re-asserted the shorter text.
  it('never takes the summary back to a state older than the one on screen', () => {
    const confirmed = { ...review('We ship,'), _rev: 8 };
    const older = { ...review('We ship'), _rev: 7 };

    const { merged, divergent } = mergeRemoteRetroSession(older, confirmed, ctx(), noPending());

    expect(merged.reviewSummary).toBe('We ship,');
    // Nothing to send: the server already holds it, at the newer revision.
    expect(divergent).toBe(false);

    const newer = mergeRemoteRetroSession({ ...review('We ship weekly'), _rev: 9 }, confirmed, ctx(), noPending());
    expect(newer.merged.reviewSummary).toBe('We ship weekly');
  });

  // Only an *older* state is kept off the screen. A heal at the revision the
  // screen holds (a throttled or malformed write, a protected-fields refusal
  // whose role could not be read) is the server's state at that revision,
  // and with no live claim its summary is the one to show: keeping the local
  // one would leave text on screen the server never stored, with nothing
  // re-sent to make it so.
  it('takes the server’s summary from a state at the same revision when nothing is claimed', () => {
    const { merged, divergent } = mergeRemoteRetroSession(
      { ...review('B'), _rev: 8 },
      { ...review('A'), _rev: 8 },
      ctx(),
      noPending()
    );
    expect(merged.reviewSummary).toBe('B');
    expect(divergent).toBe(false);
  });

  it('stops re-asserting it once the claim has expired', () => {
    const typed = review('We ship');
    const ownChanges = facilitatorClaiming(review('We shi'), typed);

    const { merged, divergent } = mergeRemoteRetroSession(review('Something else'), typed, ctx({ ownChanges, now: NOW + 61_000 }), noPending());

    expect(merged.reviewSummary).toBe('Something else');
    expect(divergent).toBe(false);
    expect(ownChanges.size).toBe(0);
  });
});

/**
 * Votes that move because cards were regrouped are not the user voting.
 *
 * Grouping carries the cards' votes into the group (utils/retroGrouping.ts →
 * `combineVotes`), and an open board votes while it groups. Grouping is
 * shared content where the server wins, like a card's column: a regrouping
 * that loses a race is healed away and redone by hand. Read as own votes, the
 * moved votes did two kinds of damage. The grouper's own vote, claimed on the
 * card it left, was re-asserted as "no vote" on the card the heal put back,
 * and the vote was gone for good. And a participant whose vote on a card raced
 * the regrouping re-asserted it on a card the server had grouped, where it
 * counts against their budget with no control to take it back.
 */
describe('votes moved by a regrouping are not own votes', () => {
  const group = (id: string, votes: string[] = []) => ({ id, title: '', colId: 'col-1', votes });

  it('claims no vote slice for a card or a group the write regrouped', () => {
    const before = makeSession({
      tickets: [makeTicket('A', { votes: [ME] }), makeTicket('B', { votes: [OTHER] })]
    });
    const after = makeSession({
      tickets: [makeTicket('A', { groupId: 'g1' }), makeTicket('B', { groupId: 'g1' })],
      groups: [group('g1', [ME, OTHER])]
    });

    const ledger = claiming(before, after);

    expect([...ledger.keys()]).toEqual([]);
  });

  it('claims none for an existing group whose cards changed either', () => {
    const before = makeSession({
      tickets: [
        makeTicket('A', { groupId: 'g1' }),
        makeTicket('B', { groupId: 'g1' }),
        makeTicket('C', { votes: [ME] })
      ],
      groups: [group('g1', [ME])]
    });
    const after = makeSession({
      tickets: [
        makeTicket('A', { groupId: 'g1' }),
        makeTicket('B', { groupId: 'g1' }),
        makeTicket('C', { groupId: 'g1' })
      ],
      groups: [group('g1', [ME, ME])]
    });

    expect([...claiming(before, after).keys()]).toEqual([]);
  });

  it('drops a vote claim still outstanding on a card the user then regrouped', () => {
    const ledger: OwnChangeLedger = new Map();
    const fresh = makeSession({ tickets: [makeTicket('A'), makeTicket('B')] });
    const voted = makeSession({ tickets: [makeTicket('A', { votes: [ME] }), makeTicket('B')] });
    registerOwnRetroChanges(ledger, fresh, voted, ME, NOW);
    expect([...ledger.keys()]).toEqual(['ticketVotes:A']);

    const grouped = makeSession({
      tickets: [makeTicket('A', { groupId: 'g1' }), makeTicket('B', { groupId: 'g1' })],
      groups: [group('g1', [ME])]
    });
    registerOwnRetroChanges(ledger, voted, grouped, ME, NOW + 10);

    // The regrouping lost its race: the heal has the vote on A, ungrouped.
    const heal = makeSession({ tickets: [makeTicket('A', { votes: [ME] }), makeTicket('B')] });
    const { merged, divergent } = mergeRemoteRetroSession(heal, grouped, ctx({ ownChanges: ledger }), noPending());

    expect(merged.tickets.find((t) => t.id === 'A')?.votes).toEqual([ME]);
    expect(divergent).toBe(false);
  });

  it('still claims a vote cast on a card that stays where it is', () => {
    const before = makeSession({ tickets: [makeTicket('A', { groupId: 'g1' }), makeTicket('B', { groupId: 'g1' })], groups: [group('g1')] });
    const after = makeSession({ tickets: [makeTicket('A', { groupId: 'g1' }), makeTicket('B', { groupId: 'g1' })], groups: [group('g1', [ME])] });

    expect([...claiming(before, after).keys()]).toEqual(['groupVotes:g1']);
  });

  it('never re-asserts an own vote on a card the incoming state has grouped', () => {
    // My vote on A was refused while someone grouped A with B: the heal moved
    // whatever A held into the group, and A itself takes no vote any more.
    const before = makeSession({ tickets: [makeTicket('A'), makeTicket('B')] });
    const prev = makeSession({ tickets: [makeTicket('A', { votes: [ME] }), makeTicket('B')] });
    const ownChanges = claiming(before, prev);
    const incoming = makeSession({
      tickets: [makeTicket('A', { groupId: 'g1' }), makeTicket('B', { groupId: 'g1' })],
      groups: [group('g1')]
    });

    const { merged, divergent } = mergeRemoteRetroSession(incoming, prev, ctx({ ownChanges }), noPending());

    expect(merged.tickets.find((t) => t.id === 'A')?.votes).toEqual([]);
    expect(divergent).toBe(false);
    expect(ownChanges.size).toBe(0);
  });
});

/**
 * A regrouping carries a card's votes into its group, so a group's count is
 * no longer only what its voters did to it. A claim on a group
 * made before someone else's regrouping moved cards into it has to count the
 * votes those cards brought, or re-asserting it deletes them: taking one vote
 * off a group took the vote the moved card carried too (Codex review on PR
 * #540, reproduced by the adversarial review), and a vote cast on the group
 * while it happened read as already confirmed and was lost.
 */
describe('votes a regrouping moves into a group', () => {
  const group = (id: string, votes: string[] = []) => ({ id, title: '', colId: 'col-1', votes });
  const board = { phase: 'OPEN_BOARD' };
  const inG1 = (id: string) => makeTicket(id, { groupId: 'g1' });
  const mine = (votes: string[]) => votes.filter((v) => v === ME).length;

  it('takes off the one vote the user removed, not the one a moved card carried', () => {
    // My vote on group g1 and my vote on card C. I take my g1 vote back while
    // someone drops C into g1, and their write wins.
    const start = makeSession({ ...board, tickets: [inG1('A'), inG1('B'), makeTicket('C', { votes: [ME] })], groups: [group('g1', [ME])] });
    const removed = makeSession({ ...board, tickets: start.tickets, groups: [group('g1')] });
    const ownChanges = claiming(start, removed);
    const incoming = makeSession({ ...board, tickets: [inG1('A'), inG1('B'), inG1('C')], groups: [group('g1', [ME, ME, OTHER])] });

    const { merged, divergent } = mergeRemoteRetroSession(incoming, removed, ctx({ ownChanges }), noPending());

    expect(mine(merged.groups[0].votes)).toBe(1);
    expect(merged.groups[0].votes).toContain(OTHER);
    expect(divergent).toBe(true);
  });

  it('re-sends a vote cast on the group while a regrouping moved another of the user’s votes in', () => {
    const start = makeSession({ ...board, tickets: [inG1('A'), inG1('B'), makeTicket('C', { votes: [ME] })], groups: [group('g1')] });
    const voted = makeSession({ ...board, tickets: start.tickets, groups: [group('g1', [ME])] });
    const ownChanges = claiming(start, voted);
    // The regrouping won: C's vote moved into g1, my vote on g1 did not land.
    const incoming = makeSession({ ...board, tickets: [inG1('A'), inG1('B'), inG1('C')], groups: [group('g1', [ME])] });

    const { merged, divergent } = mergeRemoteRetroSession(incoming, voted, ctx({ ownChanges }), noPending());

    expect(mine(merged.groups[0].votes)).toBe(2);
    expect(divergent).toBe(true);

    // The re-send lands: the claim is confirmed and nothing more is sent.
    const settled = mergeRemoteRetroSession(merged, merged, ctx({ ownChanges }), noPending());
    expect(settled.divergent).toBe(false);
    expect(ownChanges.size).toBe(0);
  });

  it('counts only the votes on cards the group received, not on cards it already held', () => {
    const start = makeSession({ ...board, tickets: [inG1('A'), inG1('B'), makeTicket('C', { votes: [OTHER] })], groups: [group('g1')] });
    const voted = makeSession({ ...board, tickets: start.tickets, groups: [group('g1', [ME])] });
    const ownChanges = claiming(start, voted);
    // C carried someone else's vote only: my claim stays one vote.
    const incoming = makeSession({ ...board, tickets: [inG1('A'), inG1('B'), inG1('C')], groups: [group('g1', [OTHER])] });

    const { merged } = mergeRemoteRetroSession(incoming, voted, ctx({ ownChanges }), noPending());

    expect(mine(merged.groups[0].votes)).toBe(1);
    expect(merged.groups[0].votes).toContain(OTHER);
  });

  it('counts them in a guided retro too, back from a board with votes on its cards', () => {
    const guided = { phase: 'GROUP' };
    const start = makeSession({ ...guided, tickets: [inG1('A'), inG1('B'), makeTicket('C', { votes: [ME] })], groups: [group('g1', [ME])] });
    const removed = makeSession({ ...guided, tickets: start.tickets, groups: [group('g1')] });
    const ownChanges = claiming(start, removed);
    // The Group phase carries C's vote into g1, as the board does.
    const incoming = makeSession({ ...guided, tickets: [inG1('A'), inG1('B'), inG1('C')], groups: [group('g1', [ME, ME])] });

    const { merged } = mergeRemoteRetroSession(incoming, removed, ctx({ ownChanges }), noPending());

    expect(mine(merged.groups[0].votes)).toBe(1);
  });

  it('drops a group claim when the user then drops one of their voted cards into the group', () => {
    // I vote on g1, then drop C, which carries my vote, into it; both writes
    // are refused and the heal is where I started. Kept, the g1 claim would
    // re-assert two votes on g1 beside the one C keeps: two votes counted three.
    const start = makeSession({ ...board, tickets: [inG1('A'), inG1('B'), makeTicket('C', { votes: [ME] })], groups: [group('g1')] });
    const voted = makeSession({ ...board, tickets: start.tickets, groups: [group('g1', [ME])] });
    const grouped = makeSession({ ...board, tickets: [inG1('A'), inG1('B'), inG1('C')], groups: [group('g1', [ME, ME])] });
    const ledger: OwnChangeLedger = new Map();
    registerOwnRetroChanges(ledger, start, voted, ME, NOW);
    expect([...ledger.keys()]).toEqual(['groupVotes:g1']);
    registerOwnRetroChanges(ledger, voted, grouped, ME, NOW + 10);

    const { merged, divergent } = mergeRemoteRetroSession(start, grouped, ctx({ ownChanges: ledger }), noPending());

    expect(merged.groups[0].votes).toEqual([]);
    expect(merged.tickets.find((t) => t.id === 'C')?.votes).toEqual([ME]);
    expect(divergent).toBe(false);
  });
});
