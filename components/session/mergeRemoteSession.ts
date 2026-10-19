import { RetroSession, HealthCheckSession, ActionItem, ActionImpactVote } from '../../types';
import { restoreLostInvitees } from './sessionInvitees';

// Pure merge of an incoming authoritative session state with the local state.
//
// The server's optimistic concurrency control rejects a write built on a
// stale revision and heals the sender with the authoritative state. Without
// this merge, that healing (or any concurrent broadcast) would erase the
// current user's own recent input. The merge re-applies the user's OWN data
// on top of the incoming state and reports whether anything had to be
// re-applied (`divergent`), so the caller can re-send the merged state and
// make the data durable server-side — otherwise it would only survive on the
// user's screen while the server and everyone else lost it.
//
// Only the current user's own slices are preserved (their votes, happiness,
// ROTI, proposal votes, ratings, "finished" flag, and creations awaiting
// server confirmation). Everything else always comes from the server.
//
// Re-applying is gated on the own-change ledger below. Read that comment
// before touching any of the own-data rules: without the gate, the same
// participant connected from two browsers never converges.

export interface PendingCreation {
  kind: 'ticket' | 'action';
  expiresAt: number;
}

// Remember a locally created ticket / action proposal until an authoritative
// server state confirms it (the merge prunes confirmed and expired entries).
const registerPendingCreation = (
  pending: Map<string, PendingCreation>,
  id: string,
  kind: 'ticket' | 'action'
) => {
  pending.set(id, { kind, expiresAt: Date.now() + 60_000 });
};

// Forget the creations an incoming state settles: the ones it confirms (the
// server has them) and the ones whose TTL ran out — most likely deleted
// elsewhere, and resurrecting those forever would be the opposite bug. Runs on
// every incoming state, the first one a screen receives included.
const settlePendingCreations = (
  pending: Map<string, PendingCreation>,
  incoming: { tickets?: readonly { id: string }[]; actions: readonly { id: string }[] },
  now: number
) => {
  for (const [id, entry] of pending) {
    if (entry.expiresAt < now) {
      pending.delete(id);
      continue;
    }
    const known = entry.kind === 'ticket' ? (incoming.tickets ?? []) : incoming.actions;
    if (known.some(item => item.id === id)) pending.delete(id);
  }
};

// Put back the still-pending creations of one kind that the merged list lacks,
// taken from the local state they were made in. Answers the new list, or null
// when nothing was lost — the caller then has nothing to re-send.
const restorePendingCreations = <T extends { id: string }>(
  pending: Map<string, PendingCreation>,
  kind: PendingCreation['kind'],
  merged: T[],
  local: readonly T[]
): T[] | null => {
  let restored: T[] | null = null;
  for (const [id, entry] of pending) {
    if (entry.kind !== kind) continue;
    const current: T[] = restored ?? merged;
    if (current.some(item => item.id === id)) continue;
    const mine = local.find(item => item.id === id);
    if (mine) restored = [...current, { ...mine }];
  }
  return restored;
};

// --- Own-change ledger -----------------------------------------------------
//
// "The server healed my write away" and "another client of mine is ahead of
// me" produce the *exact same* difference between the local and the incoming
// state, so the merge cannot tell them apart from state alone. It used to try
// anyway, and the second reading is real: a participant who opens the invite
// link in two browsers is one user id on two clients. The stale browser then
// read the fresh state as a lost write, undid it and re-sent; the other
// browser undid that and re-sent; and the two ping-ponged through the server
// forever — the facilitator watching "1 of 5 voted to move on" flicker to 0
// and back every few hundred milliseconds until the participant clicked in
// both browsers.
//
// The missing signal is not in the state, it is in this client's history:
// *did I make this change and is the server still unaware of it?* The ledger
// carries exactly that. `registerOwnRetroChanges` / `registerOwnHealthCheckChanges`
// claim a slice when the local `updateSession` actually changed the current
// user's value for it; the merge re-applies a slice only while its claim is
// live, and drops the claim as soon as an incoming state agrees with the local
// value (the write landed). A client with nothing outstanding therefore takes
// the server's word for its own data — which is how the second browser learns
// what the first one did, instead of arguing with it.
//
// Same shape as PendingCreation, and for the same reason: an unconfirmed local
// write, with a TTL so a claim that can never be confirmed cannot keep a client
// re-sending forever.
export interface PendingOwnChange {
  expiresAt: number;
}

export type OwnChangeLedger = Map<string, PendingOwnChange>;

