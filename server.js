import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import nodemailer from 'nodemailer';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

// CORS configuration - defaults to permissive for self-hosted deployments
// Set CORS_ORIGIN to restrict in production (e.g., "https://retro.example.com")
const corsOrigin = process.env.CORS_ORIGIN || "*";

const io = new Server(server, {
  // Explicit path avoids collisions with platform proxies
  path: '/socket.io',
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"]
  }
});

// Health endpoints for platform monitoring
app.get('/health', (_req, res) => res.status(200).send('OK'));
app.get('/ready', (_req, res) => res.status(200).send('READY'));

app.use(express.json({ limit: '1mb' }));

// Basic persistence for teams/actions between browser sessions using SQLite
const resolveDataStoreCandidates = () => {
  const candidates = [];

  if (process.env.DATA_STORE_PATH) {
    candidates.push(process.env.DATA_STORE_PATH);
  }

  // Prefer a mounted volume when present (Railway/OpenShift)
  candidates.push('/data/data.sqlite');

  // As a last resort, write to /tmp (ephemeral but writable)
  candidates.push(join('/tmp', 'data.sqlite'));

  // Final fallback next to server.js (may be read-only in some images)
  candidates.push(join(__dirname, 'data.sqlite'));

  return candidates;
};

const openDatabase = () => {
  const errors = [];

  for (const candidate of resolveDataStoreCandidates()) {
    try {
      fs.mkdirSync(dirname(candidate), { recursive: true });
      const database = new Database(candidate);
      console.info(`[Server] Using SQLite store at ${candidate}`);

      // Warn if using ephemeral storage
      if (candidate.startsWith('/tmp')) {
        console.warn('');
        console.warn('┌──────────────────────────────────────────────────────────────────────┐');
        console.warn('│ ⚠️  WARNING: Using ephemeral storage (/tmp)                           │');
        console.warn('│    Data will be LOST when the container restarts!                    │');
        console.warn('│                                                                      │');
        console.warn('│    To persist data:                                                  │');
        console.warn('│    - Railway: Add a Volume mounted at /data                          │');
        console.warn('│    - Docker: Use -v /host/path:/data                                 │');
        console.warn('│    - K8s/OpenShift: Create a PVC mounted at /data                    │');
        console.warn('│    - Or set DATA_STORE_PATH to a persistent location                 │');
        console.warn('└──────────────────────────────────────────────────────────────────────┘');
        console.warn('');
      }

      return database;
    } catch (err) {
      errors.push({ pathTried: candidate, message: err?.message });
      console.warn(`[Server] Failed to open SQLite store at ${candidate}: ${err?.message}`);
    }
  }

  const error = new Error(
    `Unable to open SQLite database. Paths tried: ${errors
      .map((e) => `${e.pathTried} (${e.message})`)
      .join('; ')}`
  );
  error.name = 'SQLiteInitError';
  throw error;
};

const db = openDatabase();
db.pragma('journal_mode = wal');
db.prepare(
  `CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`
).run();

const loadPersistedData = () => {
  try {
    const row = db.prepare('SELECT value FROM kv_store WHERE key = ?').get('retro-data');
    if (row?.value) {
      return JSON.parse(row.value);
    }
  } catch (err) {
    console.warn('[Server] Failed to load persisted data store', err);
  }
  return { teams: [] };
};

