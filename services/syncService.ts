import { io, Socket } from 'socket.io-client';
import { RetroSession, HealthCheckSession, ParticipantActivity } from '../types';

type SyncedSession = RetroSession | HealthCheckSession;
type SessionUpdateCallback = (session: SyncedSession) => void;
type MemberEventCallback = (data: { userId: string; userName: string }) => void;
type RosterEventCallback = (data: { id: string; name: string }[]) => void;
type ActivityEventCallback = (data: { userId: string; userName: string; activity: ParticipantActivity | null }) => void;

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
  private pendingJoin: { sessionId: string; userId: string; userName: string } | null = null;
  private connectionPromise: Promise<void> | null = null;
  private queuedSession: SyncedSession | null = null;
  // Last blob we emitted: when the server acks it, that blob IS the new
  // authoritative state and is synthesized back to the app (see below).
  private lastOutgoing: SyncedSession | null = null;
  // Highest revision already delivered to the app, so a late ack can never
  // hand the app content older than a broadcast it has already applied.
  private lastDeliveredRev = 0;

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

  connect(): Promise<void> {
    if (this.socket?.connected) {
      return Promise.resolve();
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // Connect to the sync server (supports separate dev server on port 3000)
    const envUrl = (import.meta as any)?.env?.VITE_SYNC_SERVER_URL as string | undefined;
    const isViteDev = window.location.port === '5173';
    const url = envUrl || (isViteDev ? 'http://localhost:3000' : window.location.origin);
    console.log('[SyncService] Connecting to:', url);

    this.socket = io(url, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    this.connectionPromise = new Promise((resolve) => {
      this.socket!.on('connect', () => {
        console.log('[SyncService] Connected to sync server, socket ID:', this.socket?.id);

        // Process pending join if any
        if (this.pendingJoin) {
          console.log('[SyncService] Processing pending join:', this.pendingJoin);
          this.socket!.emit('join-session', this.pendingJoin);
          this.pendingJoin = null;
        } else if (this.currentSessionId && this.currentUserId && this.currentUserName) {
          // Auto-rejoin session after reconnection (e.g., after pod restart during rolling update)
          console.log('[SyncService] Reconnected - auto-rejoining session:', this.currentSessionId);
          this.socket!.emit('join-session', {
            sessionId: this.currentSessionId,
            userId: this.currentUserId,
            userName: this.currentUserName
          });
        }

        // Flush any queued session update
        if (this.queuedSession) {
          console.log('[SyncService] Flushing queued session update');
          const stamped = this.stampRev(this.queuedSession);
          this.lastOutgoing = stamped;
          this.socket!.emit('update-session', stamped);
          this.queuedSession = null;
        }

        this.notifyConnection(true);
        resolve();
      });
    });

    this.socket.on('session-update', (session: SyncedSession) => {
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
    this.socket.on('session-ack', (ack: { sessionId: string; rev: number }) => {
      if (!ack || ack.sessionId !== this.currentSessionId) return;
      const rev = Number(ack.rev) || 0;
      if (!this.lastOutgoing || rev <= this.lastDeliveredRev) return;
      this.lastDeliveredRev = rev;
      const confirmed: SyncedSession = { ...this.lastOutgoing, _rev: rev };
      this.sessionUpdateCallbacks.forEach(cb => cb(confirmed));
    });

    this.socket.on('member-joined', (data: { userId: string; userName: string }) => {
      console.log('[SyncService] Member joined:', data.userName);
      this.memberJoinedCallbacks.forEach(cb => cb(data));
    });

    this.socket.on('member-left', (data: { userId: string; userName: string }) => {
      console.log('[SyncService] Member left:', data.userName);
      this.memberLeftCallbacks.forEach(cb => cb(data));
    });

    this.socket.on('member-roster', (data: { id: string; name: string }[]) => {
      console.log('[SyncService] Roster update:', data.map(d => d.name).join(', '));
      this.rosterCallbacks.forEach(cb => cb(data));
    });

    this.socket.on('participant-activity', (data: { userId: string; userName: string; activity: ParticipantActivity | null }) => {
      this.activityCallbacks.forEach(cb => cb(data));
    });

    this.socket.on('disconnect', () => {
      console.log('[SyncService] Disconnected from sync server');
      this.connectionPromise = null;
      this.notifyConnection(false);
    });

    this.socket.on('connect_error', (error) => {
      console.error('[SyncService] Connection error:', error);
    });

    return this.connectionPromise;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connectionPromise = null;
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
      this.lastOutgoing = null;
    }

    this.currentSessionId = sessionId;
    this.currentUserId = userId;
    this.currentUserName = userName;

    const joinData = { sessionId, userId, userName };

    if (this.socket?.connected) {
      console.log('[SyncService] Emitting join-session:', joinData);
      this.socket.emit('join-session', joinData);
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

    this.currentSessionId = null;
    this.currentUserId = null;
    this.currentUserName = null;
    this.lastOutgoing = null;
    this.lastDeliveredRev = 0;
  }

  updateSession(session: SyncedSession) {
    // If not connected yet, queue the latest session and ensure a connection attempt
    if (!this.socket?.connected) {
      console.warn('[SyncService] Cannot update session - not connected. Queuing update.');
      this.queuedSession = session;
      this.connect();
      return;
    }

    console.log('[SyncService] Broadcasting session update, phase:', session.phase);
    this.queuedSession = null;
    const stamped = this.stampRev(session);
    this.lastOutgoing = stamped;
    this.socket.emit('update-session', stamped);
  }

  onSessionUpdate(callback: SessionUpdateCallback) {
    this.sessionUpdateCallbacks.push(callback);
    return () => {
      this.sessionUpdateCallbacks = this.sessionUpdateCallbacks.filter(cb => cb !== callback);
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