const OWN_CHANGE_TTL_MS = 60_000;

// One key per independently mergeable own-data slice. Keys that are not
// id-scoped (`happiness`, `roti`, `finished`) are why a component must reset
// its ledger when it switches session: an id collision is impossible, a bare
// key collision is not.
const ownKey = {
  happiness: 'happiness',
  roti: 'roti',
  finished: 'finished',
  ticketVotes: (ticketId: string) => `ticketVotes:${ticketId}`,
  groupVotes: (groupId: string) => `groupVotes:${groupId}`,
  proposalVote: (actionId: string) => `proposalVote:${actionId}`,
  nextTopicVote: (topicId: string) => `nextTopicVote:${topicId}`,
  rating: (dimensionId: string) => `rating:${dimensionId}`,
  actionImpact: (actionId: string) => `actionImpact:${actionId}`,
  closedActionsSnapshot: 'closedActionsSnapshot',
  columnOrder: 'columnOrder'
} as const;

/**
 * What the closed-action round *is*, for merge purposes: which actions it asks
 * about, and which of them the facilitator has postponed.
 *
 * The deferral belongs in this signature and is not a detail of the entries.
 * "Rate later" used to delete the row, so the id list alone described the round
 * completely; it is a toggle now, and a deferral leaves the ids untouched. Key
 * the slice on ids only and the facilitator's own toggle is claimed by nobody —
 * the next racing write heals it away, silently, which is the exact failure the
 * ledger exists to prevent.
 */
const closedRoundSignature = (session: Pick<RetroSession, 'closedActionsSnapshot'>): string =>
  (session.closedActionsSnapshot ?? [])
    // NUL between the fields and between the entries, as the id list already
    // did: it is the one character an id or a session id cannot contain, so no
    // two different rounds can produce the same string. Written as an escape
    // rather than the raw byte the previous line carried, which was invisible
    // in every editor and made the file read as binary to `grep`.
    .map(action => `${action.id}\u0000${action.impactDeferredBy ?? ''}`)
    .join('\u0000');

/**
 * The order of the columns `columns` shares with `other`, as one string.
 * Comparing the two directions asks "do both sides agree on the order of what
 * they both have?" — a column added or removed elsewhere changes neither, so
 * the column-order slice claims and re-asserts the ORDER, never a column's
 * existence or its title (facilitator-only content, where the server wins).
 */
const sharedColumnOrder = (columns: RetroSession['columns'] | undefined, other: RetroSession['columns'] | undefined): string => {
  const ids = new Set((other ?? []).map(column => column.id));
  return (columns ?? []).filter(column => ids.has(column.id)).map(column => column.id).join('\u0000');
};

const sameColumnOrder = (a: RetroSession['columns'] | undefined, b: RetroSession['columns'] | undefined): boolean =>
  sharedColumnOrder(a, b) === sharedColumnOrder(b, a);

const claimOwnChange = (ledger: OwnChangeLedger, key: string, now: number) => {
  ledger.set(key, { expiresAt: now + OWN_CHANGE_TTL_MS });
};

// Decide whether the local value of one slice must win over the incoming one.
// `matches` says the server already agrees with us, which both answers the
// question (nothing to re-apply) and confirms any outstanding claim.
const ownValueWins = (
  ledger: OwnChangeLedger,
  key: string,
  matches: boolean,
  now: number
): boolean => {
  if (matches) {
    ledger.delete(key);
    return false;
  }
  const claim = ledger.get(key);
  if (!claim) return false;
  if (claim.expiresAt < now) {
    ledger.delete(key);
    return false;
  }
  return true;
};

const pruneOwnChanges = (ledger: OwnChangeLedger, now: number) => {
  for (const [key, claim] of ledger) {
    if (claim.expiresAt < now) ledger.delete(key);
  }
};

// Stop the claim clock while the client is offline: the TTL is meant to bound
// how long an unconfirmable claim keeps re-asserting itself, and no re-assertion
// can happen while nothing is being received. `updateSession` refuses to write
// when not live, so a claim held across a disconnect describes a write whose
// fate is still unknown — and burning its TTL during a slow reconnect drops the
// user's edit at exactly the moment the re-join snapshot is about to overwrite
// it. The components call this with the duration they spent disconnected.
//
// The trade is deliberate: a claim that survives a long reconnect can also
// re-assert a value another client of the same user has since changed. That
// possibility is not new — before the ledger the local value won unconditionally
// and forever — and losing the user's own edit is the more likely error of the
// two, since it needs one browser rather than two.
const extendOwnChanges = (ledger: OwnChangeLedger, offlineMs: number) => {
  if (!(offlineMs > 0)) return;
  for (const claim of ledger.values()) {
    claim.expiresAt += offlineMs;
  }
};

