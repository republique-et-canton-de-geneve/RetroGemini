import { describe, it, expect } from 'vitest';
import {
  mergeRemoteRetroSession,
  registerOwnRetroChanges,
  OwnChangeLedger,
  PendingCreation
} from '../components/session/mergeRemoteSession';
import { RetroSession } from '../types';

// One participant, two browsers, one user id.
//
// Reported bug: during Discuss, clicking "Move On" in one browser made the
// facilitator's "N voted to move on" counter flicker between N and N-1 several
// times a second, and it only stopped once the participant had clicked in BOTH
// browsers. The two clients were re-sending their own contradictory view of the
// same user's vote through the server, forever.
//
// These tests run the real loop — the server's compare-and-swap, the broadcast
// to everyone else, the ack to the sender, and each client's merge + re-send —
// against the real merge, and assert the one property that was missing:
// **the exchange terminates**. A round cap is what makes the old behaviour fail
// here; an assertion on the final state alone would have passed mid-flicker.

const ME = 'me';
const OTHER = 'other';
const TOPIC = 'topic-1';

const makeSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 's1',
  teamId: 't1',
  name: 'Retro',
  date: '2026-01-01',
  status: 'IN_PROGRESS',
  phase: 'DISCUSS',
  participants: [],
  icebreakerQuestion: 'q',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 3,
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
  _rev: 1,
  ...overrides
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

interface Browser {
  name: string;
  userId: string;
  session: RetroSession;
  ownChanges: OwnChangeLedger;
  pendingCreations: Map<string, PendingCreation>;
}

/**
 * Two browsers of the same participant — plus one browser of a *different*
 * participant, so a genuine concurrent write can be modelled — talking to one
 * server, driven until the message queue drains. Mirrors the production path:
 * `updateSession` registers the own slices it changed and emits; the server
 * accepts a write only when its `_rev` matches and heals the sender otherwise;
 * a `divergent` merge schedules a re-send (`scheduleSessionResend`).
 */
const makeWorld = (initial: RetroSession) => {
  let server = clone(initial);
  const queue: { from: Browser; blob: RetroSession }[] = [];
  const accepted: RetroSession[] = [];

  const browsers: Browser[] = [
    { name: 'A', userId: ME },
    { name: 'B', userId: ME },
    { name: 'C', userId: OTHER }
  ].map(({ name, userId }) => ({
    name,
    userId,
    session: clone(initial),
    ownChanges: new Map(),
    pendingCreations: new Map()
  }));
  const [a, b, other] = browsers;

  const receive = (browser: Browser, incoming: RetroSession) => {
    const { merged, divergent } = mergeRemoteRetroSession(
      clone(incoming),
      browser.session,
      {
        currentUserId: browser.userId,
        preserveIcebreaker: false,
        editingTicketId: null,
        editingGroupId: null,
        ownChanges: browser.ownChanges
      },
      browser.pendingCreations
    );
    browser.session = merged;
    if (divergent) queue.push({ from: browser, blob: clone(merged) });
  };

  // What a session component's `updateSession` does: mutate, declare the own
  // slices that changed, emit.
  const act = (browser: Browser, updater: (session: RetroSession) => void) => {
    const before = browser.session;
    const after = clone(before);
    updater(after);
    registerOwnRetroChanges(browser.ownChanges, before, after, browser.userId);
    browser.session = after;
    queue.push({ from: browser, blob: clone(after) });
  };

  // Drain the queue, or give up. `maxRounds` is the assertion: the pre-fix
  // exchange never terminates.
  const settle = (maxRounds = 20) => {
    let rounds = 0;
    while (queue.length > 0) {
      if (++rounds > maxRounds) {
        throw new Error(
          `clients never converged: still exchanging after ${maxRounds} server writes ` +
            `(server rev ${server._rev}, votes ${JSON.stringify(server.discussionNextTopicVotes?.[TOPIC] ?? [])})`
        );
      }
      const message = queue.shift()!;
      if ((message.blob._rev ?? 0) !== (server._rev ?? 0)) {
        // Stale revision: rejected, and the sender is healed with the
        // authoritative state.
        receive(message.from, server);
        continue;
      }
      server = { ...message.blob, _rev: (server._rev ?? 0) + 1 };
      accepted.push(clone(server));
      for (const browser of browsers) {
        if (browser !== message.from) receive(browser, server);
      }
      // The sender gets no broadcast echo, only the ack, which syncService
      // synthesizes back as the blob it sent at its new revision.
      receive(message.from, server);
    }
    return rounds;
  };

  return {
    a,
    b,
    other,
    act,
    settle,
    // What the facilitator's counter renders on every accepted write.
    counterHistory: () => accepted.map(s => (s.discussionNextTopicVotes?.[TOPIC] ?? []).length),
    serverVoters: () => server.discussionNextTopicVotes?.[TOPIC] ?? []
  };
};

