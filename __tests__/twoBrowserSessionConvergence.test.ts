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
const ACTION = 'action-1';

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
  // syncService's queue of emitted-but-unanswered blobs, so an ack can be
  // answered with the content the server actually accepted.
  outgoing: RetroSession[];
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
    pendingCreations: new Map(),
    outgoing: [] as RetroSession[]
  }));
  const [a, b, other] = browsers;

  // syncService.updateSession: stamp with the revision the blob was built on,
  // remember it until answered, emit.
  const send = (browser: Browser, blob: RetroSession) => {
    const stamped = clone(blob);
    browser.outgoing.push(stamped);
    queue.push({ from: browser, blob: clone(stamped) });
  };

  // syncService's `session-ack` handler: an ack at revision R answers the
  // oldest blob stamped R-1, and that blob — not the server's current state —
  // is what is synthesized back to the sender, which receives no broadcast
  // echo of its own write.
  const ack = (browser: Browser, rev: number) => {
    const index = browser.outgoing.findIndex(blob => (blob._rev ?? 0) === rev - 1);
    if (index === -1) return;
    const acked = browser.outgoing[index];
    browser.outgoing = browser.outgoing.slice(index + 1);
    receive(browser, { ...acked, _rev: rev });
  };

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
    if (divergent) send(browser, merged);
  };

  // What a session component's `updateSession` does: mutate, declare the own
  // slices that changed, emit.
  const act = (browser: Browser, updater: (session: RetroSession) => void) => {
    const before = browser.session;
    const after = clone(before);
    updater(after);
    registerOwnRetroChanges(browser.ownChanges, before, after, browser.userId);
    browser.session = after;
    send(browser, after);
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
      // The sender gets no broadcast echo, only the ack.
      ack(message.from, server._rev ?? 0);
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
    serverVoters: () => server.discussionNextTopicVotes?.[TOPIC] ?? [],
    serverHappiness: () => server.happiness ?? {},
    serverImpact: () => server.actionImpactVotes?.[ACTION] ?? {},
    // What the facilitator sees under "N rated" on every accepted write: the
    // number that would flicker if the two browsers fought over one vote.
    impactCountHistory: () =>
      accepted.map(s => Object.keys(s.actionImpactVotes?.[ACTION] ?? {}).length)
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

  // Regression (Codex review on PR #456): two edits to the SAME own slice
  // before either is answered. Both are stamped with the revision they were
  // built on, so only the first can be accepted; the second is rejected and
  // healed to the first value. The user's latest edit survives only because the
  // ack for the first write synthesizes the FIRST blob — attributing it to the
  // newest blob in flight told the client its second write had landed, dropped
  // the claim protecting it, and lost the edit with nothing reporting a
  // problem. Guarded here end-to-end and in syncService.test.ts at the source.
  it('keeps the later of two edits made to one slice before either is answered', () => {
    const world = makeWorld(makeSession({ phase: 'CLOSE' }));

    world.act(world.a, session => {
      session.happiness[ME] = 4;
    });
    world.act(world.a, session => {
      session.happiness[ME] = 5;
    });
    world.settle();

    expect(world.serverHappiness()[ME]).toBe(5);
    expect(world.a.session.happiness[ME]).toBe(5);
    expect(world.b.session.happiness[ME]).toBe(5);
  });

  it('keeps the later of two move-on toggles made before either is answered', () => {
    const world = makeWorld(makeSession({ discussionNextTopicVotes: { [TOPIC]: [] } }));

    world.act(world.a, voteMoveOn); // on
    world.act(world.a, voteMoveOn); // off again, before the first is answered
    world.settle();

    expect(world.serverVoters()).not.toContain(ME);
    expect(world.a.session.discussionNextTopicVotes?.[TOPIC]).not.toContain(ME);
    expect(world.b.session.discussionNextTopicVotes?.[TOPIC]).not.toContain(ME);
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

// Impact ratings are the newest symmetric own-data slice — clearing your own
// rating wins locally exactly as setting it does — which is the precise shape
// that produced the Move On flicker. Everything above is re-run for it, because
// "we added the gate" is not evidence that the exchange terminates.
describe('the same participant rating a closed action from two browsers', () => {
  const openActionsRound = (votes: Record<string, Record<string, 1 | 2 | 3 | 'abstain'>> = {}) =>
    makeSession({
      phase: 'OPEN_ACTIONS',
      closedActionsSnapshot: [
        { id: ACTION, text: 'Pair on deploys', assigneeId: null, done: true, type: 'new', proposalVotes: {} }
      ],
      actionImpactVotes: votes
    });

  const rate = (userId: string, vote: 1 | 2 | 3 | 'abstain' | null) => (session: RetroSession) => {
    const all = (session.actionImpactVotes ??= {});
    const forAction = (all[ACTION] ??= {});
    if (vote === null) delete forAction[userId];
    else forAction[userId] = vote;
  };

  it('settles after a rating, and the second browser shows it', () => {
    const world = makeWorld(openActionsRound({ [ACTION]: { [OTHER]: 1 } }));

    world.act(world.a, rate(ME, 3));
    world.settle();

    expect(world.serverImpact()).toEqual({ [OTHER]: 1, [ME]: 3 });
    // The browser that did not click learns what the participant said rather
    // than undoing it.
    expect(world.b.session.actionImpactVotes?.[ACTION]?.[ME]).toBe(3);
  });

  it('never shows the facilitator the rated count going back down', () => {
    const world = makeWorld(openActionsRound({ [ACTION]: {} }));

    world.act(world.a, rate(ME, 2));
    world.settle();

    expect(world.impactCountHistory()).toEqual([1]);
  });

  it('settles when the participant changes their mind in the other browser', () => {
    const world = makeWorld(openActionsRound({ [ACTION]: {} }));

    world.act(world.a, rate(ME, 1));
    world.settle();
    world.act(world.b, rate(ME, 3));
    world.settle();

    expect(world.serverImpact()[ME]).toBe(3);
    expect(world.a.session.actionImpactVotes?.[ACTION]?.[ME]).toBe(3);
    expect(world.b.session.actionImpactVotes?.[ACTION]?.[ME]).toBe(3);
  });

  it('settles when the participant clears their rating in the other browser', () => {
    const world = makeWorld(openActionsRound({ [ACTION]: {} }));

    world.act(world.a, rate(ME, 2));
    world.settle();
    world.act(world.b, rate(ME, null));
    world.settle();

    expect(world.serverImpact()[ME]).toBeUndefined();
    expect(world.a.session.actionImpactVotes?.[ACTION]?.[ME]).toBeUndefined();
    expect(world.b.session.actionImpactVotes?.[ACTION]?.[ME]).toBeUndefined();
    expect(world.impactCountHistory()).toEqual([1, 0]);
  });

  it('settles when both browsers rate at the same time', () => {
    const world = makeWorld(openActionsRound({ [ACTION]: {} }));

    world.act(world.a, rate(ME, 1));
    world.act(world.b, rate(ME, 3));
    world.settle();

    expect(world.a.session.actionImpactVotes?.[ACTION]).toEqual(
      world.b.session.actionImpactVotes?.[ACTION]
    );
    expect(world.serverImpact()).toEqual(world.a.session.actionImpactVotes?.[ACTION]);
  });

  it('re-applies an own rating the server healed away after a lost CAS race', () => {
    const world = makeWorld(openActionsRound({ [ACTION]: {} }));

    world.act(world.a, rate(ME, 3));
    world.act(world.other, rate(OTHER, 1));
    world.settle();

    expect(world.serverImpact()).toEqual({ [ME]: 3, [OTHER]: 1 });
    expect(world.a.session.actionImpactVotes?.[ACTION]).toEqual({ [ME]: 3, [OTHER]: 1 });
    expect(world.b.session.actionImpactVotes?.[ACTION]).toEqual({ [ME]: 3, [OTHER]: 1 });
  });

  it('keeps the later of two ratings made before either is answered', () => {
    const world = makeWorld(openActionsRound({ [ACTION]: {} }));

    world.act(world.a, rate(ME, 1));
    world.act(world.a, rate(ME, 3));
    world.settle();

    expect(world.serverImpact()[ME]).toBe(3);
    expect(world.a.session.actionImpactVotes?.[ACTION]?.[ME]).toBe(3);
    expect(world.b.session.actionImpactVotes?.[ACTION]?.[ME]).toBe(3);
  });

  it('keeps an abstention, which is a cast vote and not a missing one', () => {
    const world = makeWorld(openActionsRound({ [ACTION]: {} }));

    world.act(world.a, rate(ME, 'abstain'));
    world.settle();

    expect(world.serverImpact()[ME]).toBe('abstain');
    expect(world.b.session.actionImpactVotes?.[ACTION]?.[ME]).toBe('abstain');
  });

  // The snapshot is add-only within a session: an action lost from an incoming
  // blob was a healed write race, never a removal. Dropping it mid-round would
  // discard the votes already cast on it.
  it('re-adds a closed-action row a healed snapshot lost', () => {
    const world = makeWorld(openActionsRound({ [ACTION]: {} }));

    world.act(world.a, session => {
      session.closedActionsSnapshot = [
        ...(session.closedActionsSnapshot ?? []),
        { id: 'action-2', text: 'Split the pipeline', assigneeId: null, done: true, type: 'new', proposalVotes: {} }
      ];
    });
    world.act(world.other, session => {
      session.roti[OTHER] = 4;
    });
    world.settle();

    for (const browser of [world.a, world.b, world.other]) {
      expect(browser.session.closedActionsSnapshot?.map(entry => entry.id))
        .toEqual(expect.arrayContaining([ACTION, 'action-2']));
    }
  });
});