// How long an unconfirmed card or claim outlives the LAST hold. Same span as
// the TTLs it holds open.
const REFUSED_HOLD_MS = 60_000;

// Stop the TTLs while sync is stalled. The session screens call this when
// syncService reports the stall, and on every refusal that arrives while it
// lasts (useHoldOwnStateWhileStalled).
//
// Incident ISS (2026-10-12), "tickets disappear one by one": every write of a
// participant was refused, and each card the participant wrote stayed on their
// screen for exactly the 60 s pending-creation TTL, then vanished for good. The
// TTL bounds a creation the server will never confirm because someone deleted
// it; it was never meant to run while the server is not hearing this client at
// all. Nothing here can expire while a stall goes on, and the TTL runs again
// from the last hold once it ends — which is also what still bounds a client
// the server refuses forever: the sync-stalled banner tells the user to reload,
// and nothing is dropped behind their back meanwhile.
//
// A stall, not a refusal. A refusal on its own is an ordinary lost race: every
// client writes the timer expiry and the leftUsers clear at the same instant,
// and all but one are refused. Holding on each refusal kept every claim of a
// busy room alive for as long as the room stayed busy. The TTL is the backstop
// that ends a disagreement between two browsers of one participant that the
// ledger cannot settle, so it has to keep running whenever this client is
// heard. A stall takes ten seconds of re-sends, so anything written before it
// began still has most of its 60 s left when the hold arrives.
//
// Same shape as extendOwnChanges: an extension, never a shortening, so a
// deadline already further out is kept.
const holdOwnStateWhileRefused = (
  pending: Map<string, PendingCreation>,
  ledger: OwnChangeLedger,
  now: number = Date.now()
): void => {
  const floor = now + REFUSED_HOLD_MS;
  for (const entry of pending.values()) {
    entry.expiresAt = Math.max(entry.expiresAt, floor);
  }
  for (const claim of ledger.values()) {
    claim.expiresAt = Math.max(claim.expiresAt, floor);
  }
};

// Set the current user's entry in a per-user map, or remove it when the local
// value is "no value" — clearing a rating is as much an own change as setting
// one, and leaving the server's value behind would resurrect it.
const withOwnEntry = <T>(
  map: Record<string, T> | undefined,
  userId: string,
  value: T | undefined
): Record<string, T> => {
  const next = { ...(map ?? {}) };
  if (value === undefined) delete next[userId];
  else next[userId] = value;
  return next;
};

const ownVoteCount = (votes: string[] | undefined, userId: string) =>
  (votes ?? []).filter(v => v === userId).length;

const hasOwnEntry = (list: string[] | undefined, userId: string) => (list ?? []).includes(userId);

