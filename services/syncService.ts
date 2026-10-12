import { io, Socket } from 'socket.io-client';
import { RetroSession, HealthCheckSession, ParticipantActivity } from '../types';
import { getTeamSessionToken } from './dataService';

type SyncedSession = RetroSession | HealthCheckSession;
type SessionUpdateCallback = (session: SyncedSession) => void;
type MemberEventCallback = (data: { userId: string; userName: string }) => void;
type RosterEventCallback = (data: { id: string; name: string }[]) => void;
type ActivityEventCallback = (data: { userId: string; userName: string; activity: ParticipantActivity | null }) => void;
type JoinTarget = { sessionId: string; userId: string; userName: string };

/**
 * Whether this client's writes are reaching the server. `stalled` means the
 * server has kept refusing them for long enough that the user must be told
 * nothing they do is being saved (incident ISS, 2026-10-12: a participant's
 * every write was refused for a facilitator-only field, and cards vanished one
 * by one with nothing on screen saying why).
 */
export type SyncHealth = 'ok' | 'stalled';

/**
 * Why the server refused an `update-session`, as carried by the
 * `session-update-refused` event it emits right before healing the sender.
 */
export type UpdateRefusalReason =
  | 'stale'
  | 'protected-fields'
  | 'immutable'
  | 'malformed'
  | 'not-joined'
  | 'throttled';

export interface UpdateRefusal {
  sessionId: string | null;
  reason: UpdateRefusalReason;
  fields?: string[];
  rev?: number;
}

// The payload comes off the wire, from a server that may be a release ahead
// during a rolling update, so it is read as data: a payload with no reason is
// not a refusal, and an unknown reason is still one.
const parseRefusal = (payload: unknown): UpdateRefusal | null => {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.reason !== 'string' || !raw.reason) return null;
  const refusal: UpdateRefusal = {
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
    reason: raw.reason as UpdateRefusalReason
  };
  if (Array.isArray(raw.fields)) {
    refusal.fields = raw.fields.filter((field): field is string => typeof field === 'string');
  }
  if (typeof raw.rev === 'number' && Number.isFinite(raw.rev)) refusal.rev = raw.rev;
  return refusal;
};

class SyncService {
  private socket: Socket | null = null;
  private sessionUpdateCallbacks: SessionUpdateCallback[] = [];
  private memberJoinedCallbacks: MemberEventCallback[] = [];
  private memberLeftCallbacks: MemberEventCallback[] = [];
  private rosterCallbacks: RosterEventCallback[] = [];
  private activityCallbacks: ActivityEventCallback[] = [];
  private currentSessionId: string | null = null;
  private currentUserId: string | null = null;
  private currentUserName: string | null = null;
  private pendingJoin: JoinTarget | null = null;
  private joinDeniedCallbacks: ((data: { sessionId: string; reason: string }) => void)[] = [];
  private connectionPromise: Promise<void> | null = null;
  // Callers of connect() waiting for the next 'connect' of the one socket.
  private connectWaiters: (() => void)[] = [];
  // The Manager gave up reconnecting (`reconnect_failed`). `socket.active`
  // stays true after that, so it cannot tell connect() the socket needs a kick.
  private reconnectGaveUp = false;
  private queuedSession: SyncedSession | null = null;
  // The session a `join-session` was emitted for on the CURRENT connection.
  // Room membership belongs to the server-side socket, which a reconnect
  // replaces, so this is cleared on every connect and disconnect. A write is
  // only ever emitted for this session: the server drops a write from a socket
  // that joined nothing, and before the 'not-joined' refusal existed it did so
  // without a word — the first write of every fresh page load was lost that
  // way, because Session.tsx awaits connect() before it calls joinSession.
  private joinedOnConnection: string | null = null;
  // Blobs we have emitted and not yet seen answered, oldest first. When the
  // server acks one, that blob IS the new authoritative state and is
  // synthesized back to the app (see below).
  //
  // A queue rather than a single "last outgoing": with two writes in flight the
  // ack for the FIRST used to synthesize the SECOND at the accepted revision,
  // telling the app the server held content it had never accepted. The second
  // write was then rejected as stale and healed to the first value, and because
  // the app had been told its write landed, nothing was left to re-apply — the
  // user's newer edit vanished with no error. An ack at revision R answers the
  // write stamped R-1, so that is how a blob is matched to its ack.
  private outgoing: SyncedSession[] = [];
  // Highest revision already delivered to the app, so a late ack can never
  // hand the app content older than a broadcast it has already applied.
  private lastDeliveredRev = 0;

