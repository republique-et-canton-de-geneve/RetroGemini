import { findProtectedFieldViolations } from './sessionGuard.js';

// How long to wait before refreshing a team's `lastConnectionDate` again.
// Without this, every participant join (and every reconnection after a rolling
// update) triggered a team write, producing a write storm when a whole session
// reconnects at once. The timestamp only needs coarse "last seen" granularity.
const LAST_CONNECTION_DEBOUNCE_MS = (() => {
  const parsed = Number(process.env.LAST_CONNECTION_DEBOUNCE_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5 * 60 * 1000;
})();

const shouldRefreshLastConnection = (
  lastConnectionDate,
  now = Date.now(),
  minIntervalMs = LAST_CONNECTION_DEBOUNCE_MS
) => {
  if (!lastConnectionDate) return true;
  const last = new Date(lastConnectionDate).getTime();
  if (Number.isNaN(last)) return true;
  return now - last >= minIntervalMs;
};

const registerSocketHandlers = ({ io, dataStore, sessionCache }) => {
  // Resolve the sender's role from the team roster (the database record, not
  // anything the client claims about itself). Cached on the socket once known;
  // reset on every join-session. Unknown users and lookup failures resolve to
  // 'participant' — the restrictive default — but a failed lookup is not
  // cached, so a facilitator is not locked out by one transient read error.
  const resolveSenderRole = async (socket, teamId) => {
    if (socket.data.sessionRole) return socket.data.sessionRole;
    let role = 'participant';
    try {
      const team = await dataStore.loadTeam(teamId);
      const member = team?.members?.find((m) => m.id === socket.userId);
      if (member?.role === 'facilitator') role = 'facilitator';
      socket.data.sessionRole = role;
    } catch (err) {
      console.warn('[Server] Failed to resolve sender role, defaulting to participant', err);
    }
    return role;
  };

  const buildSessionRoster = async (sessionId) => {
    try {
      const sockets = await io.in(sessionId).fetchSockets();
      return sockets
        .map((connectedSocket) => ({
          id: connectedSocket.data.userId,
          name: connectedSocket.data.userName
        }))
        .filter((member) => member.id && member.name);
    } catch (err) {
      console.warn('[Server] Failed to fetch full roster across pods', err);
      const localMembers = [];
      for (const connectedSocket of io.sockets.sockets.values()) {
        if (!connectedSocket.rooms.has(sessionId)) continue;
        if (connectedSocket.data.userId && connectedSocket.data.userName) {
          localMembers.push({
            id: connectedSocket.data.userId,
            name: connectedSocket.data.userName
          });
        }
      }
      return localMembers;
    }
  };

  const leaveCurrentSession = async (socket) => {
    const sessionId = socket.sessionId;
    if (!sessionId) return;

    console.log(`[Server] ${socket.userName || 'Unknown'} leaving session ${sessionId}`);
    socket.leave(sessionId);

    const room = io.sockets.adapter.rooms.get(sessionId);
    console.log(`[Server] Session ${sessionId} now has ${room?.size || 0} connected clients`);

    socket.to(sessionId).emit('member-left', {
      userId: socket.userId,
      userName: socket.userName
    });

    const roster = await buildSessionRoster(sessionId);
    io.to(sessionId).emit('member-roster', roster);

    socket.sessionId = null;
  };

  io.on('connection', (socket) => {
    console.log('[Server] Client connected:', socket.id);

    socket.on('join-session', async ({ sessionId, userId, userName }) => {
      console.log(`[Server] User ${userName} (${userId}) joining session ${sessionId}`);

      if (socket.sessionId && socket.sessionId !== sessionId) {
        await leaveCurrentSession(socket);
      }

      socket.join(sessionId);
      socket.sessionId = sessionId;
      socket.userId = userId;
      socket.userName = userName;
      socket.data.userId = userId;
      socket.data.userName = userName;
      // Role is per session and per claimed user; re-resolve after every join.
      socket.data.sessionRole = undefined;

      const roster = await buildSessionRoster(sessionId);
      io.to(sessionId).emit('member-roster', roster);

      const room = io.sockets.adapter.rooms.get(sessionId);
      console.log(`[Server] Session ${sessionId} now has ${room?.size || 0} connected clients`);

      // Load the persisted session once and reuse it both for the initial sync
      // to the joining client and the lastConnectionDate bookkeeping below.
      let sessionData = null;
      if (dataStore.usePostgres || dataStore.getSqliteDb()) {
        sessionData = await dataStore.loadSessionState(sessionId);
        if (sessionData) {
          sessionCache.set(sessionId, sessionData);
          console.log(`[Server] Sending persisted session state to ${userName}`);
          socket.emit('session-update', sessionData);
        } else if (sessionCache.has(sessionId)) {
          console.log(`[Server] Sending cached session state to ${userName}`);
          sessionData = sessionCache.get(sessionId);
          socket.emit('session-update', sessionData);
        }
      } else if (sessionCache.has(sessionId)) {
        sessionData = sessionCache.get(sessionId);
      }

      socket.to(sessionId).emit('member-joined', { userId, userName });

      try {
        if (sessionData?.teamId) {
          const team = await dataStore.loadTeam(sessionData.teamId);
          if (team) {
            const member = team.members.find((m) => m.id === userId);
            socket.data.sessionRole = member?.role === 'facilitator' ? 'facilitator' : 'participant';
            if (
              member &&
              member.role !== 'facilitator' &&
              shouldRefreshLastConnection(team.lastConnectionDate)
            ) {
              const result = await dataStore.atomicTeamUpdate(sessionData.teamId, (t) => {
                t.lastConnectionDate = new Date().toISOString();
                return t;
              });
              if (result.success) {
                console.log(`[Server] Updated lastConnectionDate for team ${team.name} (participant ${userName} joined)`);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[Server] Failed to update lastConnectionDate on session join', err);
      }
    });

    socket.on('leave-session', async () => {
      await leaveCurrentSession(socket);
    });

    socket.on('update-session', async (sessionData) => {
      const sessionId = socket.sessionId;
      if (!sessionId) {
        console.warn('[Server] update-session received but socket has no sessionId');
        return;
      }

      if (!sessionData || typeof sessionData !== 'object' || Array.isArray(sessionData)) {
        console.warn(`[Server] Ignored malformed session update from ${socket.userName}`);
        return;
      }

      if (sessionData.id && sessionData.id !== sessionId) {
        console.warn(`[Server] Ignored session update from ${socket.userName}: blob id ${sessionData.id} does not match joined session ${sessionId}`);
        return;
      }

      console.log(`[Server] Session update from ${socket.userName}, phase: ${sessionData.phase}`);

      try {
        // Authoritative baseline for authorization: the freshest state this
        // pod knows. The local cache can lag behind the database in a
        // multi-pod deployment (writes landing on another pod), so fall back
        // to the database whenever the cache is missing or older than the
        // revision the client built on — comparing against a lagging baseline
        // would wrongly flag up-to-date writes.
        const baseRev = Number(sessionData._rev ?? 0);
        let authoritative = sessionCache.get(sessionId) ?? null;
        if (!authoritative || Number(authoritative._rev ?? 0) < baseRev) {
          const persisted = await dataStore.loadSessionState(sessionId);
          if (persisted && Number(persisted._rev ?? 0) >= Number(authoritative?._rev ?? 0)) {
            authoritative = persisted;
          }
        }

        // The write is only guarded when there is a session to protect; the
        // very first write (session creation, by the facilitator) has no
        // authoritative state yet. Sessions without a teamId have no roster to
        // resolve roles against, so they cannot be guarded either.
        if (authoritative?.teamId) {
          const rejectUpdate = (reason) => {
            socket.emit('session-update', authoritative);
            console.warn(`[Server] Rejected unauthorized session update from ${socket.userName} for ${sessionId}: ${reason}`);
          };

          if (sessionData.teamId !== authoritative.teamId) {
            rejectUpdate('teamId is immutable');
            return;
          }

          const violations = findProtectedFieldViolations(sessionData, authoritative);
          if (violations.length > 0) {
            const role = await resolveSenderRole(socket, authoritative.teamId);
            if (role !== 'facilitator') {
              rejectUpdate(`facilitator-only fields changed (${violations.join(', ')})`);
              return;
            }
          }
        }

        const result = await dataStore.saveSessionState(sessionId, sessionData);

        if (!result.success && result.stale) {
          // The client built this update on a stale snapshot. Rejecting it is
          // what prevents an out-of-date blob (e.g. an idle participant's
          // automatic roster-sync) from reverting newer state and wiping
          // submitted data. Send the authoritative state back to the sender
          // only, so it resyncs; do not persist or broadcast the stale blob.
          const current = result.data;
          if (current) {
            sessionCache.set(sessionId, current);
            socket.emit('session-update', current);
          }
          console.log(`[Server] Rejected stale session update from ${socket.userName} for ${sessionId}`);
          return;
        }

        const savedData = result.data;
        sessionCache.set(sessionId, savedData);

        const room = io.sockets.adapter.rooms.get(sessionId);
        console.log(`[Server] Broadcasting to ${(room?.size || 1) - 1} other clients in session ${sessionId}`);

        // Broadcast the new authoritative state to the other clients, and
        // acknowledge the sender with the new revision so its next update is
        // stamped current (and is not mistaken for a stale write).
        socket.to(sessionId).emit('session-update', savedData);
        socket.emit('session-ack', { sessionId, rev: savedData._rev });
      } catch (err) {
        console.error('[Server] Failed to persist session state', err);

        // Degraded mode (database unavailable): apply the same compare-and-
        // swap against the in-memory cache. Live collaboration keeps working
        // through the outage (zero-downtime requirement), but a stale blob
        // still cannot clobber newer state — the old behaviour of caching and
        // broadcasting the raw client blob reintroduced exactly the clobbering
        // the CAS exists to prevent. Revisions advance monotonically, so the
        // first write after recovery persists cleanly.
        const cached = sessionCache.get(sessionId);
        const cachedRev = cached ? Number(cached._rev ?? 0) : 0;
        const baseRev = Number(sessionData._rev ?? 0);

        if (cached && baseRev < cachedRev) {
          socket.emit('session-update', cached);
          console.log(`[Server] Rejected stale session update from ${socket.userName} for ${sessionId} (degraded mode)`);
          return;
        }

        const fallbackData = {
          ...sessionData,
          _rev: Math.max(cachedRev, baseRev) + 1,
          _updatedAt: new Date().toISOString()
        };
        sessionCache.set(sessionId, fallbackData);
        socket.to(sessionId).emit('session-update', fallbackData);
        socket.emit('session-ack', { sessionId, rev: fallbackData._rev });
      }
    });

    // Ephemeral "is typing" presence signal. Broadcast to the other clients in
    // the session only and never persisted: it is a transient cue that the
    // receivers auto-expire, so it needs no recovery after a reconnection.
    socket.on('participant-activity', (payload) => {
      const sessionId = socket.sessionId;
      if (!sessionId) return;
      const activity = payload && typeof payload === 'object' ? payload.activity ?? null : null;
      socket.to(sessionId).emit('participant-activity', {
        userId: socket.userId,
        userName: socket.userName,
        activity
      });
    });

    socket.on('disconnect', async () => {
      console.log(`[Server] Client disconnected: ${socket.id} (${socket.userName || 'unknown'})`);
      await leaveCurrentSession(socket);
    });
  });
};

export { registerSocketHandlers, shouldRefreshLastConnection };
