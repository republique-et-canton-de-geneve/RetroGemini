import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  // Explicit path avoids collisions with platform proxies
  path: '/socket.io',
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Health endpoints for platform monitoring
app.get('/health', (_req, res) => res.status(200).send('OK'));
app.get('/ready', (_req, res) => res.status(200).send('READY'));

// Serve static files from dist folder
app.use(express.static(join(__dirname, 'dist')));

// In-memory storage for sessions (per team)
const sessions = new Map(); // sessionId -> session data
const teamMembers = new Map(); // sessionId -> Map of socketId -> user info

io.on('connection', (socket) => {
  console.log('[Server] Client connected:', socket.id);

  // Join a session room
  socket.on('join-session', ({ sessionId, userId, userName }) => {
    console.log(`[Server] User ${userName} (${userId}) joining session ${sessionId}`);

    socket.join(sessionId);
    socket.sessionId = sessionId;
    socket.userId = userId;
    socket.userName = userName;

    // Track members in this session
    if (!teamMembers.has(sessionId)) {
      teamMembers.set(sessionId, new Map());
    }
    teamMembers.get(sessionId).set(socket.id, { id: userId, name: userName });

    // Log current room members
    const room = io.sockets.adapter.rooms.get(sessionId);
    console.log(`[Server] Session ${sessionId} now has ${room?.size || 0} connected clients`);

    // Send current session state to the new joiner
    if (sessions.has(sessionId)) {
      console.log(`[Server] Sending cached session state to ${userName}`);
      socket.emit('session-update', sessions.get(sessionId));
    }

    // Notify others that someone joined
    socket.to(sessionId).emit('member-joined', { userId, userName });
  });

  // Update session data
  socket.on('update-session', (sessionData) => {
    const sessionId = socket.sessionId;
    if (!sessionId) {
      console.warn('[Server] update-session received but socket has no sessionId');
      return;
    }

    console.log(`[Server] Session update from ${socket.userName}, phase: ${sessionData.phase}`);

    // Store and broadcast to all OTHER clients in the session
    sessions.set(sessionId, sessionData);

    // Get room size for logging
    const room = io.sockets.adapter.rooms.get(sessionId);
    console.log(`[Server] Broadcasting to ${(room?.size || 1) - 1} other clients in session ${sessionId}`);

    socket.to(sessionId).emit('session-update', sessionData);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const sessionId = socket.sessionId;
    console.log(`[Server] Client disconnected: ${socket.id} (${socket.userName || 'unknown'})`);

    if (sessionId && teamMembers.has(sessionId)) {
      teamMembers.get(sessionId).delete(socket.id);

      // Log remaining members
      const room = io.sockets.adapter.rooms.get(sessionId);
      console.log(`[Server] Session ${sessionId} now has ${room?.size || 0} connected clients`);

      // Notify others
      socket.to(sessionId).emit('member-left', {
        userId: socket.userId,
        userName: socket.userName
      });
    }
  });
});

// Handle SPA routing - serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);
});