  // Refusals of the current session's writes since its last ack. A refusal is
  // ordinary — two people editing at once lose a race and are healed — so one
  // proves nothing; a streak that outlives several re-sends does.
  private refusedCallbacks: ((refusal: UpdateRefusal) => void)[] = [];
  private syncHealthCallbacks: ((health: SyncHealth) => void)[] = [];
  private syncHealth: SyncHealth = 'ok';
  private refusalStreak = 0;
  private refusalStreakStartedAt = 0;
  private lastRefusalRejoinAt = Number.NEGATIVE_INFINITY;

  // Bounds the queue if answers never come (a socket that dies mid-flight
  // leaves its writes unanswered forever). Far above any realistic number of
  // writes in flight for one client.
  private static readonly MAX_OUTGOING = 32;

  // Stalled = at least this many consecutive refusals, the first of them at
  // least this old. Both: a burst of five lost races in a second is a busy
  // board, and two refusals ten seconds apart are two unrelated races.
  private static readonly STALL_MIN_REFUSALS = 5;
  private static readonly STALL_MIN_MS = 10_000;
  // Re-send backoff once a streak reaches STALL_MIN_REFUSALS. The incident's
  // client re-sent about three times a second, forever, each write a database
  // read and a rejection on the server.
  private static readonly RESEND_BACKOFF_BASE_MS = 400;
  private static readonly RESEND_BACKOFF_MAX_MS = 5_000;
  // A 'not-joined' refusal re-joins at most this often.
  private static readonly REJOIN_MIN_INTERVAL_MS = 2_000;

  // Outgoing updates keep the revision of the state they were built on. The
  // stamp must stay honest: raising it to a higher "last seen" revision (as a
  // previous iteration did) let a blob whose CONTENT predated that revision
  // pass the server's compare-and-swap and silently erase another user's
  // concurrent change. A stale-stamped write is rejected and healed instead,
  // and the session components' merge + resend recovers the sender's own
  // data without losing anyone else's.
  private stampRev(session: SyncedSession): SyncedSession {
    const base = Number(session._rev) || 0;
    return { ...session, _rev: base };
  }

  // Remember a blob until its ack arrives, so the ack can be answered with the
  // content the server actually accepted.
  private trackOutgoing(stamped: SyncedSession) {
    this.outgoing.push(stamped);
    if (this.outgoing.length > SyncService.MAX_OUTGOING) {
      this.outgoing = this.outgoing.slice(-SyncService.MAX_OUTGOING);
    }
  }

  private emitUpdate(session: SyncedSession) {
    const stamped = this.stampRev(session);
    this.trackOutgoing(stamped);
    this.socket!.emit('update-session', stamped);
  }

  // The socket channel authenticates with the same team session token as the
  // REST routes (audit H1: a join used to need nothing but a session id). The
  // token is read here, at emit time, rather than captured when the component
  // called joinSession — so a re-login and every automatic re-join after a
  // reconnect present the current credential, not a stale one.
  private emitJoin(join: JoinTarget) {
    this.socket!.emit('join-session', {
      ...join,
      sessionToken: getTeamSessionToken() ?? undefined
    });
    this.joinedOnConnection = join.sessionId;
  }

  // Send the write held back for want of a join, once this connection has
  // joined its session. A write for any other session is dropped rather than
  // kept: it was built on that session's state, and only a fresh join of it
  // could make it meaningful again — by which time it is out of date.
  private flushQueuedSession() {
    const queued = this.queuedSession;
    if (!queued || !this.socket?.connected) return;
    const joined = this.joinedOnConnection;
    if (!joined) return;
    this.queuedSession = null;
    if (queued.id !== joined) {
      console.warn('[SyncService] Dropping a queued update for another session:', queued.id);
      return;
    }
    console.log('[SyncService] Flushing queued session update');
    this.emitUpdate(queued);
  }

