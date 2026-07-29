import { io } from 'socket.io-client';
import { appendFileSync } from 'node:fs';

// Optional wire-level trace for debugging lost updates: set LT_DEBUG to a file
// path to get one JSON line per emit/ack/update per simulated client.
const debugTrace = process.env.LT_DEBUG
  ? (entry) => appendFileSync(process.env.LT_DEBUG, `${JSON.stringify({ t: Date.now(), ...entry })}\n`)
  : null;

// A simulated session participant speaking the exact same Socket.IO protocol
// as services/syncService.ts:
//  - join-session / session-update / session-ack, full-blob writes,
//  - outgoing writes stamped with the highest revision seen so far,
//  - automatic re-join after a reconnection (rolling-update survival).
//
// Two client modes:
//  - 'resilient' (default): when a write loses the server's compare-and-swap
//    race (the server heals us with the authoritative state instead of an
//    ack), the operation is re-applied on the fresh state and re-sent until
//    it is durably acknowledged. This validates that the SERVER never loses
//    an accepted action and that the system converges under contention.
//  - 'faithful': one single send per user action, like the real front-end
//    (which does not auto-retry rejected writes). "Sticky" own data
//    (happiness/ROTI/votes) is re-applied onto every LATER outgoing write,
//    mirroring the front-end merge that preserves the current user's own
//    values. This mode measures what real users would actually lose.

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class SimClient {
  constructor({ url, sessionId, user, config, metrics, sessionToken }) {
    this.url = url;
    this.sessionId = sessionId;
    this.user = user;
    // Team session token presented on every join, including the automatic
    // re-join after a reconnect (audit H1).
    this.sessionToken = sessionToken;
    this.config = config;
    this.metrics = metrics;
    this.state = null;
    this.lastSeenRev = 0;
    this.joined = false;
    this.socket = null;
    this.signalWaiters = [];
    this.stateWaiters = [];
    this.stickyOps = new Map();
    this.everConnected = false;
  }

  noteRev(rev) {
    const value = Number(rev) || 0;
    if (value > this.lastSeenRev) this.lastSeenRev = value;
  }

  fireSignal(signal) {
    const waiters = this.signalWaiters;
    this.signalWaiters = [];
    for (const waiter of waiters) waiter(signal);
  }

  onStateChanged() {
    this.stateWaiters = this.stateWaiters.filter(waiter => {
      if (waiter.predicate(this.state)) {
        waiter.resolve(true);
        return false;
      }
      return true;
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(this.url, {
        path: '/socket.io',
        transports: ['websocket'],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: 30,
        reconnectionDelay: 500,
        timeout: 15000
      });

      const connectTimer = setTimeout(
        () => reject(new Error(`${this.user.name}: connect timeout`)),
        20000
      );

      this.socket.on('connect', () => {
        if (this.everConnected) {
          // Same behaviour as syncService: auto-rejoin after any reconnection.
          this.metrics.recordReconnect();
          if (this.joined) this.emitJoin();
        } else {
          this.everConnected = true;
          clearTimeout(connectTimer);
          resolve();
        }
      });

      this.socket.on('connect_error', () => this.metrics.recordSocketError());

      this.socket.on('session-update', (session) => {
        if (!session || session.id !== this.sessionId) return;
        debugTrace?.({ e: 'upd', u: this.user.id, rev: session._rev, n: session.tickets?.length });
        this.noteRev(session._rev);
        this.state = session;
        this.onStateChanged();
        this.fireSignal({ type: 'update' });
      });

      this.socket.on('session-ack', (ack) => {
        if (!ack || ack.sessionId !== this.sessionId) return;
        debugTrace?.({ e: 'ack', u: this.user.id, rev: ack.rev });
        this.noteRev(ack.rev);
        this.fireSignal({ type: 'ack', rev: ack.rev });
      });
    });
  }

  emitJoin() {
    this.socket.emit('join-session', {
      sessionId: this.sessionId,
      userId: this.user.id,
      userName: this.user.name,
      sessionToken: this.sessionToken
    });
  }

  // Join the session room. When persisted state already exists server-side the
  // server answers with a session-update; waitForInitialState makes the caller
  // block until that snapshot arrived (like the real client's first render).
  async join({ waitForInitialState = true } = {}) {
    this.joined = true;
    this.emitJoin();
    if (waitForInitialState) {
      const ok = await this.waitForState(s => s != null, this.config.opTimeoutMs * 2);
      if (!ok) throw new Error(`${this.user.name}: never received initial session state`);
    }
  }

  // Seed the local snapshot before the very first write (session creation by
  // the facilitator: there is no authoritative state to receive yet).
  seed(sessionBlob) {
    this.state = sessionBlob;
  }

  waitForState(predicate, timeoutMs) {
    if (this.state != null && predicate(this.state)) return Promise.resolve(true);
    return new Promise(resolve => {
      const waiter = { predicate: (s) => s != null && predicate(s), resolve: null };
      const timer = setTimeout(() => {
        this.stateWaiters = this.stateWaiters.filter(w => w !== waiter);
        resolve(false);
      }, timeoutMs);
      waiter.resolve = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      this.stateWaiters.push(waiter);
    });
  }

  // Resolves once the socket is connected again (the 'connect' handler above
  // re-emits join-session, so a write sent after this is correctly ordered
  // behind its join). Resolves on timeout too: the caller's own deadline and
  // retry loop decide what to do, exactly as for any unacknowledged write.
  waitForConnected(timeoutMs) {
    if (this.socket?.connected) return Promise.resolve(true);
    return new Promise(resolve => {
      const done = (value) => {
        clearTimeout(timer);
        this.socket?.off('connect', onConnect);
        resolve(value);
      };
      const onConnect = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      this.socket?.on('connect', onConnect);
    });
  }

  nextSignal(timeoutMs) {
    return new Promise(resolve => {
      const waiter = (signal) => {
        clearTimeout(timer);
        resolve(signal);
      };
      const timer = setTimeout(() => {
        this.signalWaiters = this.signalWaiters.filter(w => w !== waiter);
        resolve({ type: 'timeout' });
      }, timeoutMs);
      this.signalWaiters.push(waiter);
    });
  }

  buildBlob(apply) {
    const blob = structuredClone(this.state);
    if (this.config.clientMode === 'faithful') {
      // The real front-end merge preserves the current user's own sticky data
      // (votes, happiness, ROTI) over incoming snapshots, so every later write
      // by this user re-carries them.
      for (const stickyApply of this.stickyOps.values()) stickyApply(blob);
    }
    apply(blob);
    blob._rev = Math.max(Number(blob._rev) || 0, this.lastSeenRev);
    return blob;
  }

  // Perform one user action: apply the mutation on the freshest local
  // snapshot, send it, and confirm durability. `check` must be a cheap
  // predicate telling whether the action is present in a given state; `apply`
  // must be idempotent (see sessionOps.js). `forceRetries` opts a structural
  // write (phase change, grouping...) out of faithful mode's single attempt:
  // a real facilitator whose click visibly reverts simply clicks again.
  async mutate(phase, label, { apply, check, sticky = false, forceRetries = false }) {
    if (sticky && this.config.clientMode === 'faithful') {
      this.stickyOps.set(label, apply);
    }

    const started = Date.now();
    const faithful = this.config.clientMode === 'faithful' && !forceRetries;
    const maxAttempts = faithful ? 1 : this.config.maxAttempts;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (check(this.state)) {
        this.metrics.recordOp({ phase, label, attempts: attempt, latencyMs: Date.now() - started, outcome: 'ok' });
        return true;
      }

      // Never hand a write to socket.io's offline buffer: it is flushed on
      // reconnect ahead of our own 'connect' handler, so the write would reach
      // the server before the re-join and be refused for having no session.
      // syncService does not do that either — it holds the update in
      // `queuedSession` and flushes it *after* emitting join-session — so
      // buffering here would measure a client the product does not ship.
      if (!this.socket.connected) {
        await this.waitForConnected(this.config.opTimeoutMs);
      }

      const blob = this.buildBlob(apply);
      debugTrace?.({ e: 'emit', u: this.user.id, l: label, stamp: blob._rev, n: blob.tickets?.length });
      this.socket.emit('update-session', blob);

      const deadline = Date.now() + this.config.opTimeoutMs;
      let acked = false;
      let rejected = false;
      while (Date.now() < deadline) {
        const signal = await this.nextSignal(deadline - Date.now());
        if (signal.type === 'ack') {
          // Our blob is the new authoritative state — but adopt it locally
          // only if no NEWER broadcast was processed meanwhile. The ack and a
          // subsequent broadcast can be delivered in the same TCP segment;
          // blindly adopting the older blob would fork local state back in
          // time, and the next write (stamped with the higher lastSeenRev)
          // would durably erase the newer broadcast's data on the server.
          // This exact clobber was observed in early runs of this harness.
          if (Number(this.state?._rev ?? 0) < signal.rev) {
            this.state = { ...blob, _rev: signal.rev };
            this.onStateChanged();
          }
          acked = true;
          break;
        }
        if (signal.type === 'update') {
          if (check(this.state)) {
            // Authoritative state already contains the action (accepted via a
            // concurrent path); durable.
            acked = true;
            break;
          }
          if (!faithful) {
            // Either the server healed us after rejecting the write (stale
            // base revision) or a concurrent broadcast landed first. Rebuild
            // on the fresh state and retry: idempotent ops make an eventual
            // double-accept harmless.
            rejected = true;
            break;
          }
          // Faithful mode: the real client would not resend; keep waiting for
          // a potential ack until the deadline.
        }
        if (signal.type === 'timeout') break;
      }

      if (acked) {
        this.metrics.recordOp({ phase, label, attempts: attempt, latencyMs: Date.now() - started, outcome: 'ok' });
        return true;
      }
      if (rejected && attempt < maxAttempts) {
        // Jittered backoff to de-synchronize the retry herd.
        await sleep(20 + Math.random() * 80 * attempt);
      }
    }

    if (check(this.state)) {
      this.metrics.recordOp({ phase, label, attempts: maxAttempts, latencyMs: Date.now() - started, outcome: 'ok' });
      return true;
    }
    this.metrics.recordOp({ phase, label, attempts: maxAttempts, latencyMs: Date.now() - started, outcome: 'lost' });
    return false;
  }

  // Simulate what a rolling update does to this client: drop the connection,
  // then reconnect and auto-rejoin (the 'connect' handler above does the
  // rejoin, and the server replies with the persisted session state).
  async chaosReconnect(offlineMs) {
    this.socket.disconnect();
    await sleep(offlineMs);
    this.socket.connect();
    await this.waitForState(() => true, this.config.opTimeoutMs * 2);
  }

  disconnect() {
    this.joined = false;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

export { SimClient };
