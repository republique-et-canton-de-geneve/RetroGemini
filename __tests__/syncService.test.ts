import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (payload?: unknown) => void;
const handlers: Record<string, Handler[]> = {};
const emit = vi.fn();
const disconnect = vi.fn();
const socketConnect = vi.fn();
let connected = false;
// socket.io's `active`: true while the socket will reconnect on its own (a
// transport drop), false once nothing will (a server-side kick, a manual
// disconnect).
let active = true;
// Events of the socket's Manager (`socket.io`), where `reconnect_failed` lives.
const managerHandlers: Record<string, Handler[]> = {};
// How many sockets syncService has opened: the single-socket rule is pinned on
// this, since a second `io()` is a second live connection writing under the
// same listeners.
const ioCalls = { count: 0 };

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    ioCalls.count += 1;
    return {
      emit,
      disconnect,
      connect: socketConnect,
      on: (event: string, cb: Handler) => {
        handlers[event] = handlers[event] || [];
        handlers[event].push(cb);
      },
      io: {
        on: (event: string, cb: Handler) => {
          managerHandlers[event] = managerHandlers[event] || [];
          managerHandlers[event].push(cb);
        },
      },
      get connected() {
        return connected;
      },
      get active() {
        return active;
      },
    };
  }),
}));

// Socket joins carry the team session token (audit H1). syncService reads it
// from dataService at emit time, so the mock is what decides which credential
// each join presents.
let currentToken: string | null = null;
vi.mock('../services/dataService', () => ({
  getTeamSessionToken: () => currentToken,
}));

const trigger = (event: string, payload?: unknown) => {
  (handlers[event] || []).forEach(cb => cb(payload));
};

