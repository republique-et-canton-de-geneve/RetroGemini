import { io, Socket } from 'socket.io-client';
import { RetroSession } from '../types';

type SessionUpdateCallback = (session: RetroSession) => void;
type MemberEventCallback = (data: { userId: string; userName: string }) => void;

class SyncService {
  private socket: Socket | null = null;
  private sessionUpdateCallbacks: SessionUpdateCallback[] = [];
  private memberJoinedCallbacks: MemberEventCallback[] = [];
  private memberLeftCallbacks: MemberEventCallback[] = [];
  private currentSessionId: string | null = null;
  private pendingJoin: { sessionId: string; userId: string; userName: string } | null = null;
  private connectionPromise: Promise<void> | null = null;
  private queuedSession: RetroSession | null = null;

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
        }

        // Flush any queued session update
        if (this.queuedSession) {
          console.log('[SyncService] Flushing queued session update');
          this.socket!.emit('update-session', this.queuedSession);
          this.queuedSession = null;
        }

        resolve();
      });
    });

    this.socket.on('session-update', (session: RetroSession) => {
      console.log('[SyncService] Received session update, phase:', session.phase);
      this.sessionUpdateCallbacks.forEach(cb => cb(session));
    });

    this.socket.on('member-joined', (data: { userId: string; userName: string }) => {
      console.log('[SyncService] Member joined:', data.userName);
      this.memberJoinedCallbacks.forEach(cb => cb(data));
    });

    this.socket.on('member-left', (data: { userId: string; userName: string }) => {
      console.log('[SyncService] Member left:', data.userName);
      this.memberLeftCallbacks.forEach(cb => cb(data));
    });

    this.socket.on('disconnect', () => {
      console.log('[SyncService] Disconnected from sync server');
      this.connectionPromise = null;
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
    this.currentSessionId = sessionId;
    localStorage.setItem('retro_active_user_name', userName);

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
    this.currentSessionId = null;
  }

  updateSession(session: RetroSession) {
    // If not connected yet, queue the latest session and ensure a connection attempt
    if (!this.socket?.connected) {
      console.warn('[SyncService] Cannot update session - not connected. Queuing update.');
      this.queuedSession = session;
      this.connect();
      return;
    }

    console.log('[SyncService] Broadcasting session update, phase:', session.phase);
    this.queuedSession = null;
    this.socket.emit('update-session', session);
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

  isConnected() {
    return this.socket?.connected || false;
  }
}

export const syncService = new SyncService();
