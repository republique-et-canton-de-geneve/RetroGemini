import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { gzipSync, gunzipSync } from 'zlib';
import nodemailer from 'nodemailer';
import Database from 'better-sqlite3';
import pg from 'pg';
import { timingSafeEqual } from 'crypto';
import rateLimit from 'express-rate-limit';
import { createAdapter as createRedisAdapter } from '@socket.io/redis-adapter';
import { createAdapter as createPostgresAdapter } from '@socket.io/postgres-adapter';
import { createClient } from 'redis';
import { resolveSocketAdapterStrategy, SOCKET_ADAPTER_STRATEGIES } from './socketAdapter.js';

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

const buildRedisConfig = () => {
  if (process.env.REDIS_URL) {
    return { url: process.env.REDIS_URL };
  }

  const host = process.env.REDIS_HOST;
  const port = Number(process.env.REDIS_PORT || 6379);
  const password = process.env.REDIS_PASSWORD;

  if (host) {
    return {
      socket: { host, port },
      password: password || undefined
    };
  }

  return null;
};

const initRedisAdapter = async (redisConfig) => {
  try {
    const pubClient = createClient(redisConfig);
    const subClient = pubClient.duplicate();

    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createRedisAdapter(pubClient, subClient));
    console.info('[Server] Using Redis adapter for Socket.IO (multi-pod ready)');
    return true;
  } catch (err) {
    console.error('[Server] Failed to initialize Redis adapter', err);
    return false;
  }
};

const initPostgresAdapter = async () => {
  if (!pgPool) {
    return false;
  }

  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS socket_io_attachments (
        id BIGSERIAL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        payload BYTEA
      )
    `);

    io.adapter(createPostgresAdapter(pgPool));
    console.info('[Server] Using PostgreSQL adapter for Socket.IO (multi-pod ready)');
    return true;
  } catch (err) {
    console.error('[Server] Failed to initialize PostgreSQL adapter', err);
    return false;
  }
};

const initSocketAdapter = async () => {
  const redisConfig = buildRedisConfig();
  const strategy = resolveSocketAdapterStrategy({
    hasRedisConfig: !!redisConfig,
    usePostgres
  });

  if (strategy === SOCKET_ADAPTER_STRATEGIES.REDIS) {
    return initRedisAdapter(redisConfig);
  }

  if (strategy === SOCKET_ADAPTER_STRATEGIES.POSTGRES) {
    return initPostgresAdapter();
  }

  console.info('[Server] Using in-memory Socket.IO adapter (single-pod)');
  return false;
};

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

// ==================== DATABASE ABSTRACTION ====================
// Supports PostgreSQL (multi-pod) and SQLite (single-pod/dev)
// PostgreSQL config: DATABASE_URL or individual POSTGRES_* variables
// If neither is set, SQLite is used

const buildPostgresConfig = () => {
  // Option 1: Full connection URL
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  // Option 2: Individual variables (for OpenShift secrets)
  const host = process.env.POSTGRES_HOST || process.env.POSTGRESQL_SERVICE_HOST;
  const port = process.env.POSTGRES_PORT || process.env.POSTGRESQL_SERVICE_PORT || 5432;
  const user = process.env.POSTGRES_USER || process.env.POSTGRESQL_USER;
  const password = process.env.POSTGRES_PASSWORD || process.env.POSTGRESQL_PASSWORD;
  const database = process.env.POSTGRES_DB || process.env.POSTGRESQL_DATABASE;

  if (host && user && password && database) {
    return { host, port: Number(port), user, password, database };
  }

  return null;
};

const pgConfig = buildPostgresConfig();
const usePostgres = !!pgConfig;

// PostgreSQL setup
let pgPool = null;

const initPostgres = async () => {
  const pool = new pg.Pool({
    ...pgConfig,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => {
    console.error('[Server] Postgres pool error', err);
  });

  // Test connection
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.info('[Server] Using PostgreSQL database (multi-pod ready)');
  } finally {
    client.release();
  }

  return pool;
};

// SQLite setup (fallback for single-pod/dev)
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

const openSqliteDatabase = () => {
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

let sqliteDb = null;

const initSqlite = () => {
  const db = openSqliteDatabase();
  db.pragma('journal_mode = wal');
  db.prepare(
    `CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();
  return db;
};

// Unified data access functions
const loadPersistedData = async () => {
  try {
    if (usePostgres) {
      const result = await pgPool.query('SELECT value FROM kv_store WHERE key = $1', ['retro-data']);
      if (result.rows.length > 0 && result.rows[0].value) {
        return JSON.parse(result.rows[0].value);
      }
    } else {
      const row = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get('retro-data');
      if (row?.value) {
        return JSON.parse(row.value);
      }
    }
  } catch (err) {
    console.warn('[Server] Failed to load persisted data store', err);
  }
  return { teams: [] };
};