  private currentJoinTarget(): JoinTarget | null {
    if (!this.currentSessionId || !this.currentUserId || !this.currentUserName) return null;
    return { sessionId: this.currentSessionId, userId: this.currentUserId, userName: this.currentUserName };
  }

  private setSyncHealth(health: SyncHealth) {
    if (this.syncHealth === health) return;
    this.syncHealth = health;
    this.syncHealthCallbacks.forEach(cb => cb(health));
  }

  private resetRefusals() {
    this.refusalStreak = 0;
    this.refusalStreakStartedAt = 0;
    this.setSyncHealth('ok');
  }

  // The stall is decided here, on a refusal, and deliberately not by a timer:
  // a client that stops writing after a few refusals (the heal left nothing of
  // its own to re-send) has nothing unsaved, and a timer would put the banner
  // up anyway. A stall is refusals that are STILL arriving ten seconds on.
  private handleRefusal(payload: unknown) {
    const refusal = parseRefusal(payload);
    const sessionId = this.currentSessionId;
    if (!refusal || !sessionId) return;
    if (refusal.sessionId !== null && refusal.sessionId !== sessionId) return;

    const now = Date.now();
    if (this.refusalStreak === 0) this.refusalStreakStartedAt = now;
    this.refusalStreak += 1;
    console.warn(
      `[SyncService] Update refused (${refusal.reason}), ${this.refusalStreak} since the last accepted write`,
      refusal.fields ?? ''
    );

    // Re-sending can never cure 'not-joined': the server-side socket is in no
    // room. Re-joining does, and the join snapshot lets the merge re-send
    // whatever is still unconfirmed.
    if (refusal.reason === 'not-joined') {
      const target = this.currentJoinTarget();
      if (
        target &&
        this.socket?.connected &&
        now - this.lastRefusalRejoinAt >= SyncService.REJOIN_MIN_INTERVAL_MS
      ) {
        this.lastRefusalRejoinAt = now;
        console.log('[SyncService] Not joined on the server - re-joining session:', target.sessionId);
        this.emitJoin(target);
      }
    }

    if (
      this.refusalStreak >= SyncService.STALL_MIN_REFUSALS &&
      now - this.refusalStreakStartedAt >= SyncService.STALL_MIN_MS &&
      this.socket?.connected
    ) {
      this.setSyncHealth('stalled');
    }

    this.refusedCallbacks.forEach(cb => cb(refusal));
  }

  private connectionCallbacks: ((connected: boolean) => void)[] = [];

  private notifyConnection(connected: boolean) {
    this.connectionCallbacks.forEach(cb => cb(connected));
  }

  /**
   * Subscribe to live connection state. Fires `true` on (re)connect and
   * `false` on disconnect. Used to pause editing and show a "reconnecting"
   * state while the client is not live, so no edit is made on a stale,
   * offline snapshot.
   */
  onConnectionChange(callback: (connected: boolean) => void) {
    this.connectionCallbacks.push(callback);
    return () => {
      this.connectionCallbacks = this.connectionCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Connect, reusing the one socket this service owns.
   *
   * There is never a second `io()` while a socket exists. One used to be
   * created on every call after a disconnect, while the first socket was still
   * auto-reconnecting with the same listeners attached — two live connections,
   * both writing through whichever `this.socket` named last. A socket that
   * will not reconnect by itself (a server-side kick, or reconnection attempts
   * exhausted) is re-opened instead; one that is already reconnecting is left
   * alone, since a second open while one is in flight can send a second
   * namespace CONNECT on the same engine connection.
   */
  connect(): Promise<void> {
    if (this.socket?.connected) {
      return Promise.resolve();
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve) => {
      this.connectWaiters.push(resolve);
    });

    if (this.socket) {
      if (!this.socket.active || this.reconnectGaveUp) {
        console.log('[SyncService] Re-opening the sync socket');
        this.reconnectGaveUp = false;
        this.socket.connect();
      }
      return this.connectionPromise;
    }

    // Connect to the sync server (supports separate dev server on port 3000)
    const envUrl = (import.meta as any)?.env?.VITE_SYNC_SERVER_URL as string | undefined;
    const isViteDev = window.location.port === '5173';
    const url = envUrl || (isViteDev ? 'http://localhost:3000' : window.location.origin);
    console.log('[SyncService] Connecting to:', url);

    const socket = io(url, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });
    this.socket = socket;
    this.registerSocketListeners(socket);

    return this.connectionPromise;
  }

