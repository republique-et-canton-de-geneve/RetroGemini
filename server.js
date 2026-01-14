import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import nodemailer from 'nodemailer';
import Database from 'better-sqlite3';
import { timingSafeEqual } from 'crypto';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

const trustProxySetting = (() => {
  if (process.env.TRUST_PROXY === 'true') return true;
  if (process.env.TRUST_PROXY === 'false') return false;
  if (process.env.TRUST_PROXY) {
    const numericValue = Number(process.env.TRUST_PROXY);
    return Number.isNaN(numericValue) ? true : numericValue;
  }
  return process.env.NODE_ENV === 'production' ? 1 : false;
})();

app.set('trust proxy', trustProxySetting);

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

// ==================== VERSION & ANNOUNCEMENTS ====================

/**
 * Parse CHANGELOG.md and extract version announcements
 * @returns {{ current: string, announcements: Array<{ version: string, date: string, items: Array<{ type: string, description: string }> }> }}
 */
const parseVersionAndChangelog = () => {
  let currentVersion = '1.0';
  const announcements = [];

  // Read VERSION file
  try {
    const versionPath = join(__dirname, 'VERSION');
    if (fs.existsSync(versionPath)) {
      currentVersion = fs.readFileSync(versionPath, 'utf8').trim();
    }
  } catch (err) {
    console.warn('[Server] Failed to read VERSION file:', err?.message);
  }

  // Parse CHANGELOG.md
  try {
    const changelogPath = join(__dirname, 'CHANGELOG.md');
    if (fs.existsSync(changelogPath)) {
      const content = fs.readFileSync(changelogPath, 'utf8');

      // Split content by version headers
      const versionBlocks = content.split(/(?=^## \[)/m).filter(block => block.trim());

      for (const block of versionBlocks) {
        const headerMatch = block.match(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})/);
        if (!headerMatch) continue;

        const version = headerMatch[1];
        const date = headerMatch[2];
        const items = [];

        // Map section names to announcement types
        const typeMap = {
          'Added': 'feature',
          'Changed': 'improvement',
          'Fixed': 'fix',
          'Removed': 'removed',
          'Security': 'security'
        };

        // Find all sections and their items
        const sections = block.split(/^### /m).slice(1);
        for (const section of sections) {
          const lines = section.split('\n');
          const sectionName = lines[0].trim();
          const type = typeMap[sectionName];

          if (!type) continue;

          // Extract bullet points (lines starting with -)
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('-') && !line.match(/^-+$/)) {
              const description = line.substring(1).trim();
              if (description && !description.startsWith('<!--') && !description.match(/^-+$/)) {
                items.push({ type, description });
              }
            }
          }
        }

        if (items.length > 0) {
          announcements.push({ version, date, items });
        }
      }
    }
  } catch (err) {
    console.warn('[Server] Failed to parse CHANGELOG.md:', err?.message);
  }

  return { current: currentVersion, announcements };
};

// Cache version info (reload on each request in dev, cache in production)
let cachedVersionInfo = null;
let versionCacheTime = 0;
const VERSION_CACHE_TTL = process.env.NODE_ENV === 'production' ? 60000 : 0; // 1 minute in prod

app.get('/api/version', (_req, res) => {
  const now = Date.now();
  if (!cachedVersionInfo || (now - versionCacheTime) > VERSION_CACHE_TTL) {
    cachedVersionInfo = parseVersionAndChangelog();
    versionCacheTime = now;
  }
  res.json(cachedVersionInfo);
});

app.use(express.json({ limit: '1mb' }));

const shouldSkipSuperAdminLimit = (req) => {
  if (req.path.startsWith('/api/super-admin')) {
    return !process.env.SUPER_ADMIN_PASSWORD;
  }
  return false;
};

// Rate limiting for authentication endpoints to prevent brute force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: { error: 'too_many_attempts', retryAfter: '15 minutes' },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip rate limiting if super admin is not configured
  skip: shouldSkipSuperAdminLimit
});

const superAdminActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'too_many_attempts', retryAfter: '15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipSuperAdminLimit
});

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

const clearDirectoryContents = (dirPath) => {
  const entries = fs.readdirSync(dirPath);
  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
};

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