const savePersistedData = async (data) => {
  const payload = JSON.stringify(data ?? { teams: [] });

  try {
    if (usePostgres) {
      await pgPool.query(
        `INSERT INTO kv_store (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_at = NOW()`,
        ['retro-data', payload]
      );
    } else {
      sqliteDb.prepare(
        `INSERT INTO kv_store (key, value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = CURRENT_TIMESTAMP`
      ).run('retro-data', payload);
    }
  } catch (err) {
    console.error('[Server] Failed to write persisted data store', err);
    throw err;
  }
};

const loadSessionState = async (sessionId) => {
  const key = `session:${sessionId}`;

  try {
    if (usePostgres) {
      const result = await pgPool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
      if (result.rows.length > 0 && result.rows[0].value) {
        return JSON.parse(result.rows[0].value);
      }
    } else {
      const row = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get(key);
      if (row?.value) {
        return JSON.parse(row.value);
      }
    }
  } catch (err) {
    console.warn('[Server] Failed to load session state', err);
  }

  return null;
};

const saveSessionState = async (sessionId, sessionData) => {
  const key = `session:${sessionId}`;
  const payload = JSON.stringify(sessionData ?? {});

  try {
    if (usePostgres) {
      await pgPool.query(
        `INSERT INTO kv_store (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_at = NOW()`,
        [key, payload]
      );
    } else {
      sqliteDb.prepare(
        `INSERT INTO kv_store (key, value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = CURRENT_TIMESTAMP`
      ).run(key, payload);
    }
  } catch (err) {
    console.error('[Server] Failed to write session state', err);
    throw err;
  }
};

const refreshPersistedData = async () => {
  persistedData = await loadPersistedData();
  return persistedData;
};

// Initialize database based on configuration
const initDatabase = async () => {
  if (usePostgres) {
    pgPool = await initPostgres();
  } else {
    sqliteDb = initSqlite();
  }
};

// Will be populated after database init
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

app.get('/api/data', async (_req, res) => {
  try {
    const currentData = await refreshPersistedData();
    res.json(currentData);
  } catch (err) {
    console.error('[Server] Failed to load persisted data', err);
    res.status(500).json({ error: 'failed_to_load' });
  }
});

app.post('/api/data', async (req, res) => {
  try {
    persistedData = req.body ?? { teams: [] };
    await savePersistedData(persistedData);
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
  refreshPersistedData()
    .then((currentData) => res.json({ teams: currentData.teams }))
    .catch((err) => {
      console.error('[Server] Failed to load persisted data', err);
      res.status(500).json({ error: 'failed_to_load' });
    });
});

app.post('/api/super-admin/update-email', superAdminActionLimiter, async (req, res) => {
  const { password, teamId, facilitatorEmail } = req.body || {};

  if (!SUPER_ADMIN_PASSWORD || !secureCompare(password, SUPER_ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!teamId) {
    return res.status(400).json({ error: 'missing_team_id' });
  }

  await refreshPersistedData();
  const team = persistedData.teams.find(t => t.id === teamId);
  if (!team) {
    return res.status(404).json({ error: 'team_not_found' });
  }

  team.facilitatorEmail = facilitatorEmail || undefined;
  await savePersistedData(persistedData);

  res.json({ success: true });
});

app.post(
  '/api/super-admin/restore',
  superAdminActionLimiter,
  express.raw({
    type: ['application/gzip', 'application/x-gzip', 'application/octet-stream', 'application/json'],
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

    try {
      let data;

      // Try to decompress as gzip first
      try {
        const decompressed = gunzipSync(req.body);
        data = JSON.parse(decompressed.toString('utf8'));
      } catch {
        // If gzip fails, try parsing as plain JSON
        try {
          data = JSON.parse(req.body.toString('utf8'));
        } catch {
          return res.status(400).json({ error: 'invalid_backup_format' });
        }
      }

      // Validate the data structure
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'invalid_backup_data' });
      }

      // Ensure teams array exists
      if (!Array.isArray(data.teams)) {
        data.teams = [];
      }

      // Save to database (works for both SQLite and PostgreSQL)
      await savePersistedData(data);

      // Update in-memory data
      persistedData = data;

      const teamCount = data.teams.length;
      console.info(`[Server] Restored backup: ${teamCount} team(s)`);

      res.json({ success: true, teamsRestored: teamCount });
    } catch (err) {
      console.error('[Server] Failed to restore backup', err);
      res.status(500).json({ error: 'restore_failed' });
    }
  }
);