// Claim every own-data slice the local update just changed. Called from the
// single `updateSession` choke point of each session component with the state
// before and after the updater ran, so no call site can forget to declare its
// own write — and a new own-data field is claimed the moment it is written,
// without touching every handler that writes it.
const registerOwnRetroChanges = (
  ledger: OwnChangeLedger,
  before: RetroSession | null | undefined,
  after: RetroSession,
  userId: string,
  now: number = Date.now()
) => {
  pruneOwnChanges(ledger, now);
  if (!before) return;
  const claim = (key: string) => claimOwnChange(ledger, key, now);

  if (before.happiness?.[userId] !== after.happiness?.[userId]) claim(ownKey.happiness);
  if (before.roti?.[userId] !== after.roti?.[userId]) claim(ownKey.roti);
  if (hasOwnEntry(before.finishedUsers, userId) !== hasOwnEntry(after.finishedUsers, userId)) {
    claim(ownKey.finished);
  }

  for (const ticket of after.tickets ?? []) {
    const prevTicket = (before.tickets ?? []).find(t => t.id === ticket.id);
    if (!prevTicket) continue; // a creation: pendingCreations covers it whole
    if (ownVoteCount(prevTicket.votes, userId) !== ownVoteCount(ticket.votes, userId)) {
      claim(ownKey.ticketVotes(ticket.id));
    }
  }

  for (const group of after.groups ?? []) {
    const prevGroup = (before.groups ?? []).find(g => g.id === group.id);
    if (!prevGroup) continue;
    if (ownVoteCount(prevGroup.votes, userId) !== ownVoteCount(group.votes, userId)) {
      claim(ownKey.groupVotes(group.id));
    }
  }

  for (const action of after.actions ?? []) {
    const prevAction = (before.actions ?? []).find(a => a.id === action.id);
    if (!prevAction) continue;
    if (prevAction.proposalVotes?.[userId] !== action.proposalVotes?.[userId]) {
      claim(ownKey.proposalVote(action.id));
    }
  }

  const beforeTopics = before.discussionNextTopicVotes ?? {};
  const afterTopics = after.discussionNextTopicVotes ?? {};
  for (const topicId of new Set([...Object.keys(beforeTopics), ...Object.keys(afterTopics)])) {
    if (hasOwnEntry(beforeTopics[topicId], userId) !== hasOwnEntry(afterTopics[topicId], userId)) {
      claim(ownKey.nextTopicVote(topicId));
    }
  }

  // The closed-action round, claimed as a whole rather than per entry: the
  // facilitator builds it, "Rate now" adds to it and "Rate later" postpones
  // inside it, so every direction is a legitimate local change.
  if (closedRoundSignature(before) !== closedRoundSignature(after)) {
    claim(ownKey.closedActionsSnapshot);
  }

  // The facilitator's column reorder (Edit Layout). Two quick moves are two
  // writes stamped with the same revision; the server keeps the first and
  // heals the second away, so without a claim the board jumped back one place
  // a round-trip later. Only the facilitator ever reorders, so only their
  // client claims; everyone else takes the server's order.
  if (!sameColumnOrder(before.columns, after.columns)) {
    claim(ownKey.columnOrder);
  }

  const beforeImpact = before.actionImpactVotes ?? {};
  const afterImpact = after.actionImpactVotes ?? {};
  for (const actionId of new Set([...Object.keys(beforeImpact), ...Object.keys(afterImpact)])) {
    if (beforeImpact[actionId]?.[userId] !== afterImpact[actionId]?.[userId]) {
      claim(ownKey.actionImpact(actionId));
    }
  }
};

const registerOwnHealthCheckChanges = (
  ledger: OwnChangeLedger,
  before: HealthCheckSession | null | undefined,
  after: HealthCheckSession,
  userId: string,
  now: number = Date.now()
) => {
  pruneOwnChanges(ledger, now);
  if (!before) return;
  const claim = (key: string) => claimOwnChange(ledger, key, now);

  const beforeRatings = before.ratings?.[userId] ?? {};
  const afterRatings = after.ratings?.[userId] ?? {};
  for (const dimensionId of new Set([...Object.keys(beforeRatings), ...Object.keys(afterRatings)])) {
    const wasRated = beforeRatings[dimensionId];
    const isRated = afterRatings[dimensionId];
    if (wasRated?.rating !== isRated?.rating || wasRated?.comment !== isRated?.comment) {
      claim(ownKey.rating(dimensionId));
    }
  }

  if (before.roti?.[userId] !== after.roti?.[userId]) claim(ownKey.roti);
  if (hasOwnEntry(before.finishedUsers, userId) !== hasOwnEntry(after.finishedUsers, userId)) {
    claim(ownKey.finished);
  }

  for (const action of after.actions ?? []) {
    const prevAction = (before.actions ?? []).find(a => a.id === action.id);
    if (!prevAction) continue;
    if (prevAction.proposalVotes?.[userId] !== action.proposalVotes?.[userId]) {
      claim(ownKey.proposalVote(action.id));
    }
  }
};

interface ResendRefs<S> {
  timer: { current: ReturnType<typeof setTimeout> | null };
  isLive: { current: boolean };
  session: { current: S | null | undefined };
}

// Arm a one-shot, coalesced, jittered re-send of the latest local session
// state. Used when the merge re-applied own data the server does not know
// yet: without the re-send that data would only survive on this user's
// screen. The jitter avoids a stampede when many healed clients resend at
// once; the single timer coalesces bursts of divergent updates.
//
// `minDelayMs` is the backoff syncService.getResendDelayMs() hands back under a
// streak of refusals. Without it a client whose every write is refused re-sent
// about three times a second, forever — the incident ISS client — each write a
// database read and a rejection on the server. The jitter still applies when it
// is the longer of the two.
const scheduleSessionResend = <S,>(
  refs: ResendRefs<S>,
  send: (session: S) => void,
  minDelayMs = 0
) => {
  if (refs.timer.current) return;
  refs.timer.current = setTimeout(() => {
    refs.timer.current = null;
    if (!refs.isLive.current) return;
    const current = refs.session.current;
    if (current) send(current);
  }, Math.max(150 + Math.random() * 250, minDelayMs));
};

