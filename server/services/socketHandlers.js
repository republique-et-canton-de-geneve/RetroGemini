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

      if (dataStore.usePostgres || dataStore.getSqliteDb()) {
        const persistedSession = await dataStore.loadSessionState(sessionId);
        if (persistedSession) {
          sessionCache.set(sessionId, persistedSession);
          console.log(`[Server] Sending persisted session state to ${userName}`);
          socket.emit('session-update', persistedSession);
        } else if (sessionCache.has(sessionId)) {
          console.log(`[Server] Sending cached session state to ${userName}`);
          socket.emit('session-update', sessionCache.get(sessionId));
        }
      }

      socket.to(sessionId).emit('member-joined', { userId, userName });

      try {
        const sessionData = await dataStore.loadSessionState(sessionId) || sessionCache.get(sessionId);
        if (sessionData?.teamId) {
          const team = await dataStore.loadTeam(sessionData.teamId);
          if (team) {
            const member = team.members.find((m) => m.id === userId);
            if (member && member.role !== 'facilitator') {
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
        const savedData = await dataStore.saveSessionState(sessionId, sessionData);
        sessionCache.set(sessionId, savedData);

        const room = io.sockets.adapter.rooms.get(sessionId);
        console.log(`[Server] Broadcasting to ${(room?.size || 1) - 1} other clients in session ${sessionId}`);

        socket.to(sessionId).emit('session-update', savedData);
      } catch (err) {
        console.error('[Server] Failed to persist session state', err);
        sessionCache.set(sessionId, sessionData);
        socket.to(sessionId).emit('session-update', sessionData);
      }
    });

    socket.on('disconnect', async () => {
      console.log(`[Server] Client disconnected: ${socket.id} (${socket.userName || 'unknown'})`);
      await leaveCurrentSession(socket);
    });
  });
};

export { registerSocketHandlers };