app.post('/api/super-admin/backup', superAdminActionLimiter, (req, res) => {
  const { password } = req.body || {};

  if (!SUPER_ADMIN_PASSWORD || !secureCompare(password, SUPER_ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  refreshPersistedData()
    .then((currentData) => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `retrogemini-backup-${timestamp}.json.gz`;

      // Export data as gzipped JSON (works for both SQLite and PostgreSQL)
      const jsonData = JSON.stringify(currentData, null, 2);
      const compressed = gzipSync(Buffer.from(jsonData, 'utf8'));

      const teamCount = currentData.teams?.length || 0;
      console.info(`[Server] Creating backup: ${teamCount} team(s)`);

      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(compressed);
    })
    .catch((err) => {
      console.error('[Server] Failed to create backup', err);
      res.status(500).json({ error: 'backup_failed' });
    });
});

// Serve static files from dist folder
app.use(express.static(join(__dirname, 'dist')));

// In-memory cache for sessions (per pod)
const sessions = new Map(); // sessionId -> session data

const buildSessionRoster = async (sessionId) => {
  const sockets = await io.in(sessionId).fetchSockets();
  return sockets
    .map((connectedSocket) => ({
      id: connectedSocket.data.userId,
      name: connectedSocket.data.userName
    }))
    .filter((member) => member.id && member.name);
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

  // Join a session room
  socket.on('join-session', async ({ sessionId, userId, userName }) => {
    console.log(`[Server] User ${userName} (${userId}) joining session ${sessionId}`);

    // Leave any previously joined session to avoid cross-room events
    if (socket.sessionId && socket.sessionId !== sessionId) {
      await leaveCurrentSession(socket);
    }

    socket.join(sessionId);
    socket.sessionId = sessionId;
    socket.userId = userId;
    socket.userName = userName;
    socket.data.userId = userId;
    socket.data.userName = userName;

    // Share current roster (including the new joiner) with everyone in the room
    const roster = await buildSessionRoster(sessionId);
    io.to(sessionId).emit('member-roster', roster);

    // Log current room members
    const room = io.sockets.adapter.rooms.get(sessionId);
    console.log(`[Server] Session ${sessionId} now has ${room?.size || 0} connected clients`);

    // Send current session state to the new joiner
    if (usePostgres || sqliteDb) {
      const persistedSession = await loadSessionState(sessionId);
      if (persistedSession) {
        sessions.set(sessionId, persistedSession);
        console.log(`[Server] Sending persisted session state to ${userName}`);
        socket.emit('session-update', persistedSession);
      } else if (sessions.has(sessionId)) {
        console.log(`[Server] Sending cached session state to ${userName}`);
        socket.emit('session-update', sessions.get(sessionId));
      }
    }

    // Notify others that someone joined
    socket.to(sessionId).emit('member-joined', { userId, userName });
  });

  // Allow clients to explicitly leave
  socket.on('leave-session', async () => {
    await leaveCurrentSession(socket);
  });

  // Update session data
  socket.on('update-session', async (sessionData) => {
    const sessionId = socket.sessionId;
    if (!sessionId) {
      console.warn('[Server] update-session received but socket has no sessionId');
      return;
    }

    console.log(`[Server] Session update from ${socket.userName}, phase: ${sessionData.phase}`);

    // Store and broadcast to all OTHER clients in the session
    sessions.set(sessionId, sessionData);
    try {
      await saveSessionState(sessionId, sessionData);
    } catch (err) {
      console.error('[Server] Failed to persist session state', err);
    }

    // Get room size for logging
    const room = io.sockets.adapter.rooms.get(sessionId);
    console.log(`[Server] Broadcasting to ${(room?.size || 1) - 1} other clients in session ${sessionId}`);

    socket.to(sessionId).emit('session-update', sessionData);
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log(`[Server] Client disconnected: ${socket.id} (${socket.userName || 'unknown'})`);

    await leaveCurrentSession(socket);
  });
});

// Handle SPA routing - serve index.html for all non-API routes
// Use a regex catch-all compatible with Express 5's path-to-regexp
app.get(/.*/, (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;

// Initialize database and start server
const startServer = async () => {
  try {
    await initDatabase();
    persistedData = await loadPersistedData();
    await initSocketAdapter();

    server.listen(PORT, () => {
      console.log(`[Server] Running on port ${PORT}`);
    });
  } catch (err) {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  }
};

startServer();
