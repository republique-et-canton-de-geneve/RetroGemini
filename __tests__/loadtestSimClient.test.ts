// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { SimClient } from '../loadtest/lib/simClient.js';

/**
 * The load harness must not hand a write to socket.io's offline buffer.
 *
 * That buffer is flushed on reconnect *ahead of* the client's own `connect`
 * handler, so the write reaches the server before the re-join and is refused
 * for having no session. `syncService.updateSession` cannot do that — it checks
 * `socket.connected` and parks the update in `queuedSession`, flushing it only
 * after `emitJoin` — so a harness that buffers is measuring a client the
 * product does not ship, on the rolling-update path the harness exists to
 * validate.
 *
 * Waiting for the reconnect covers the ordinary case; this pins the deadline
 * case, where the socket is still down after the whole `opTimeoutMs` and the
 * attempt must be spent without a send rather than emitted into the buffer.
 */

const offlineSocket = () => ({
  connected: false,
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn()
});

type FakeSocket = ReturnType<typeof offlineSocket>;

const makeClient = (socket: FakeSocket, overrides = {}) => {
  const recorded: { outcome: string; attempts: number }[] = [];
  const client = new SimClient({
    url: 'http://127.0.0.1:1',
    sessionId: 's1',
    user: { id: 'u1', name: 'User 1' },
    config: {
      clientMode: 'resilient',
      maxAttempts: 3,
      opTimeoutMs: 30,
      ...overrides
    },
    metrics: {
      recordOp: (op: { outcome: string; attempts: number }) => recorded.push(op),
      recordReconnect: () => {},
      recordSocketError: () => {}
    },
    sessionToken: 'token'
  });
  // The harness only ever holds a real socket.io client here; a fake is enough
  // for the offline path, which touches nothing but connected/emit/on/off.
  (client as unknown as { socket: FakeSocket }).socket = socket;
  client.state = { id: 's1', _rev: 0 };
  return { client, recorded };
};

describe('SimClient.mutate while the socket is down', () => {
  it('never emits on a disconnected socket, even after the wait times out', async () => {
    const socket = offlineSocket();
    const { client, recorded } = makeClient(socket);

    const ok = await client.mutate('DISCUSS', 'proposal-vote', {
      apply: () => {},
      check: () => false
    });

    expect(ok).toBe(false);
    // The write never left, so it must not have been queued in the buffer.
    expect(socket.emit).not.toHaveBeenCalled();
    // Reported as lost, which is the truth for an action that never reached
    // the server — not silently swallowed.
    expect(recorded.at(-1)?.outcome).toBe('lost');
  });

  it('spends every attempt on the wait instead of emitting once per attempt', async () => {
    const socket = offlineSocket();
    const { client } = makeClient(socket, { maxAttempts: 3 });

    await client.mutate('VOTE', 'vote', { apply: () => {}, check: () => false });

    expect(socket.emit).not.toHaveBeenCalled();
    // One connection wait registered per attempt, and each one cleaned up.
    expect(socket.on).toHaveBeenCalledTimes(3);
    expect(socket.off).toHaveBeenCalledTimes(3);
  });

  it('emits normally once the socket is connected', async () => {
    const socket = { ...offlineSocket(), connected: true };
    const { client } = makeClient(socket);

    // `check` passes as soon as the state carries the mark, so one send is
    // enough; this pins that the guard does not block the healthy path.
    let sent = false;
    await client.mutate('BRAINSTORM', 'ticket', {
      apply: () => {
        sent = true;
      },
      check: () => sent
    });

    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit.mock.calls[0][0]).toBe('update-session');
  });
});
