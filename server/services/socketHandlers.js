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

      console.log(`[Server] Session update from ${socket.userName}, phase: ${sessionData.phase}`);

      try {
        const result = await dataStore.saveSessionState(sessionId, sessionData);

        if (!result.success && result.stale) {
          // The client built this update on a stale snapshot. Rejecting it is
          // what prevents an out-of-date blob (e.g. an idle participant's
          // automatic roster-sync) from reverting newer state and wiping
          // submitted data. Send the authoritative state back to the sender
          // only, so it resyncs; do not persist or broadcast the stale blob.
          const authoritative = result.data;
          if (authoritative) {
            sessionCache.set(sessionId, authoritative);
            socket.emit('session-update', authoritative);
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
        sessionCache.set(sessionId, sessionData);
        socket.to(sessionId).emit('session-update', sessionData);
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
