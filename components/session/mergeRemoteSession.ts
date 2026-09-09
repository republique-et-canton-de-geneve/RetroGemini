import { RetroSession, HealthCheckSession, ActionItem, ActionImpactVote } from '../../types';

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
  closedActionsSnapshot: 'closedActionsSnapshot'
} as const;

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
  // facilitator builds it and "Rate later" removes from it, so both directions
  // are legitimate local changes and only the id list matters.
  const snapshotIds = (session: RetroSession) =>
    (session.closedActionsSnapshot ?? []).map(a => a.id).join(' ');
  if (snapshotIds(before) !== snapshotIds(after)) claim(ownKey.closedActionsSnapshot);

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
const scheduleSessionResend = <S,>(refs: ResendRefs<S>, send: (session: S) => void) => {
  if (refs.timer.current) return;
  refs.timer.current = setTimeout(() => {
    refs.timer.current = null;
    if (!refs.isLive.current) return;
    const current = refs.session.current;
    if (current) send(current);
  }, 150 + Math.random() * 250);
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

  // Expire pending creations that never got confirmed (e.g. genuinely deleted
  // elsewhere) so they cannot be resurrected forever.
  for (const [id, entry] of pending) {
    if (entry.expiresAt < now) pending.delete(id);
  }
  // Confirm the ones the server now knows about.
  for (const [id, entry] of pending) {
    const present = entry.kind === 'ticket'
      ? incoming.tickets.some(t => t.id === id)
      : incoming.actions.some(a => a.id === id);
    if (present) pending.delete(id);
  }

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
  for (const [id, entry] of pending) {
    if (entry.kind === 'ticket') {
      if (merged.tickets.some(t => t.id === id)) continue;
      const prevTicket = prev.tickets.find(t => t.id === id);
      if (prevTicket) {
        merged.tickets = [...merged.tickets, { ...prevTicket }];
        divergent = true;
      }
    } else {
      if (merged.actions.some(a => a.id === id)) continue;
      const prevAction = prev.actions.find(a => a.id === id);
      if (prevAction) {
        merged.actions = [...merged.actions, { ...prevAction }];
        divergent = true;
      }
    }
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

  // --- Invitees: like the action snapshots, `invitedUsers` is only ever added
  // to during a session (sending invites appends; nothing removes an invitee),
  // so an entry present locally but missing from the incoming state was lost to
  // a healed write race — the invite write losing the CAS against a concurrent
  // timer or roster sync. Re-add the lost entries and re-send, otherwise the
  // "waiting to join" list silently disappears and the facilitator has no
  // record of who was invited. Incoming values win for invitees the server
  // knows (invites upsert the team member, so a rename is authoritative).
  if (prev.invitedUsers?.length) {
    const known = new Set((incoming.invitedUsers ?? []).map(u => u.id));
    const lost = prev.invitedUsers.filter(u => !known.has(u.id));
    if (lost.length > 0) {
      merged.invitedUsers = [...(incoming.invitedUsers ?? []), ...lost];
      divergent = true;
    }
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
  const localSnapshotIds = (prev.closedActionsSnapshot ?? []).map(a => a.id).join(' ');
  const incomingSnapshotIds = (incoming.closedActionsSnapshot ?? []).map(a => a.id).join(' ');
  if (
    ownValueWins(
      ledger,
      ownKey.closedActionsSnapshot,
      localSnapshotIds === incomingSnapshotIds,
      now
    )
  ) {
    merged.closedActionsSnapshot = prev.closedActionsSnapshot;
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

const mergeRemoteHealthCheckSession = (
  incoming: HealthCheckSession,
  prev: HealthCheckSession | null,
  ctx: HealthCheckMergeContext
): { merged: HealthCheckSession; divergent: boolean } => {
  if (!prev) return { merged: incoming, divergent: false };

  const now = ctx.now ?? Date.now();
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

  return { merged, divergent };
};

export {
  mergeRemoteRetroSession,
  mergeRemoteHealthCheckSession,
  registerPendingCreation,
  registerOwnRetroChanges,
  registerOwnHealthCheckChanges,
  extendOwnChanges,
  scheduleSessionResend
};