const toggleMoveOnFor = (userId: string) => (session: RetroSession) => {
  const votes = (session.discussionNextTopicVotes ??= {});
  const voters = (votes[TOPIC] ??= []);
  const at = voters.indexOf(userId);
  if (at > -1) voters.splice(at, 1);
  else voters.push(userId);
};

const voteMoveOn = toggleMoveOnFor(ME);

describe('the same participant connected from two browsers', () => {
  it('settles after a Move On click, and the second browser shows the vote', () => {
    const world = makeWorld(makeSession({ discussionNextTopicVotes: { [TOPIC]: [OTHER] } }));

    world.act(world.a, voteMoveOn);
    world.settle();

    expect(world.serverVoters()).toContain(ME);
    expect(world.a.session.discussionNextTopicVotes?.[TOPIC]).toContain(ME);
    // The point of the fix: the browser that did not click learns what the
    // participant did instead of undoing it.
    expect(world.b.session.discussionNextTopicVotes?.[TOPIC]).toContain(ME);
    // Nobody else's vote was collateral damage.
    expect(world.serverVoters()).toContain(OTHER);
  });

  it('never shows the facilitator the count going back down', () => {
    const world = makeWorld(makeSession({ discussionNextTopicVotes: { [TOPIC]: [] } }));

    world.act(world.a, voteMoveOn);
    world.settle();

    // The flicker was 1 → 0 → 1 → 0 …; one click is one increment.
    expect(world.counterHistory()).toEqual([1]);
  });

  it('settles when the participant then un-votes in the other browser', () => {
    const world = makeWorld(makeSession({ discussionNextTopicVotes: { [TOPIC]: [] } }));

    world.act(world.a, voteMoveOn);
    world.settle();
    world.act(world.b, voteMoveOn); // B now shows the vote, so this un-votes
    world.settle();

    expect(world.serverVoters()).not.toContain(ME);
    expect(world.a.session.discussionNextTopicVotes?.[TOPIC]).not.toContain(ME);
    expect(world.b.session.discussionNextTopicVotes?.[TOPIC]).not.toContain(ME);
    expect(world.counterHistory()).toEqual([1, 0]);
  });

  it('settles when both browsers click at the same time (one write loses the CAS)', () => {
    const world = makeWorld(makeSession({ discussionNextTopicVotes: { [TOPIC]: [] } }));

    // Both act before either write reaches the server: the second one is built
    // on a revision the server has already moved past.
    world.act(world.a, voteMoveOn);
    world.act(world.b, voteMoveOn);
    world.settle();

    expect(world.a.session.discussionNextTopicVotes?.[TOPIC]).toEqual(
      world.b.session.discussionNextTopicVotes?.[TOPIC]
    );
    expect(world.serverVoters()).toEqual(world.a.session.discussionNextTopicVotes?.[TOPIC]);
  });

  it('settles for the other own-data slices too (votes, happiness, finished)', () => {
    const world = makeWorld(
      makeSession({
        phase: 'VOTE',
        tickets: [{ id: 't1', colId: 'c1', text: 'idea', authorId: OTHER, groupId: null, votes: [] }]
      })
    );

    world.act(world.a, session => {
      session.tickets[0].votes.push(ME);
      session.happiness[ME] = 4;
      session.finishedUsers.push(ME);
    });
    world.settle();

    for (const browser of [world.a, world.b]) {
      expect(browser.session.tickets[0].votes).toEqual([ME]);
      expect(browser.session.happiness[ME]).toBe(4);
      expect(browser.session.finishedUsers).toEqual([ME]);
    }
  });

  // The behaviour the ledger gate must not break: when a write genuinely loses
  // the compare-and-swap, the healed snapshot arrives without the sender's own
  // action and it has to be re-applied and re-sent, or the click is lost with
  // nothing reporting a problem.
  it('still re-applies an own vote the server healed away after a lost CAS race', () => {
    const world = makeWorld(makeSession({ discussionNextTopicVotes: { [TOPIC]: [] } }));

    // Both built on revision 1; only the first to arrive can be accepted.
    world.act(world.a, voteMoveOn);
    world.act(world.other, toggleMoveOnFor(OTHER));
    world.settle();

    expect(world.serverVoters()).toContain(ME);
    expect(world.serverVoters()).toContain(OTHER);
    expect(world.a.session.discussionNextTopicVotes?.[TOPIC]).toContain(ME);
    expect(world.b.session.discussionNextTopicVotes?.[TOPIC]).toContain(ME);
  });

  it('re-applies own happiness healed away by another participant’s concurrent write', () => {
    const world = makeWorld(makeSession({ phase: 'CLOSE' }));

    world.act(world.a, session => {
      session.happiness[ME] = 5;
    });
    world.act(world.other, session => {
      session.happiness[OTHER] = 2;
    });
    world.settle();

    expect(world.a.session.happiness).toEqual({ [ME]: 5, [OTHER]: 2 });
    expect(world.b.session.happiness).toEqual({ [ME]: 5, [OTHER]: 2 });
    expect(world.other.session.happiness).toEqual({ [ME]: 5, [OTHER]: 2 });
  });
});