export interface RetroMergeContext {
  currentUserId: string;
  // Facilitator is actively editing the icebreaker question locally.
  preserveIcebreaker: boolean;
  editingTicketId: string | null;
  editingGroupId: string | null;
  // Own-data slices this client changed and the server has not confirmed.
  // Required rather than optional on purpose: a call site that forgot to keep
  // a ledger would silently lose every healed own write, and an empty-map
  // default would hide that behind a green suite.
  ownChanges: OwnChangeLedger;
  now?: number;
}

// Replace the current user's entries in a votes array with their local ones,
// leaving every other user's votes as the server reported them. Only called
// once the ledger has confirmed the local count is an unacknowledged change.
const withOwnVotes = (incomingVotes: string[], prevVotes: string[], userId: string): string[] => [
  ...incomingVotes.filter(v => v !== userId),
  ...prevVotes.filter(v => v === userId)
];

// Entries of the open/history action snapshots are only ever added during a
// session (the phase-init effects merge and append, never remove), so an
// entry present locally but missing from the incoming state was lost to a
// healed write race — e.g. the snapshot init emitted right after the phase
// change, both stamped with the same base revision. Re-add the lost entries
// so the review keeps showing every action; the incoming values win for
// entries the server does know (facilitator toggles are authoritative).
const mergeSnapshotEntries = (
  incomingSnapshot: ActionItem[] | undefined,
  prevSnapshot: ActionItem[] | undefined
): { snapshot: ActionItem[] | undefined; changed: boolean } => {
  if (!prevSnapshot?.length) return { snapshot: incomingSnapshot, changed: false };
  const known = new Set((incomingSnapshot ?? []).map(a => a.id));
  const lost = prevSnapshot.filter(a => !known.has(a.id));
  if (lost.length === 0) return { snapshot: incomingSnapshot, changed: false };
  return { snapshot: [...(incomingSnapshot ?? []), ...lost], changed: true };
};