describe('syncService', () => {
  let service: typeof import('../services/syncService').syncService;

  beforeEach(async () => {
    connected = false;
    active = true;
    currentToken = 'rg1.team-session-token';
    Object.keys(handlers).forEach(k => delete handlers[k]);
    Object.keys(managerHandlers).forEach(k => delete managerHandlers[k]);
    emit.mockClear();
    disconnect.mockClear();
    socketConnect.mockClear();
    ioCalls.count = 0;
    vi.resetModules();
    service = (await import('../services/syncService')).syncService;
  });

  it('queues join when socket is not yet connected and flushes on connect', async () => {
    const joinPromise = service.connect();
    service.joinSession('s1', 'u1', 'Alice');
    expect(emit).not.toHaveBeenCalled();
    connected = true;
    trigger('connect');
    await joinPromise;
    expect(emit).toHaveBeenCalledWith('join-session', {
      sessionId: 's1',
      userId: 'u1',
      userName: 'Alice',
      sessionToken: 'rg1.team-session-token',
      joinId: expect.any(String)
    });
  });

  it('broadcasts a session update once connected and joined', async () => {
    const session = { id: 's1', phase: 'DISCUSS', status: 'IN_PROGRESS' } as any;
    const connection = service.connect();
    connected = true;
    trigger('connect');
    await connection;

    // Joined first: a write on a socket that never joined is dropped by the
    // server, so it is held until the join instead (see "join before write").
    service.joinSession('s1', 'u1', 'Alice');
    service.updateSession(session);
    // Outgoing updates are stamped with the latest known revision (0 here).
    expect(emit).toHaveBeenCalledWith('update-session', { ...session, _rev: 0 });
  });

  it('stamps outgoing updates with the revision of the state they were built on', async () => {
    const connection = service.connect();
    connected = true;
    trigger('connect');
    await connection;

    service.joinSession('s1', 'u1', 'Alice');
    emit.mockClear();

    // A newer revision has been seen (own ack at rev 5), but the outgoing blob
    // was built on rev 3. Raising the stamp would let stale CONTENT overwrite
    // newer state on the server (the compare-and-swap only checks the number),
    // so the stamp must stay honest: the server rejects it and heals us, and
    // the merge + resend path recovers our own data without losing anyone
    // else's.
    trigger('session-ack', { sessionId: 's1', rev: 5 });
    service.updateSession({ id: 's1', phase: 'DISCUSS', status: 'IN_PROGRESS', _rev: 3 } as any);
    expect(emit).toHaveBeenCalledWith('update-session', expect.objectContaining({ _rev: 3 }));
  });

  it('synthesizes a session update to the app when the server acks a write', async () => {
    const connection = service.connect();
    connected = true;
    trigger('connect');
    await connection;

    service.joinSession('s1', 'u1', 'Alice');
    const received: any[] = [];
    service.onSessionUpdate(s => received.push(s));

    const blob = { id: 's1', phase: 'VOTE', status: 'IN_PROGRESS', _rev: 4 } as any;
    service.updateSession(blob);
    trigger('session-ack', { sessionId: 's1', rev: 5 });

    // The app learns that its own blob is now the authoritative state at the
    // new revision, keeping the React session _rev current so the next write
    // is stamped correctly.
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ id: 's1', phase: 'VOTE', _rev: 5 });
  });

  // Regression: `lastOutgoing` used to hold only the most recent blob, so when
  // two writes were in flight the ack for the FIRST synthesized the SECOND at
  // the accepted revision. The app was then told the server held content it had
  // never accepted, and the merge read that as "my write landed" and dropped
  // the own-change claim protecting it. The second write was then rejected as
  // stale and healed to the first value, with nothing left to re-apply — the
  // user's latest action silently lost.
  it('synthesizes the blob the ack actually accepted, not the newest one in flight', async () => {
    const connection = service.connect();
    connected = true;
    trigger('connect');
    await connection;

    service.joinSession('s1', 'u1', 'Alice');
    const received: any[] = [];
    service.onSessionUpdate(s => received.push(s));

    // Two edits before either answer comes back: both are built on rev 4, so
    // only the first can pass the server's compare-and-swap.
    service.updateSession({ id: 's1', phase: 'VOTE', status: 'IN_PROGRESS', _rev: 4 } as any);
    service.updateSession({ id: 's1', phase: 'DISCUSS', status: 'IN_PROGRESS', _rev: 4 } as any);

    trigger('session-ack', { sessionId: 's1', rev: 5 });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ phase: 'VOTE', _rev: 5 });
  });

  it('synthesizes each acked blob in turn when writes are pipelined', async () => {
    const connection = service.connect();
    connected = true;
    trigger('connect');
    await connection;

    service.joinSession('s1', 'u1', 'Alice');
    const received: any[] = [];
    service.onSessionUpdate(s => received.push(s));

    // Built on successive revisions, so both are accepted in order.
    service.updateSession({ id: 's1', phase: 'VOTE', status: 'IN_PROGRESS', _rev: 4 } as any);
    service.updateSession({ id: 's1', phase: 'DISCUSS', status: 'IN_PROGRESS', _rev: 5 } as any);

    trigger('session-ack', { sessionId: 's1', rev: 5 });
    trigger('session-ack', { sessionId: 's1', rev: 6 });

    expect(received.map(s => [s.phase, s._rev])).toEqual([
      ['VOTE', 5],
      ['DISCUSS', 6]
    ]);
  });

  it('does not synthesize an acked state older than an already delivered update', async () => {
    const connection = service.connect();
    connected = true;
    trigger('connect');
    await connection;

    service.joinSession('s1', 'u1', 'Alice');
    const received: any[] = [];
    service.onSessionUpdate(s => received.push(s));

    service.updateSession({ id: 's1', phase: 'VOTE', status: 'IN_PROGRESS', _rev: 4 } as any);
    // A newer broadcast (rev 9) arrives before our ack (rev 5): synthesizing
    // the acked blob would hand the app older content and fork its state back
    // in time.
    trigger('session-update', { id: 's1', phase: 'DISCUSS', status: 'IN_PROGRESS', _rev: 9 });
    trigger('session-ack', { sessionId: 's1', rev: 5 });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ _rev: 9 });
  });

  it('ignores an ack meant for a different session', async () => {
    const connection = service.connect();
    connected = true;
    trigger('connect');
    await connection;

    service.joinSession('s1', 'u1', 'Alice');
    const received: any[] = [];
    service.onSessionUpdate(s => received.push(s));
    emit.mockClear();

    service.updateSession({ id: 's1', phase: 'DISCUSS', status: 'IN_PROGRESS', _rev: 2 } as any);
    // Ack for another session: no synthesized state for this one.
    trigger('session-ack', { sessionId: 'other', rev: 42 });
    expect(received).toHaveLength(0);
    expect(emit).toHaveBeenCalledWith('update-session', expect.objectContaining({ _rev: 2 }));
  });

  it('registers and cleans callbacks for roster and member events', async () => {
    const connection = service.connect();
    connected = true;
    trigger('connect');
    await connection;

    const joins: string[] = [];
    const leaves: string[] = [];
    const roster: string[][] = [];
    const stopJoin = service.onMemberJoined(({ userName }) => joins.push(userName));
    const stopLeft = service.onMemberLeft(({ userName }) => leaves.push(userName));
    const stopRoster = service.onRoster(data => roster.push(data.map(d => d.name)));

    trigger('member-joined', { userName: 'Alice', userId: '1' });
    trigger('member-left', { userName: 'Bob', userId: '2' });
    trigger('member-roster', [{ id: '1', name: 'Alice' }]);

    expect(joins).toEqual(['Alice']);
    expect(leaves).toEqual(['Bob']);
    expect(roster).toEqual([['Alice']]);

    stopJoin();
    stopLeft();
    stopRoster();
    trigger('member-joined', { userName: 'Ignored', userId: '3' });
    expect(joins).toEqual(['Alice']);
  });

  it('broadcasts and receives ephemeral typing activity', async () => {
    const connection = service.connect();
    connected = true;
    trigger('connect');
    await connection;

    const received: Array<{ userId: string; activity: string | null }> = [];
    const stop = service.onActivity(({ userId, activity }) => received.push({ userId, activity }));

    service.sendActivity('brainstorm');
    expect(emit).toHaveBeenCalledWith('participant-activity', { activity: 'brainstorm' });

    service.sendActivity(null);
    expect(emit).toHaveBeenCalledWith('participant-activity', { activity: null });

    trigger('participant-activity', { userId: 'u9', userName: 'Zoe', activity: 'proposal' });
    expect(received).toEqual([{ userId: 'u9', activity: 'proposal' }]);

    stop();
    trigger('participant-activity', { userId: 'u9', userName: 'Zoe', activity: null });
    expect(received).toHaveLength(1);
  });

  it('drops typing activity silently when offline', async () => {
    service.connect();
    // never mark connected
    service.sendActivity('brainstorm');
    expect(emit).not.toHaveBeenCalledWith('participant-activity', expect.anything());
  });

  it('notifies subscribers when the connection goes up and down', async () => {
    const states: boolean[] = [];
    const stop = service.onConnectionChange(s => states.push(s));

    const connection = service.connect();
    connected = true;
    trigger('connect');
    await connection;
    expect(states).toEqual([true]);

    connected = false;
    trigger('disconnect');
    expect(states).toEqual([true, false]);

    stop();
    trigger('connect');
    expect(states).toEqual([true, false]);
  });

  it('handles leave and disconnect lifecycle', async () => {
    const connection = service.connect();
    connected = true;
    trigger('connect');
    await connection;

    service.joinSession('s1', 'u1', 'Alice');
    expect(service.getCurrentSessionId()).toBe('s1');
    service.leaveSession();
    expect(emit).toHaveBeenCalledWith('leave-session', { sessionId: 's1' });

    service.disconnect();
    expect(disconnect).toHaveBeenCalled();
    expect(service.isConnected()).toBe(false);
  });

  it('carries the team credential on the automatic re-join after a reconnect', async () => {
    // The zero-downtime path: a pod restart drops the socket and syncService
    // re-joins on its own. Without the credential the server (audit H1) would
    // refuse that re-join and the participant would silently fall out of a
    // live retrospective.
    const joinPromise = service.connect();
    connected = true;
    trigger('connect');
    await joinPromise;
    service.joinSession('s1', 'u1', 'Alice');
    emit.mockClear();

    trigger('disconnect');
    trigger('connect');

    expect(emit).toHaveBeenCalledWith('join-session', expect.objectContaining({
      sessionId: 's1',
      sessionToken: 'rg1.team-session-token'
    }));
  });

  it('re-reads the credential at emit time, so a re-login is picked up', async () => {
    const joinPromise = service.connect();
    connected = true;
    trigger('connect');
    await joinPromise;
    service.joinSession('s1', 'u1', 'Alice');

    // User logs in again and the stored token is replaced.
    currentToken = 'rg1.a-fresher-token';
    emit.mockClear();
    trigger('disconnect');
    trigger('connect');

    expect(emit).toHaveBeenCalledWith('join-session', expect.objectContaining({
      sessionToken: 'rg1.a-fresher-token'
    }));
  });

  it('omits the credential key entirely when no token is held', async () => {
    currentToken = null;
    const joinPromise = service.connect();
    connected = true;
    trigger('connect');
    await joinPromise;
    service.joinSession('s1', 'u1', 'Alice');

    expect(emit).toHaveBeenCalledWith('join-session', {
      sessionId: 's1',
      userId: 'u1',
      userName: 'Alice',
      sessionToken: undefined,
      joinId: expect.any(String)
    });
  });

  it('notifies subscribers when the server denies the join', async () => {
    const denials: { sessionId: string; reason: string }[] = [];
    service.onJoinDenied((data) => denials.push(data));

    const joinPromise = service.connect();
    connected = true;
    trigger('connect');
    await joinPromise;

    trigger('join-denied', { sessionId: 's1', reason: 'unauthenticated' });

    expect(denials).toEqual([{ sessionId: 's1', reason: 'unauthenticated' }]);
  });

  // The order of what one connection emits, reduced to the two events that
  // matter here: a write is only ever meaningful behind a join.
  const emittedOrder = () =>
    emit.mock.calls
      .filter(([event]) => event === 'join-session' || event === 'update-session')
      .map(([event, payload]) => {
        const p = payload as { sessionId?: string; id?: string };
        return [event, p.sessionId ?? p.id];
      });

  const connectNow = async () => {
    const connection = service.connect();
    connected = true;
    trigger('connect');
    await connection;
  };

  // Incident ISS (2026-10-12). On a fresh page load Session.tsx used to await
  // `connect()` before it called `joinSession`, and a write made meanwhile (the
  // presence write) was queued. The connect handler flushed it at once, on a
  // socket that had joined nothing, and the server dropped it with a log line
  // and no answer at all — so the client never learnt it was lost. The screens
  // no longer wait for the connection, but any write made before the join is
  // still held by the service, which is what these tests pin.
  describe('join before write', () => {
    it('holds a write queued before the first join and sends it right behind the join', async () => {
      const connection = service.connect();
      service.updateSession({ id: 's1', phase: 'BRAINSTORM', status: 'IN_PROGRESS', _rev: 2 } as any);

      connected = true;
      trigger('connect');
      await connection;
      // No join target yet: nothing may be written on this connection.
      expect(emittedOrder()).toEqual([]);

      service.joinSession('s1', 'u1', 'Alice');
      expect(emittedOrder()).toEqual([
        ['join-session', 's1'],
        ['update-session', 's1']
      ]);
    });

    it('flushes a write queued while connecting only after the pending join', () => {
      service.joinSession('s1', 'u1', 'Alice');
      service.updateSession({ id: 's1', phase: 'BRAINSTORM', status: 'IN_PROGRESS', _rev: 2 } as any);

      connected = true;
      trigger('connect');

      expect(emittedOrder()).toEqual([
        ['join-session', 's1'],
        ['update-session', 's1']
      ]);
    });

    it('re-joins before flushing a write queued while offline (rolling update)', async () => {
      await connectNow();
      service.joinSession('s1', 'u1', 'Alice');
      emit.mockClear();

      connected = false;
      trigger('disconnect');
      service.updateSession({ id: 's1', phase: 'VOTE', status: 'IN_PROGRESS', _rev: 7 } as any);
      expect(emittedOrder()).toEqual([]);

      connected = true;
      trigger('connect');

      expect(emittedOrder()).toEqual([
        ['join-session', 's1'],
        ['update-session', 's1']
      ]);
    });

    it('drops a queued write that belongs to another session instead of sending it after the join', async () => {
      const connection = service.connect();
      service.updateSession({ id: 'old', phase: 'VOTE', status: 'IN_PROGRESS', _rev: 3 } as any);
      connected = true;
      trigger('connect');
      await connection;

      service.joinSession('s1', 'u1', 'Alice');
      expect(emittedOrder()).toEqual([['join-session', 's1']]);

      // And it is gone for good, not waiting for a later join of its session.
      service.joinSession('old', 'u1', 'Alice');
      expect(emittedOrder()).toEqual([['join-session', 's1'], ['join-session', 'old']]);
    });

    it('holds a write made on a connected socket that has not joined that session yet', async () => {
      await connectNow();

      service.updateSession({ id: 's1', phase: 'BRAINSTORM', status: 'IN_PROGRESS', _rev: 1 } as any);
      expect(emittedOrder()).toEqual([]);

      service.joinSession('s1', 'u1', 'Alice');
      expect(emittedOrder()).toEqual([
        ['join-session', 's1'],
        ['update-session', 's1']
      ]);
    });
  });

  // `connect()` after a disconnect used to call `io()` again while the first
  // socket was still auto-reconnecting with the same listeners attached: two
  // live connections, both writing through whichever one `this.socket` named
  // last, and every event delivered twice once both were up.
  describe('a single socket', () => {
    it('reuses the existing socket after a transport drop instead of opening a second one', async () => {
      await connectNow();
      service.joinSession('s1', 'u1', 'Alice');
      expect(ioCalls.count).toBe(1);

      // A transport drop: socket.io is already reconnecting this socket.
      connected = false;
      trigger('disconnect');
      // An edit while offline asks for a connection.
      service.updateSession({ id: 's1', phase: 'VOTE', status: 'IN_PROGRESS', _rev: 1 } as any);
      void service.connect();

      expect(ioCalls.count).toBe(1);
      // Nothing to kick: a second open while one is in flight would send a
      // second namespace CONNECT on the same engine connection.
      expect(socketConnect).not.toHaveBeenCalled();
      // Listeners are registered once: one connect handler, one update handler.
      expect(handlers['connect']).toHaveLength(1);
      expect(handlers['session-update']).toHaveLength(1);

      // The reconnect brings back exactly one join and one write.
      connected = true;
      trigger('connect');
      expect(emittedOrder().slice(-2)).toEqual([
        ['join-session', 's1'],
        ['update-session', 's1']
      ]);
      expect(emit.mock.calls.filter(([event]) => event === 'update-session')).toHaveLength(1);
    });

    it('re-opens the same socket when nothing will reconnect it on its own', async () => {
      await connectNow();

      // A server-side kick: socket.io does not reconnect after it.
      connected = false;
      active = false;
      trigger('disconnect');
      void service.connect();

      expect(ioCalls.count).toBe(1);
      expect(socketConnect).toHaveBeenCalledTimes(1);
    });

    it('re-opens the same socket once its reconnection attempts are exhausted', async () => {
      await connectNow();
      connected = false;
      trigger('disconnect');
      const waiting = service.connect();
      expect(socketConnect).not.toHaveBeenCalled();

      // `active` stays true after the Manager gives up, so it cannot be the
      // only signal: without this the client stayed offline until a reload.
      (managerHandlers['reconnect_failed'] || []).forEach(cb => cb());
      void service.connect();
      expect(socketConnect).toHaveBeenCalledTimes(1);
      expect(ioCalls.count).toBe(1);

      connected = true;
      trigger('connect');
      await expect(waiting).resolves.toBeUndefined();
    });

    it('resolves connect() on the next connect event of the reused socket', async () => {
      await connectNow();
      connected = false;
      trigger('disconnect');

      let resolved = false;
      const reconnecting = service.connect().then(() => { resolved = true; });
      await Promise.resolve();
      expect(resolved).toBe(false);

      connected = true;
      trigger('connect');
      await reconnecting;
      expect(resolved).toBe(true);
    });

    it('opens a fresh socket after an explicit disconnect()', async () => {
      await connectNow();
      service.disconnect();
      connected = false;

      void service.connect();
      expect(ioCalls.count).toBe(2);
    });
  });

  // The contract the server keeps when it restores a participant's
  // facilitator-only fields: it sends the saved blob to the sender, THEN the
  // ack at the same revision. The app must see the server's blob exactly once
  // — never the outgoing one, which still carries the fields the server put
  // back.
  it('delivers the server blob once when a heal and an ack arrive at the same revision', async () => {
    await connectNow();
    service.joinSession('s1', 'u1', 'Alice');
    const received: any[] = [];
    service.onSessionUpdate(s => received.push(s));

    service.updateSession({ id: 's1', name: 'Old name', phase: 'BRAINSTORM', status: 'IN_PROGRESS', _rev: 4 } as any);
    trigger('session-update', { id: 's1', name: 'New name', phase: 'BRAINSTORM', status: 'IN_PROGRESS', _rev: 5 });
    trigger('session-ack', { sessionId: 's1', rev: 5 });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ name: 'New name', _rev: 5 });
  });

  describe('refused writes', () => {
    let clock = 1_000_000;

    beforeEach(() => {
      clock = 1_000_000;
      vi.spyOn(Date, 'now').mockImplementation(() => clock);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const refuse = (payload: Record<string, unknown>) => trigger('session-update-refused', payload);

    it('reports refusals of the current session, and of no named session, to subscribers', async () => {
      await connectNow();
      service.joinSession('s1', 'u1', 'Alice');
      const refusals: unknown[] = [];
      const stop = service.onUpdateRefused(r => refusals.push(r));

      refuse({ sessionId: 's1', reason: 'protected-fields', fields: ['name'], rev: 4 });
      refuse({ sessionId: null, reason: 'not-joined' });
      refuse({ sessionId: 'other', reason: 'stale' });

      expect(refusals).toEqual([
        { sessionId: 's1', reason: 'protected-fields', fields: ['name'], rev: 4 },
        { sessionId: null, reason: 'not-joined' }
      ]);

      stop();
      refuse({ sessionId: 's1', reason: 'stale' });
      expect(refusals).toHaveLength(2);
    });

    it('ignores refusals while no session is joined, and malformed payloads', async () => {
      await connectNow();
      const refusals: unknown[] = [];
      service.onUpdateRefused(r => refusals.push(r));

      refuse({ sessionId: null, reason: 'not-joined' });
      service.joinSession('s1', 'u1', 'Alice');
      expect(() => trigger('session-update-refused', undefined)).not.toThrow();
      expect(() => trigger('session-update-refused', 'nonsense')).not.toThrow();
      refuse({ sessionId: 's1' });

      expect(refusals).toEqual([]);
      expect(service.getResendDelayMs()).toBe(0);
    });

    // Re-sends are what the stall is counted on, not refusals (see the
    // regression below). A re-send is a write the session merge made because
    // it found the user's own data missing from the server.
    const resend = (rev = 4) =>
      service.updateSession({ id: 's1', phase: 'BRAINSTORM', status: 'IN_PROGRESS', _rev: rev } as any, { resend: true });

    it('backs re-sends off exponentially from the fifth consecutive re-send, capped at 5 s', async () => {
      await connectNow();
      service.joinSession('s1', 'u1', 'Alice');

      const delays: number[] = [];
      for (let i = 0; i < 10; i++) {
        resend();
        refuse({ sessionId: 's1', reason: 'stale' });
        delays.push(service.getResendDelayMs());
      }
      expect(delays).toEqual([0, 0, 0, 0, 400, 800, 1600, 3200, 5000, 5000]);

      // Any ack means writes land again.
      trigger('session-ack', { sessionId: 's1', rev: 12 });
      expect(service.getResendDelayMs()).toBe(0);
    });

    it('never backs off for refusals alone: a lost race needs no re-send to wait for', async () => {
      await connectNow();
      service.joinSession('s1', 'u1', 'Alice');

      for (let i = 0; i < 10; i++) refuse({ sessionId: 's1', reason: 'stale' });

      expect(service.getResendDelayMs()).toBe(0);
    });

    // Review finding on the ISS branch. Every client writes the timer expiry,
    // the member-joined upsert and the leftUsers clear at the same instant, so
    // N-1 of them lose the race, are refused 'stale' and healed — and need no
    // re-send, because nothing of theirs is missing. A passive participant
    // never writes anything that is acked, so counting refusals put "Your
    // changes are not being saved" in front of someone with nothing unsaved,
    // pushing them to reload a session that was working.
    it('stays ok for a client refused twenty times over a minute that never re-sends', async () => {
      await connectNow();
      service.joinSession('s1', 'u1', 'Alice');
      const health: string[] = [];
      service.onSyncHealth(h => health.push(h));

      for (let i = 0; i < 20; i++) {
        service.updateSession({ id: 's1', phase: 'BRAINSTORM', status: 'IN_PROGRESS', _rev: i } as any);
        refuse({ sessionId: 's1', reason: 'stale' });
        clock += 3_000;
      }

      expect(service.getSyncHealth()).toBe('ok');
      expect(health).toEqual([]);
      expect(service.getResendDelayMs()).toBe(0);
    });

    // The incident's loop: the merge finds the user's cards missing, re-sends,
    // the server refuses, heals, and the merge re-sends again, about three
    // times a second.
    it('reports a stall once re-sends keep being refused for ten seconds, and recovers on the next ack', async () => {
      await connectNow();
      service.joinSession('s1', 'u1', 'Alice');
      const health: string[] = [];
      service.onSyncHealth(h => health.push(h));

      // A burst of re-sends is an ordinary race, not a stall.
      while (clock < 1_000_000 + 9_700) {
        resend();
        refuse({ sessionId: 's1', reason: 'stale' });
        clock += 300;
      }
      expect(service.getSyncHealth()).toBe('ok');

      // Still re-sending ten seconds after the first: nothing is being saved.
      clock = 1_000_000 + 10_000;
      resend();
      expect(service.getSyncHealth()).toBe('stalled');
      refuse({ sessionId: 's1', reason: 'stale' });
      resend();
      // Fired on change only.
      expect(health).toEqual(['stalled']);

      trigger('session-ack', { sessionId: 's1', rev: 30 });
      expect(service.getSyncHealth()).toBe('ok');
      expect(health).toEqual(['stalled', 'ok']);
      expect(service.getResendDelayMs()).toBe(0);
    });

    // Under backoff the re-sends slow to one every five seconds, so the ten
    // seconds can run out between two of them; the refusal that answers the
    // last one is where the stall is noticed.
    it('also decides the stall on a refusal, before telling the refusal subscribers', async () => {
      await connectNow();
      service.joinSession('s1', 'u1', 'Alice');
      for (let i = 0; i < 5; i++) {
        resend();
        clock += 300;
      }
      expect(service.getSyncHealth()).toBe('ok');

      const seen: string[] = [];
      service.onUpdateRefused(() => seen.push(service.getSyncHealth()));
      clock = 1_000_000 + 10_000;
      refuse({ sessionId: 's1', reason: 'stale' });

      expect(service.getSyncHealth()).toBe('stalled');
      // The UI reads the health inside its refusal callback: it must already
      // be the post-refusal one.
      expect(seen).toEqual(['stalled']);
    });

    it('needs both conditions: ten seconds of fewer than five re-sends is not a stall', async () => {
      await connectNow();
      service.joinSession('s1', 'u1', 'Alice');

      resend();
      clock += 30_000;
      resend();
      resend();
      resend();
      refuse({ sessionId: 's1', reason: 'stale' });
      expect(service.getSyncHealth()).toBe('ok');

      resend();
      expect(service.getSyncHealth()).toBe('stalled');
    });

    const stallSession = () => {
      for (let i = 0; i < 5; i++) resend();
      clock += 10_000;
      refuse({ sessionId: 's1', reason: 'stale' });
      expect(service.getSyncHealth()).toBe('stalled');
    };

    it('ignores an ack for another session when deciding health', async () => {
      await connectNow();
      service.joinSession('s1', 'u1', 'Alice');
      stallSession();

      trigger('session-ack', { sessionId: 'other', rev: 3 });
      expect(service.getSyncHealth()).toBe('stalled');
    });

    it('resets on leaving the session', async () => {
      await connectNow();
      service.joinSession('s1', 'u1', 'Alice');
      stallSession();

      service.leaveSession();
      expect(service.getSyncHealth()).toBe('ok');
      expect(service.getResendDelayMs()).toBe(0);
    });

    it('resets on joining a different session', async () => {
      await connectNow();
      service.joinSession('s1', 'u1', 'Alice');
      stallSession();

      service.joinSession('s2', 'u1', 'Alice');
      expect(service.getSyncHealth()).toBe('ok');
      expect(service.getResendDelayMs()).toBe(0);
    });

    it('resets on disconnect, where the offline state takes over', async () => {
      await connectNow();
      service.joinSession('s1', 'u1', 'Alice');
      const health: string[] = [];
      service.onSyncHealth(h => health.push(h));
      stallSession();

      connected = false;
      trigger('disconnect');
      expect(service.getSyncHealth()).toBe('ok');
      expect(health).toEqual(['stalled', 'ok']);

      // A fresh streak after the reconnect starts from zero.
      connected = true;
      trigger('connect');
      resend();
      refuse({ sessionId: 's1', reason: 'stale' });
      expect(service.getResendDelayMs()).toBe(0);
      expect(service.getSyncHealth()).toBe('ok');
    });

    // An ordinary write is not a re-send, whatever the server answered before.
    it('counts only writes flagged as re-sends', async () => {
      await connectNow();
      service.joinSession('s1', 'u1', 'Alice');

      for (let i = 0; i < 6; i++) {
        service.updateSession({ id: 's1', phase: 'BRAINSTORM', status: 'IN_PROGRESS', _rev: 4 } as any);
        clock += 3_000;
      }
      refuse({ sessionId: 's1', reason: 'stale' });

      expect(service.getSyncHealth()).toBe('ok');
      expect(service.getResendDelayMs()).toBe(0);
    });

    // The server answers 'not-joined' to a write on a socket that is in no
    // room. Re-sending the write can never fix that; re-joining does.
    it('re-joins the current session on a not-joined refusal, at most once per two seconds', async () => {
      await connectNow();
      service.joinSession('s1', 'u1', 'Alice');
      emit.mockClear();

      refuse({ sessionId: null, reason: 'not-joined' });
      expect(emit).toHaveBeenCalledWith('join-session', expect.objectContaining({
        sessionId: 's1',
        userId: 'u1',
        sessionToken: 'rg1.team-session-token'
      }));

      emit.mockClear();
      clock += 1_000;
      refuse({ sessionId: 's1', reason: 'not-joined' });
      expect(emit).not.toHaveBeenCalledWith('join-session', expect.anything());

      clock += 1_000;
      refuse({ sessionId: 's1', reason: 'not-joined' });
      expect(emit).toHaveBeenCalledWith('join-session', expect.objectContaining({ sessionId: 's1' }));
    });

    it('does not re-join for any other refusal', async () => {
      await connectNow();
      service.joinSession('s1', 'u1', 'Alice');
      emit.mockClear();

      refuse({ sessionId: 's1', reason: 'stale' });
      refuse({ sessionId: 's1', reason: 'protected-fields', fields: ['name'] });
      refuse({ sessionId: 's1', reason: 'throttled' });

      expect(emit).not.toHaveBeenCalledWith('join-session', expect.anything());
    });
  });

  // Decision D3b: a password change cuts the team's sockets. The client tells
  // the denial of its latest join from an earlier one by the join id it sent,
  // retries when its token changed since, and otherwise stops — no join, no
  // write — until a new credential arrives.
  describe('session revocation (decision D3b)', () => {
    let revocation: typeof import('../services/sessionRevocation');

    const joinsSent = () =>
      emit.mock.calls.filter(([event]) => event === 'join-session').map(([, payload]) => payload as { sessionId: string; sessionToken?: string; joinId: string });
    const lastJoinId = () => joinsSent().at(-1)!.joinId;
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    beforeEach(async () => {
      revocation = await import('../services/sessionRevocation');
      // What dataService registers: retry when the token changed since.
      revocation.registerRevocationResolver(async (sent) => {
        if (currentToken && currentToken !== sent) return 'retry';
        revocation.markSessionRevoked();
        return 'revoked';
      });
      const connection = service.connect();
      connected = true;
      trigger('connect');
      await connection;
    });

    it('names each join with a new join id', () => {
      service.joinSession('s1', 'u1', 'Alice');
      service.joinSession('s2', 'u1', 'Alice');

      const [first, second] = joinsSent().map((join) => join.joinId);
      expect(first).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(second).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(second).not.toBe(first);
    });

    it('is revoked by a revoking denial of its latest join, without calling the denial subscribers, and stops re-joining', async () => {
      const denied = vi.fn();
      service.onJoinDenied(denied);
      service.joinSession('s1', 'u1', 'Alice');

      trigger('join-denied', { sessionId: 's1', reason: 'unauthenticated', cause: 'session_revoked', joinId: lastJoinId() });
      await settle();

      expect(revocation.isSessionRevoked()).toBe(true);
      expect(denied).not.toHaveBeenCalled();
      emit.mockClear();
      trigger('session-update-refused', { sessionId: null, reason: 'not-joined' });
      expect(emit).not.toHaveBeenCalledWith('join-session', expect.anything());
    });

    it('re-joins with the new token, and revokes nothing, when the token changed since the join', async () => {
      service.joinSession('s1', 'u1', 'Alice');
      const refusedJoin = lastJoinId();
      currentToken = 'rg1.fresh-token';

      trigger('join-denied', { sessionId: 's1', reason: 'unauthenticated', cause: 'session_revoked', joinId: refusedJoin });
      await settle();

      expect(revocation.isSessionRevoked()).toBe(false);
      expect(joinsSent().at(-1)).toMatchObject({ sessionId: 's1', sessionToken: 'rg1.fresh-token' });
      expect(lastJoinId()).not.toBe(refusedJoin);
    });

    it('ignores the denial of an earlier join', async () => {
      const denied = vi.fn();
      service.onJoinDenied(denied);
      service.joinSession('s1', 'u1', 'Alice');
      const earlier = lastJoinId();
      service.joinSession('s1', 'u1', 'Alice');

      trigger('join-denied', { sessionId: 's1', reason: 'unauthenticated', cause: 'session_revoked', joinId: earlier });
      await settle();

      expect(revocation.isSessionRevoked()).toBe(false);
      expect(denied).not.toHaveBeenCalled();
    });

    it('re-joins the current session when the token changes', () => {
      service.joinSession('s1', 'u1', 'Alice');
      currentToken = 'rg1.rotated-token';
      emit.mockClear();

      revocation.notifySessionTokenChanged();

      expect(joinsSent()).toEqual([expect.objectContaining({ sessionId: 's1', sessionToken: 'rg1.rotated-token' })]);
    });

    it('holds a write while revoked, joins nothing, and sends both once another tab\'s token clears it', async () => {
      service.joinSession('s1', 'u1', 'Alice');
      trigger('join-denied', { sessionId: 's1', reason: 'unauthenticated', cause: 'session_revoked', joinId: lastJoinId() });
      await settle();
      emit.mockClear();

      service.updateSession({ id: 's1', phase: 'BRAINSTORM', _rev: 3 } as never);
      service.joinSession('s1', 'u1', 'Alice');
      service.updateSession({ id: 's1', phase: 'GROUP', _rev: 3 } as never);
      expect(emit).not.toHaveBeenCalled();

      currentToken = 'rg1.adopted-token';
      revocation.clearSessionRevoked();
      revocation.notifySessionTokenChanged();

      expect(emittedOrder()).toEqual([['join-session', 's1'], ['update-session', 's1']]);
      expect((emit.mock.calls.at(-1)![1] as { phase: string }).phase).toBe('GROUP');
    });
  });
});
