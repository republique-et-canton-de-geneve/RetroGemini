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

const trigger = (event: string, payload?: unknown) => {
  (handlers[event] || []).forEach(cb => cb(payload));
};

describe('syncService', () => {
  let service: typeof import('../services/syncService').syncService;

  beforeEach(async () => {
    connected = false;
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
    expect(emit).toHaveBeenCalledWith('join-session', { sessionId: 's1', userId: 'u1', userName: 'Alice' });
  });

  it('broadcasts queued session update once connected', async () => {
    const session = { id: 's1', phase: 'DISCUSS', status: 'IN_PROGRESS' } as any;
    const connection = service.connect();
    connected = true;
    trigger('connect');
    await connection;

    service.updateSession(session);
    expect(emit).toHaveBeenCalledWith('update-session', session);
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
});