  // Called exactly once per socket: listeners must never pile up on it.
  private registerSocketListeners(socket: Socket) {
    socket.on('connect', () => {
      console.log('[SyncService] Connected to sync server, socket ID:', socket.id);

      // A new server-side socket has joined nothing yet, whatever the previous
      // connection had joined.
      this.joinedOnConnection = null;

      // Join first — a pending join, or the automatic re-join of the current
      // session after a reconnect (e.g. a pod restart during a rolling update)
      // — and only then flush a queued write, and only one for that session.
      // With no join target yet the write stays queued until joinSession.
      const join = this.pendingJoin ?? this.currentJoinTarget();
      this.pendingJoin = null;
      if (join) {
        console.log('[SyncService] Joining session on connect:', join.sessionId);
        this.emitJoin(join);
      }
      this.flushQueuedSession();

      this.notifyConnection(true);
      const waiters = this.connectWaiters;
      this.connectWaiters = [];
      waiters.forEach(resolve => resolve());
    });

    // The Manager stops after `reconnectionAttempts`. The socket still reports
    // itself active, so remember it and let the next connect() re-open it.
    // Optional: the Manager is absent from test doubles of the socket.
    socket.io?.on?.('reconnect_failed', () => {
      console.warn('[SyncService] Reconnection attempts exhausted');
      this.reconnectGaveUp = true;
      this.connectionPromise = null;
    });

    socket.on('session-update', (session: SyncedSession) => {
      console.log('[SyncService] Received session update, phase:', session.phase);
      const rev = Number(session._rev) || 0;
      if (rev > this.lastDeliveredRev) this.lastDeliveredRev = rev;
      this.sessionUpdateCallbacks.forEach(cb => cb(session));
    });

    // Server acknowledges an accepted write with its new authoritative
    // revision. The sender never receives its own broadcast echo, so this is
    // how it learns the write landed: synthesize the acked blob at its new
    // revision back to the app, keeping the local session _rev current so the
    // next outgoing write is stamped correctly. Skipped when a newer
    // broadcast already reached the app — synthesizing older content would
    // fork its state back in time.
    //
    // When the server had to restore fields of the write (a participant's
    // stale copy of a facilitator-only field), it sends the saved blob as a
    // `session-update` FIRST and then this ack at the same revision: the
    // update raises lastDeliveredRev, so the ack synthesizes nothing and the
    // app keeps the server's blob, not the outgoing one.
    socket.on('session-ack', (ack: { sessionId: string; rev: number }) => {
      if (!ack || ack.sessionId !== this.currentSessionId) return;
      // A write landed: whatever streak of refusals preceded it is over.
      this.resetRefusals();
      const rev = Number(ack.rev) || 0;
      // The server accepts a write only when its stamp equals the stored
      // revision, then stores rev+1 — so this ack answers the oldest blob we
      // sent stamped rev-1. Anything queued before it lost its race and will
      // never be acked, so it goes with it.
      const index = this.outgoing.findIndex(s => (Number(s._rev) || 0) === rev - 1);
      if (index === -1) return;
      const acked = this.outgoing[index];
      this.outgoing = this.outgoing.slice(index + 1);
      if (rev <= this.lastDeliveredRev) return;
      this.lastDeliveredRev = rev;
      const confirmed: SyncedSession = { ...acked, _rev: rev };
      this.sessionUpdateCallbacks.forEach(cb => cb(confirmed));
    });

    // Emitted by the server right before it heals the sender (and alone when
    // the socket has joined nothing). Clients from before it ignore the event,
    // so it is safe across a rolling update in both directions.
    socket.on('session-update-refused', (payload: unknown) => {
      this.handleRefusal(payload);
    });

    // The server refused the join: the credential is missing, expired, or was
    // minted for another team. Retrying cannot help, so surface it instead of
    // leaving the UI spinning on a "reconnecting" state that will never clear.
    socket.on('join-denied', (data: { sessionId: string; reason: string }) => {
      console.error('[SyncService] Join denied by server:', data?.reason);
      // A refused join is not a join: writes wait instead of being sent into
      // a room this socket is not in.
      if (data?.sessionId === this.joinedOnConnection) this.joinedOnConnection = null;
      this.joinDeniedCallbacks.forEach(cb => cb(data));
    });

    socket.on('member-joined', (data: { userId: string; userName: string }) => {
      console.log('[SyncService] Member joined:', data.userName);
      this.memberJoinedCallbacks.forEach(cb => cb(data));
    });

    socket.on('member-left', (data: { userId: string; userName: string }) => {
      console.log('[SyncService] Member left:', data.userName);
      this.memberLeftCallbacks.forEach(cb => cb(data));
    });

    socket.on('member-roster', (data: { id: string; name: string }[]) => {
      console.log('[SyncService] Roster update:', data.map(d => d.name).join(', '));
      this.rosterCallbacks.forEach(cb => cb(data));
    });

    socket.on('participant-activity', (data: { userId: string; userName: string; activity: ParticipantActivity | null }) => {
      this.activityCallbacks.forEach(cb => cb(data));
    });

    socket.on('disconnect', () => {
      console.log('[SyncService] Disconnected from sync server');
      this.connectionPromise = null;
      this.joinedOnConnection = null;
      // Writes still in flight can no longer be answered: their ack died with
      // the socket. Keeping them would let a later ack, matched only by
      // revision, synthesize a blob from before the drop. The re-join delivers
      // the authoritative state instead, which carries any write that did land.
      this.outgoing = [];
      // Offline is its own state, with its own banner; a refusal streak from
      // before the drop says nothing about the connection that replaces it.
      this.resetRefusals();
      this.notifyConnection(false);
    });

    socket.on('connect_error', (error) => {
      console.error('[SyncService] Connection error:', error);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connectionPromise = null;
      this.joinedOnConnection = null;
      this.reconnectGaveUp = false;
    }
  }

  joinSession(sessionId: string, userId: string, userName: string) {
    if (this.currentSessionId && this.currentSessionId !== sessionId) {
      this.leaveSession();
    }

    // A different session has its own revision line; start fresh so state
    // from the previous session can never be synthesized into this one.
    if (this.currentSessionId !== sessionId) {
      this.lastDeliveredRev = 0;
      this.outgoing = [];
      this.resetRefusals();
    }

    this.currentSessionId = sessionId;
    this.currentUserId = userId;
    this.currentUserName = userName;

    const joinData = { sessionId, userId, userName };

    if (this.socket?.connected) {
      console.log('[SyncService] Emitting join-session:', joinData);
      this.emitJoin(joinData);
      // The server waits for an in-flight join before it handles a write on
      // the same socket, so the held write can follow the join immediately.
      this.flushQueuedSession();
      return;
    }

    console.log('[SyncService] Socket not connected, queuing join:', joinData);
    this.pendingJoin = joinData;
    // Ensure a connection attempt is in flight
    this.connect();
  }

  leaveSession() {
    const sessionId = this.currentSessionId;
    if (!sessionId) return;

    if (this.socket?.connected) {
      this.socket.emit('leave-session', { sessionId });
    }

    if (this.pendingJoin?.sessionId === sessionId) {
      this.pendingJoin = null;
    }
    if (this.joinedOnConnection === sessionId) {
      this.joinedOnConnection = null;
    }
    // A write held for this session can only be sent after a fresh join of
    // it, when it would be built on an outdated state.
    if (this.queuedSession?.id === sessionId) {
      this.queuedSession = null;
    }

    this.currentSessionId = null;
    this.currentUserId = null;
    this.currentUserName = null;
    this.outgoing = [];
    this.lastDeliveredRev = 0;
    this.resetRefusals();
  }

  updateSession(session: SyncedSession) {
    // If not connected yet, queue the latest session and ensure a connection attempt
    if (!this.socket?.connected) {
      console.warn('[SyncService] Cannot update session - not connected. Queuing update.');
      this.queuedSession = session;
      this.connect();
      return;
    }

    // Join before write: the server drops a write from a socket that has not
    // joined its session. Hold it (latest wins) until joinSession emits that
    // join on this connection.
    if (this.joinedOnConnection !== session.id) {
      console.warn('[SyncService] Session not joined on this connection yet. Queuing update.');
      this.queuedSession = session;
      return;
    }

    console.log('[SyncService] Broadcasting session update, phase:', session.phase);
    this.queuedSession = null;
    this.emitUpdate(session);
  }

  onSessionUpdate(callback: SessionUpdateCallback) {
    this.sessionUpdateCallbacks.push(callback);
    return () => {
      this.sessionUpdateCallbacks = this.sessionUpdateCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Subscribe to the server's refusals of this client's writes to the current
   * session (a refusal naming no session counts as the current one). Each
   * refusal is followed by a healing `session-update`, except 'not-joined',
   * which the service answers itself by re-joining.
   */
  onUpdateRefused(callback: (refusal: UpdateRefusal) => void) {
    this.refusedCallbacks.push(callback);
    return () => {
      this.refusedCallbacks = this.refusedCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Subscribe to changes of sync health. Fires only when it changes: `stalled`
   * once the server has refused at least five writes in a row over at least
   * ten seconds, `ok` again on the next accepted write, on leaving or switching
   * session, and on disconnect (the offline state takes over from there).
   */
  onSyncHealth(callback: (health: SyncHealth) => void) {
    this.syncHealthCallbacks.push(callback);
    return () => {
      this.syncHealthCallbacks = this.syncHealthCallbacks.filter(cb => cb !== callback);
    };
  }

  getSyncHealth(): SyncHealth {
    return this.syncHealth;
  }

  /**
   * The minimum delay before re-sending after a refusal: 0 for the first four
   * refusals since the last accepted write (an ordinary lost race is retried at
   * once), then 400 ms doubling per refusal, capped at 5 s.
   */
  getResendDelayMs(): number {
    const excess = this.refusalStreak - SyncService.STALL_MIN_REFUSALS;
    if (excess < 0) return 0;
    return Math.min(SyncService.RESEND_BACKOFF_MAX_MS, SyncService.RESEND_BACKOFF_BASE_MS * 2 ** excess);
  }

  /**
   * Subscribe to a server-side join refusal (audit H1). Fires when the socket
   * presented no valid team credential for the session, which a reconnect will
   * never fix — the user has to log in again.
   */
  onJoinDenied(callback: (data: { sessionId: string; reason: string }) => void) {
    this.joinDeniedCallbacks.push(callback);
    return () => {
      this.joinDeniedCallbacks = this.joinDeniedCallbacks.filter(cb => cb !== callback);
    };
  }

  onMemberJoined(callback: MemberEventCallback) {
    this.memberJoinedCallbacks.push(callback);
    return () => {
      this.memberJoinedCallbacks = this.memberJoinedCallbacks.filter(cb => cb !== callback);
    };
  }

  onMemberLeft(callback: MemberEventCallback) {
    this.memberLeftCallbacks.push(callback);
    return () => {
      this.memberLeftCallbacks = this.memberLeftCallbacks.filter(cb => cb !== callback);
    };
  }

  onRoster(callback: RosterEventCallback) {
    this.rosterCallbacks.push(callback);
    return () => {
      this.rosterCallbacks = this.rosterCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Broadcast an ephemeral "is typing" signal to other clients in the session.
   * Pass `null` to clear the signal. Dropped silently when offline because the
   * cue is transient and auto-expires on the receiving side.
   */
  sendActivity(activity: ParticipantActivity | null) {
    if (!this.socket?.connected) return;
    this.socket.emit('participant-activity', { activity });
  }

  onActivity(callback: ActivityEventCallback) {
    this.activityCallbacks.push(callback);
    return () => {
      this.activityCallbacks = this.activityCallbacks.filter(cb => cb !== callback);
    };
  }

  isConnected() {
    return this.socket?.connected || false;
  }

  getCurrentSessionId() {
    return this.currentSessionId;
  }
}

export const syncService = new SyncService();