const savePersistedData = (data) => {
  try {
    const payload = JSON.stringify(data ?? { teams: [] });
    db.prepare(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = CURRENT_TIMESTAMP`
    ).run('retro-data', payload);
  } catch (err) {
    console.error('[Server] Failed to write persisted data store', err);
    throw err;
  }
};

let persistedData = loadPersistedData();

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

app.get('/api/data', (_req, res) => {
  res.json(persistedData);
});

app.post('/api/data', (req, res) => {
  try {
    persistedData = req.body ?? { teams: [] };
    savePersistedData(persistedData);
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

app.post('/api/send-password-reset', async (req, res) => {
  if (!smtpEnabled || !mailer) {
    return res.status(501).json({ error: 'email_not_configured' });
  }

  const { email, teamName, resetLink } = req.body || {};
  if (!email || !resetLink || !teamName) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  try {
    await mailer.sendMail({
      from: process.env.FROM_EMAIL || process.env.SMTP_USER,
      to: email,
      subject: `Password Reset - ${teamName}`,
      text: `Hello,

You have requested a password reset for the team "${teamName}".

Click this link to reset your password: ${resetLink}

This link is valid for 1 hour.

If you did not request this reset, please ignore this email.
`,
      html: `<p>Hello,</p>
<p>You have requested a password reset for the team <strong>${teamName}</strong>.</p>
<p><a href="${resetLink}" target="_blank" rel="noreferrer">Click here to reset your password</a></p>
<p>This link is valid for 1 hour.</p>
<p><em>If you did not request this reset, please ignore this email.</em></p>`
    });

    res.status(204).end();
  } catch (err) {
    console.error('[Server] Failed to send password reset email', err);
    res.status(500).json({ error: 'send_failed' });
  }
});

// Super Admin endpoints
// Set SUPER_ADMIN_PASSWORD environment variable to enable super admin access
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;

app.post('/api/super-admin/verify', (req, res) => {
  const { password } = req.body || {};

  if (!SUPER_ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'super_admin_not_configured' });
  }

  if (password === SUPER_ADMIN_PASSWORD) {
    return res.json({ success: true });
  }

  return res.status(401).json({ error: 'invalid_password' });
});

app.get('/api/super-admin/teams', (req, res) => {
  const { password } = req.query;

  if (!SUPER_ADMIN_PASSWORD || password !== SUPER_ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Return all teams data
  res.json(persistedData);
});

app.post('/api/super-admin/update-email', (req, res) => {
  const { password, teamId, facilitatorEmail } = req.body || {};

  if (!SUPER_ADMIN_PASSWORD || password !== SUPER_ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!teamId) {
    return res.status(400).json({ error: 'missing_team_id' });
  }

  const team = persistedData.teams.find(t => t.id === teamId);
  if (!team) {
    return res.status(404).json({ error: 'team_not_found' });
  }

  team.facilitatorEmail = facilitatorEmail || undefined;
  savePersistedData(persistedData);

  res.json({ success: true });
});

// Serve static files from dist folder
app.use(express.static(join(__dirname, 'dist')));

// In-memory storage for sessions (per team)
const sessions = new Map(); // sessionId -> session data
const teamMembers = new Map(); // sessionId -> Map of socketId -> user info

const leaveCurrentSession = (socket) => {
  const sessionId = socket.sessionId;
  if (!sessionId) return;

  console.log(`[Server] ${socket.userName || 'Unknown'} leaving session ${sessionId}`);
  socket.leave(sessionId);

  const members = teamMembers.get(sessionId);
  if (members) {
    members.delete(socket.id);

    const room = io.sockets.adapter.rooms.get(sessionId);
    console.log(`[Server] Session ${sessionId} now has ${room?.size || 0} connected clients`);

    socket.to(sessionId).emit('member-left', {
      userId: socket.userId,
      userName: socket.userName
    });

    const roster = Array.from(members.values());
    io.to(sessionId).emit('member-roster', roster);
  }

  socket.sessionId = null;
};

io.on('connection', (socket) => {
  console.log('[Server] Client connected:', socket.id);

  // Join a session room
  socket.on('join-session', ({ sessionId, userId, userName }) => {
    console.log(`[Server] User ${userName} (${userId}) joining session ${sessionId}`);

    // Leave any previously joined session to avoid cross-room events
    if (socket.sessionId && socket.sessionId !== sessionId) {
      leaveCurrentSession(socket);
    }

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

  // Allow clients to explicitly leave
  socket.on('leave-session', () => {
    leaveCurrentSession(socket);
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
    console.log(`[Server] Client disconnected: ${socket.id} (${socket.userName || 'unknown'})`);

    leaveCurrentSession(socket);
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
