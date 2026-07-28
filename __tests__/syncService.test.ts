import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (payload?: unknown) => void;
const handlers: Record<string, Handler[]> = {};
const emit = vi.fn();
const disconnect = vi.fn();
let connected = false;

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    emit,
    disconnect,
    on: (event: string, cb: Handler) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(cb);
    },
    get connected() {
      return connected;
    },
  })),
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
    currentToken = 'rg1.team-session-token';
    Object.keys(handlers).forEach(k => delete handlers[k]);
    emit.mockClear();
    disconnect.mockClear();
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
      sessionToken: 'rg1.team-session-token'
    });
  });

  it('broadcasts queued session update once connected', async () => {
    const session = { id: 's1', phase: 'DISCUSS', status: 'IN_PROGRESS' } as any;
    const connection = service.connect();
    connected = true;
    trigger('connect');
    await connection;

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
      sessionToken: undefined
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
});