const mergeRemoteRetroSession = (
  incoming: RetroSession,
  prev: RetroSession | null,
  ctx: RetroMergeContext,
  pending: Map<string, PendingCreation>
): { merged: RetroSession; divergent: boolean } => {
  const now = ctx.now ?? Date.now();

  settlePendingCreations(pending, incoming, now);

  if (!prev) return { merged: incoming, divergent: false };

  const userId = ctx.currentUserId;
  const ledger = ctx.ownChanges;
  let divergent = false;
  const merged: RetroSession = { ...incoming };

  // --- Icebreaker question being edited by the facilitator (local-only draft;
  // never a reason to re-send).
  if (ctx.preserveIcebreaker) {
    merged.icebreakerQuestion = prev.icebreakerQuestion;
  }

  // --- Own happiness / ROTI votes.
  if (ownValueWins(ledger, ownKey.happiness, incoming.happiness[userId] === prev.happiness[userId], now)) {
    merged.happiness = withOwnEntry(incoming.happiness, userId, prev.happiness[userId]);
    divergent = true;
  }
  if (ownValueWins(ledger, ownKey.roti, incoming.roti[userId] === prev.roti[userId], now)) {
    merged.roti = withOwnEntry(incoming.roti, userId, prev.roti[userId]);
    divergent = true;
  }

  // --- Own votes on tickets and groups. Skipped when the vote model changed
  // (facilitator toggled oneVotePerTicket or adjusted maxVotes): the server
  // state is then the cleanup result and must win.
  const maxVotesChanged = incoming.settings.maxVotes !== prev.settings.maxVotes;
  const preserveVotes = !incoming.settings.oneVotePerTicket && !maxVotesChanged;

  merged.tickets = incoming.tickets.map(ticket => {
    const prevTicket = prev.tickets.find(t => t.id === ticket.id);
    if (!prevTicket) return ticket;

    let next = ticket;
    const key = ownKey.ticketVotes(ticket.id);

    if (!preserveVotes) {
      // The server state is the vote-model cleanup result and wins outright,
      // so any outstanding claim on this ticket is moot.
      ledger.delete(key);
    } else {
      const matches = ownVoteCount(ticket.votes, userId) === ownVoteCount(prevTicket.votes, userId);
      if (ownValueWins(ledger, key, matches, now)) {
        divergent = true;
        next = { ...next, votes: withOwnVotes(ticket.votes, prevTicket.votes, userId) };
      }
    }

    // Text being edited right now: keep the local draft, no re-send.
    if (ctx.editingTicketId === ticket.id && prevTicket.text !== next.text) {
      next = { ...next, text: prevTicket.text };
    }

    return next;
  });

  merged.groups = incoming.groups.map(group => {
    const prevGroup = prev.groups.find(g => g.id === group.id);
    if (!prevGroup) return group;

    let next = group;
    const key = ownKey.groupVotes(group.id);

    if (!preserveVotes) {
      ledger.delete(key);
    } else {
      const matches = ownVoteCount(group.votes, userId) === ownVoteCount(prevGroup.votes, userId);
      if (ownValueWins(ledger, key, matches, now)) {
        divergent = true;
        next = { ...next, votes: withOwnVotes(group.votes, prevGroup.votes, userId) };
      }
    }

    if (ctx.editingGroupId === group.id && prevGroup.title !== next.title) {
      next = { ...next, title: prevGroup.title };
    }

    return next;
  });

  // --- Own votes on action proposals.
  merged.actions = incoming.actions.map(action => {
    const prevAction = prev.actions.find(a => a.id === action.id);
    const ownVote = prevAction?.proposalVotes?.[userId];
    const matches = action.proposalVotes?.[userId] === ownVote;
    if (!ownValueWins(ledger, ownKey.proposalVote(action.id), matches, now)) return action;
    divergent = true;
    return { ...action, proposalVotes: withOwnEntry(action.proposalVotes, userId, ownVote) };
  });

  // --- Creations awaiting server confirmation: re-inject them so a healing
  // snapshot cannot make a just-written post-it or proposal vanish.
  const restoredTickets = restorePendingCreations(pending, 'ticket', merged.tickets, prev.tickets);
  if (restoredTickets) {
    merged.tickets = restoredTickets;
    divergent = true;
  }
  const restoredActions = restorePendingCreations(pending, 'action', merged.actions, prev.actions);
  if (restoredActions) {
    merged.actions = restoredActions;
    divergent = true;
  }

  // --- Own "I'm finished" flag. Only while the phase is unchanged: advancing
  // the phase legitimately clears the list for everyone, so a claim made
  // before the change can never apply after it.
  const ownFinishedLocally = hasOwnEntry(prev.finishedUsers, userId);
  if (incoming.phase !== prev.phase) {
    ledger.delete(ownKey.finished);
  } else if (
    ownValueWins(
      ledger,
      ownKey.finished,
      hasOwnEntry(incoming.finishedUsers, userId) === ownFinishedLocally,
      now
    )
  ) {
    merged.finishedUsers = ownFinishedLocally
      ? [...(incoming.finishedUsers ?? []), userId]
      : (incoming.finishedUsers ?? []).filter(id => id !== userId);
    divergent = true;
  }

  // --- Open / history action snapshots: re-add entries a healed state lost,
  // and re-send so the server converges back to the full snapshot.
  const openSnapshot = mergeSnapshotEntries(incoming.openActionsSnapshot, prev.openActionsSnapshot);
  if (openSnapshot.changed) {
    merged.openActionsSnapshot = openSnapshot.snapshot;
    divergent = true;
  }
  const historySnapshot = mergeSnapshotEntries(incoming.historyActionsSnapshot, prev.historyActionsSnapshot);
  if (historySnapshot.changed) {
    merged.historyActionsSnapshot = historySnapshot.snapshot;
    divergent = true;
  }

  // --- Invitees: add-only, so an entry missing from the incoming state was lost
  // to a healed write race (see restoreLostInvitees). Re-add and re-send,
  // otherwise the "waiting to join" list silently disappears and the
  // facilitator has no record of who was invited.
  const restoredInvitees = restoreLostInvitees(incoming.invitedUsers, prev.invitedUsers);
  if (restoredInvitees) {
    merged.invitedUsers = restoredInvitees;
    divergent = true;
  }

  // --- Own "move on to the next topic" votes. Symmetric (a local add AND a
  // local removal win), which is why the ledger gate matters most here: this
  // is the slice a second browser of the same participant used to fight over,
  // flickering the facilitator's "N voted to move on" counter between N and
  // N-1 until the participant clicked in both browsers.
  if (prev.discussionNextTopicVotes || incoming.discussionNextTopicVotes) {
    const incomingMap = incoming.discussionNextTopicVotes ?? {};
    const prevMap = prev.discussionNextTopicVotes ?? {};
    let changed = false;
    const nextMap: Record<string, string[]> = { ...incomingMap };
    const topicIds = new Set([...Object.keys(incomingMap), ...Object.keys(prevMap)]);
    for (const topicId of topicIds) {
      const incomingVoters = incomingMap[topicId] ?? [];
      const iVotedLocally = hasOwnEntry(prevMap[topicId], userId);
      const matches = hasOwnEntry(incomingVoters, userId) === iVotedLocally;
      if (!ownValueWins(ledger, ownKey.nextTopicVote(topicId), matches, now)) continue;
      changed = true;
      nextMap[topicId] = iVotedLocally
        ? [...incomingVoters, userId]
        : incomingVoters.filter(v => v !== userId);
    }
    if (changed) {
      divergent = true;
      merged.discussionNextTopicVotes = nextMap;
    }
  }

  // --- Own impact votes on closed actions. Symmetric like the move-on votes
  // above — clearing your own rating wins locally just as setting it does — so
  // the ledger gate is what stops two browsers of the same participant from
  // fighting: without it, each reads the other's vote as its own lost write,
  // removes it, re-sends, and the round never settles.
  if (prev.actionImpactVotes || incoming.actionImpactVotes) {
    const incomingMap = incoming.actionImpactVotes ?? {};
    const prevMap = prev.actionImpactVotes ?? {};
    let changed = false;
    const nextMap: Record<string, Record<string, ActionImpactVote>> = { ...incomingMap };
    const actionIds = new Set([...Object.keys(incomingMap), ...Object.keys(prevMap)]);
    for (const actionId of actionIds) {
      const ownVote = prevMap[actionId]?.[userId];
      const matches = incomingMap[actionId]?.[userId] === ownVote;
      if (!ownValueWins(ledger, ownKey.actionImpact(actionId), matches, now)) continue;
      changed = true;
      nextMap[actionId] = withOwnEntry(incomingMap[actionId], userId, ownVote);
    }
    if (changed) {
      divergent = true;
      merged.actionImpactVotes = nextMap;
    }
  }

  // --- The closed-action round. Deliberately NOT the add-only merge the
  // open/history snapshots use: those only ever grow, while this one shrinks
  // whenever the facilitator presses "Rate later". Add-only turned that removal
  // into a fight — every client still holding the row re-added it, re-sent, and
  // the deferred action came straight back.
  //
  // But "incoming always wins" is wrong too: the facilitator builds this list at
  // phase entry, and any write racing that one (a timer tick, a roster sync)
  // would heal it away for good, since the phase-entry effect does not run
  // again. So it goes through the ledger like every other slice where a local
  // removal also wins: the facilitator re-asserts their own unconfirmed list
  // until the server agrees, and every other client — which never claims it —
  // simply takes the server's word.
  if (
    ownValueWins(
      ledger,
      ownKey.closedActionsSnapshot,
      closedRoundSignature(prev) === closedRoundSignature(incoming),
      now
    )
  ) {
    merged.closedActionsSnapshot = prev.closedActionsSnapshot;
    divergent = true;
  }

  // --- The column order, re-asserted while the facilitator's own reorder is
  // unconfirmed: the incoming columns (their titles and styles are the
  // server's) in the local order, with any column the server has and this
  // client does not appended where the server put it last.
  if (ownValueWins(ledger, ownKey.columnOrder, sameColumnOrder(prev.columns, incoming.columns), now)) {
    const incomingById = new Map((incoming.columns ?? []).map(column => [column.id, column]));
    const localIds = new Set((prev.columns ?? []).map(column => column.id));
    merged.columns = [
      ...(prev.columns ?? []).flatMap(column => {
        const theirs = incomingById.get(column.id);
        return theirs ? [theirs] : [];
      }),
      ...(incoming.columns ?? []).filter(column => !localIds.has(column.id))
    ];
    divergent = true;
  }

  return { merged, divergent };
};

