import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import nodemailer from 'nodemailer';

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

app.use(express.json({ limit: '1mb' }));

// Basic persistence for teams/actions between browser sessions
const DATA_FILE = join(__dirname, 'data.json');
let persistedData = { teams: [] };

const smtpEnabled = !!process.env.SMTP_HOST;
const mailer = smtpEnabled
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
    })
  : null;

try {
  if (fs.existsSync(DATA_FILE)) {
    persistedData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  }
} catch (err) {
  console.warn('[Server] Failed to load persisted data file', err);
}

app.get('/api/data', (_req, res) => {
  res.json(persistedData);
});

app.get('/api/email-config', (_req, res) => {
  res.json({ enabled: smtpEnabled, host: process.env.SMTP_HOST || null });
});

app.post('/api/data', (req, res) => {
  try {
    persistedData = req.body ?? { teams: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(persistedData));
    res.status(204).end();
  } catch (err) {
    console.error('[Server] Failed to persist data', err);
    res.status(500).json({ error: 'failed_to_persist' });
  }
});

app.post('/api/send-invite', async (req, res) => {
  if (!smtpEnabled || !mailer) {
    return res.status(501).json({ error: 'email_not_configured' });
  }

  const { email, name, link, teamName, sessionName } = req.body || {};
  if (!email || !link) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  try {
    await mailer.sendMail({
      from: process.env.FROM_EMAIL || process.env.SMTP_USER,
      to: email,
      subject: `Invitation to join ${teamName || 'RetroGemini'}`,
      text: `${name || 'You'},

You have been invited to join ${teamName || 'a RetroGemini team'}${sessionName ? ` for the session "${sessionName}"` : ''}.
Use this link to join: ${link}
`,
      html: `<p>${name || 'You'},</p>
<p>You have been invited to join <strong>${teamName || 'a RetroGemini team'}</strong>${sessionName ? ` for the session "${sessionName}"` : ''}.</p>
<p><a href="${link}" target="_blank" rel="noreferrer">Join with this link</a></p>`
    });

    res.status(204).end();
  } catch (err) {
    console.error('[Server] Failed to send invite email', err);
    res.status(500).json({ error: 'send_failed' });
  }
});

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

    // Share current roster (including the new joiner) with everyone in the room
    const roster = Array.from(teamMembers.get(sessionId).values());
    io.to(sessionId).emit('member-roster', roster);

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

      // Broadcast the updated roster
      const roster = Array.from((teamMembers.get(sessionId) || new Map()).values());
      io.to(sessionId).emit('member-roster', roster);
    }
  });
});

// Handle SPA routing - serve index.html for all non-API routes
// Use a regex catch-all compatible with Express 5's path-to-regexp
app.get(/.*/, (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);
});