/**
 * Constant-time string comparison to prevent timing attacks
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} - True if strings are equal
 */
const secureCompare = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  // Convert strings to buffers of equal length to prevent length-based timing attacks
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  // If lengths differ, compare against a dummy buffer to maintain constant time
  if (bufferA.length !== bufferB.length) {
    // Still perform a comparison to avoid timing leak on length check
    timingSafeEqual(bufferA, bufferA);
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
};

app.post('/api/super-admin/verify', authLimiter, (req, res) => {
  const { password } = req.body || {};

  if (!SUPER_ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'super_admin_not_configured' });
  }

  if (secureCompare(password, SUPER_ADMIN_PASSWORD)) {
    return res.json({ success: true });
  }

  return res.status(401).json({ error: 'invalid_password' });
});

app.post('/api/super-admin/teams', superAdminActionLimiter, (req, res) => {
  const { password } = req.body || {};

  if (!SUPER_ADMIN_PASSWORD || !secureCompare(password, SUPER_ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Return all teams data
  res.json({ teams: persistedData.teams });
});

app.post('/api/super-admin/update-email', superAdminActionLimiter, (req, res) => {
  const { password, teamId, facilitatorEmail } = req.body || {};

  if (!SUPER_ADMIN_PASSWORD || !secureCompare(password, SUPER_ADMIN_PASSWORD)) {
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

app.post(
  '/api/super-admin/restore',
  superAdminActionLimiter,
  express.raw({
    type: ['application/gzip', 'application/x-gzip', 'application/octet-stream'],
    limit: '1gb'
  }),
  async (req, res) => {
    const password = req.header('x-super-admin-password');

    if (!SUPER_ADMIN_PASSWORD || !secureCompare(password, SUPER_ADMIN_PASSWORD)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (!req.body || !(req.body instanceof Buffer) || req.body.length === 0) {
      return res.status(400).json({ error: 'missing_archive' });
    }

    const dataDir = '/data';
    const tempArchivePath = join('/tmp', `retrogemini-restore-${Date.now()}.tar.gz`);

    try {
      fs.mkdirSync(dirname(tempArchivePath), { recursive: true });
      await fs.promises.writeFile(tempArchivePath, req.body);

      fs.mkdirSync(dataDir, { recursive: true });
      fs.accessSync(dataDir, fs.constants.W_OK);
      clearDirectoryContents(dataDir);

      await new Promise((resolve, reject) => {
        const tarProcess = spawn('tar', ['-xzf', tempArchivePath, '-C', dataDir]);

        tarProcess.on('error', (err) => {
          reject(err);
        });

        tarProcess.stderr.on('data', (data) => {
          console.warn(`[Server] Restore archive stderr: ${data.toString().trim()}`);
        });

        tarProcess.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Restore archive process exited with code ${code}`));
          }
        });
      });

      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to restore backup archive', err);
      if (err?.code === 'EACCES') {
        res.status(403).json({ error: 'restore_forbidden' });
        return;
      }
      res.status(500).json({ error: 'restore_failed' });
    } finally {
      fs.rm(tempArchivePath, { force: true }, () => {});
    }
  }
);

app.post('/api/super-admin/backup', superAdminActionLimiter, (req, res) => {
  const { password } = req.body || {};

  if (!SUPER_ADMIN_PASSWORD || !secureCompare(password, SUPER_ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const dataDir = '/data';
  if (!fs.existsSync(dataDir)) {
    return res.status(404).json({ error: 'data_directory_missing' });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `retrogemini-backup-${timestamp}.tar.gz`;

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');

  const tarProcess = spawn('tar', ['-czf', '-', '-C', dataDir, '.']);

  tarProcess.on('error', (err) => {
    console.error('[Server] Failed to create backup archive', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'backup_failed' });
    } else {
      res.end();
    }
  });

  tarProcess.stderr.on('data', (data) => {
    console.warn(`[Server] Backup archive stderr: ${data.toString().trim()}`);
  });

  tarProcess.stdout.pipe(res);

  tarProcess.on('close', (code) => {
    if (code !== 0) {
      console.error(`[Server] Backup archive process exited with code ${code}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'backup_failed' });
      } else {
        res.end();
      }
    }
  });
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
