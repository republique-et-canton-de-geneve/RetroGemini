import { RetroSession, HealthCheckSession, ActionItem } from '../../types';

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
  now?: number;
}

// Replace the current user's entries in a votes array with their local ones,
// leaving every other user's votes as the server reported them.
const mergeOwnVotes = (
  incomingVotes: string[],
  prevVotes: string[],
  userId: string
): { votes: string[]; changed: boolean } => {
  const ownPrev = prevVotes.filter(v => v === userId);
  const ownIncoming = incomingVotes.filter(v => v === userId);
  if (ownPrev.length === ownIncoming.length) {
    return { votes: incomingVotes, changed: false };
  }
  return {
    votes: [...incomingVotes.filter(v => v !== userId), ...ownPrev],
    changed: true
  };
};

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
  let divergent = false;
  const merged: RetroSession = { ...incoming };

  // --- Icebreaker question being edited by the facilitator (local-only draft;
  // never a reason to re-send).
  if (ctx.preserveIcebreaker) {
    merged.icebreakerQuestion = prev.icebreakerQuestion;
  }

  // --- Own happiness / ROTI votes.
  if (prev.happiness[userId] !== undefined) {
    if (incoming.happiness[userId] !== prev.happiness[userId]) divergent = true;
    merged.happiness = { ...incoming.happiness, [userId]: prev.happiness[userId] };
  }
  if (prev.roti[userId] !== undefined) {
    if (incoming.roti[userId] !== prev.roti[userId]) divergent = true;
    merged.roti = { ...incoming.roti, [userId]: prev.roti[userId] };
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

    if (preserveVotes) {
      const { votes, changed } = mergeOwnVotes(ticket.votes, prevTicket.votes, userId);
      if (changed) {
        divergent = true;
        next = { ...next, votes };
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

    if (preserveVotes) {
      const { votes, changed } = mergeOwnVotes(group.votes, prevGroup.votes, userId);
      if (changed) {
        divergent = true;
        next = { ...next, votes };
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
    if (ownVote === undefined) return action;
    if (action.proposalVotes?.[userId] === ownVote) return action;
    divergent = true;
    return { ...action, proposalVotes: { ...action.proposalVotes, [userId]: ownVote } };
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
  // the phase legitimately clears the list for everyone.
  if (
    incoming.phase === prev.phase &&
    (prev.finishedUsers ?? []).includes(userId) &&
    !(incoming.finishedUsers ?? []).includes(userId)
  ) {
    merged.finishedUsers = [...(incoming.finishedUsers ?? []), userId];
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

  // --- Own "discuss this next" votes (symmetric: local adds AND removals win
  // for the current user's own entry).
  if (prev.discussionNextTopicVotes || incoming.discussionNextTopicVotes) {
    const incomingMap = incoming.discussionNextTopicVotes ?? {};
    const prevMap = prev.discussionNextTopicVotes ?? {};
    let changed = false;
    const nextMap: Record<string, string[]> = { ...incomingMap };
    const topicIds = new Set([...Object.keys(incomingMap), ...Object.keys(prevMap)]);
    for (const topicId of topicIds) {
      const incomingVoters = incomingMap[topicId] ?? [];
      const prevVoters = prevMap[topicId] ?? [];
      const iVotedLocally = prevVoters.includes(userId);
      const iVoteRemotely = incomingVoters.includes(userId);
      if (iVotedLocally === iVoteRemotely) continue;
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

  return { merged, divergent };
};

export interface HealthCheckMergeContext {
  currentUserId: string;
}

const mergeRemoteHealthCheckSession = (
  incoming: HealthCheckSession,
  prev: HealthCheckSession | null,
  ctx: HealthCheckMergeContext
): { merged: HealthCheckSession; divergent: boolean } => {
  if (!prev) return { merged: incoming, divergent: false };

  const userId = ctx.currentUserId;
  let divergent = false;
  const merged: HealthCheckSession = { ...incoming };

  // --- Own ratings (per-dimension rating + comment), local values win.
  const prevOwnRatings = prev.ratings[userId];
  if (prevOwnRatings) {
    const incomingOwnRatings = incoming.ratings[userId] ?? {};
    const mergedOwnRatings = { ...incomingOwnRatings, ...prevOwnRatings };
    if (JSON.stringify(mergedOwnRatings) !== JSON.stringify(incomingOwnRatings)) {
      divergent = true;
    }
    merged.ratings = { ...incoming.ratings, [userId]: mergedOwnRatings };
  }

  // --- Own ROTI vote.
  if (prev.roti[userId] !== undefined) {
    if (incoming.roti[userId] !== prev.roti[userId]) divergent = true;
    merged.roti = { ...incoming.roti, [userId]: prev.roti[userId] };
  }

  // --- Own votes on action proposals (health checks share the ActionItem
  // proposal/vote model with retros).
  merged.actions = incoming.actions.map(action => {
    const prevAction = prev.actions.find(a => a.id === action.id);
    const ownVote = prevAction?.proposalVotes?.[userId];
    if (ownVote === undefined) return action;
    if (action.proposalVotes?.[userId] === ownVote) return action;
    divergent = true;
    return { ...action, proposalVotes: { ...action.proposalVotes, [userId]: ownVote } };
  });

  // --- Own "I'm finished" flag, phase-guarded like the retro merge.
  if (
    incoming.phase === prev.phase &&
    (prev.finishedUsers ?? []).includes(userId) &&
    !(incoming.finishedUsers ?? []).includes(userId)
  ) {
    merged.finishedUsers = [...(incoming.finishedUsers ?? []), userId];
    divergent = true;
  }

  return { merged, divergent };
};

export {
  mergeRemoteRetroSession,
  mergeRemoteHealthCheckSession,
  registerPendingCreation,
  scheduleSessionResend
};