export interface HealthCheckMergeContext {
  currentUserId: string;
  // See RetroMergeContext.ownChanges — same gate, same reason.
  ownChanges: OwnChangeLedger;
  now?: number;
}

// `pending` holds the action proposals this client created and the server has
// not confirmed: the retro's record of creations, for the one kind a health
// check has. Required, like the retro's. Before it existed, a proposal whose
// write lost a race was healed away and never re-sent, and the field it was
// typed into had already been cleared (review finding C on the incident ISS
// branch) — a screen that forgot to keep one would bring that back.
const mergeRemoteHealthCheckSession = (
  incoming: HealthCheckSession,
  prev: HealthCheckSession | null,
  ctx: HealthCheckMergeContext,
  pending: Map<string, PendingCreation>
): { merged: HealthCheckSession; divergent: boolean } => {
  const now = ctx.now ?? Date.now();

  settlePendingCreations(pending, incoming, now);

  if (!prev) return { merged: incoming, divergent: false };

  const userId = ctx.currentUserId;
  const ledger = ctx.ownChanges;
  let divergent = false;
  const merged: HealthCheckSession = { ...incoming };

  // --- Own ratings, one claim per dimension: rating a second dimension must
  // not re-assert a first one the other browser has since changed.
  const prevOwnRatings = prev.ratings[userId] ?? {};
  const incomingOwnRatings = incoming.ratings[userId] ?? {};
  const ratedDimensions = new Set([
    ...Object.keys(prevOwnRatings),
    ...Object.keys(incomingOwnRatings)
  ]);
  let mergedOwnRatings = incomingOwnRatings;
  for (const dimensionId of ratedDimensions) {
    const localRating = prevOwnRatings[dimensionId];
    const incomingRating = incomingOwnRatings[dimensionId];
    const matches =
      localRating?.rating === incomingRating?.rating &&
      localRating?.comment === incomingRating?.comment;
    if (!ownValueWins(ledger, ownKey.rating(dimensionId), matches, now)) continue;
    divergent = true;
    mergedOwnRatings = { ...mergedOwnRatings };
    if (localRating === undefined) delete mergedOwnRatings[dimensionId];
    else mergedOwnRatings[dimensionId] = localRating;
  }
  if (mergedOwnRatings !== incomingOwnRatings) {
    merged.ratings = { ...incoming.ratings, [userId]: mergedOwnRatings };
  }

  // --- Own ROTI vote.
  if (ownValueWins(ledger, ownKey.roti, incoming.roti[userId] === prev.roti[userId], now)) {
    merged.roti = withOwnEntry(incoming.roti, userId, prev.roti[userId]);
    divergent = true;
  }

  // --- Own votes on action proposals (health checks share the ActionItem
  // proposal/vote model with retros).
  merged.actions = incoming.actions.map(action => {
    const prevAction = prev.actions.find(a => a.id === action.id);
    const ownVote = prevAction?.proposalVotes?.[userId];
    const matches = action.proposalVotes?.[userId] === ownVote;
    if (!ownValueWins(ledger, ownKey.proposalVote(action.id), matches, now)) return action;
    divergent = true;
    return { ...action, proposalVotes: withOwnEntry(action.proposalVotes, userId, ownVote) };
  });

  // --- Proposals awaiting server confirmation, re-injected as the retro
  // re-injects its cards and proposals.
  const restoredActions = restorePendingCreations(pending, 'action', merged.actions, prev.actions);
  if (restoredActions) {
    merged.actions = restoredActions;
    divergent = true;
  }

  // --- Own "I'm finished" flag, phase-guarded like the retro merge.
  const ownFinishedLocally = hasOwnEntry(prev.finishedUsers, userId);
  if (incoming.phase !== prev.phase) {
    ledger.delete(ownKey.finished);
  } else if (
    ownValueWins(
      ledger,
      ownKey.finished,
      hasOwnEntry(incoming.finishedUsers, userId) === ownFinishedLocally,
      now
    )
  ) {
    merged.finishedUsers = ownFinishedLocally
      ? [...(incoming.finishedUsers ?? []), userId]
      : (incoming.finishedUsers ?? []).filter(id => id !== userId);
    divergent = true;
  }

  // --- Invitees: the same add-only rule as the retro — the invite modal and
  // the participants panel are shared, so a health check loses an invitation
  // to a write race exactly as a retro would.
  const restoredInvitees = restoreLostInvitees(incoming.invitedUsers, prev.invitedUsers);
  if (restoredInvitees) {
    merged.invitedUsers = restoredInvitees;
    divergent = true;
  }

  return { merged, divergent };
};

export {
  mergeRemoteRetroSession,
  mergeRemoteHealthCheckSession,
  registerPendingCreation,
  registerOwnRetroChanges,
  registerOwnHealthCheckChanges,
  extendOwnChanges,
  holdOwnStateWhileRefused,
  scheduleSessionResend
};
