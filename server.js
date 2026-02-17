import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import rateLimit from 'express-rate-limit';
import { createDataStore } from './server/services/dataStore.js';
import { createLogService } from './server/services/logService.js';
import { createMailerService } from './server/services/mailerService.js';
import { createTeamService } from './server/services/teamService.js';
import { createTokenService } from './server/services/sessionTokens.js';
import { createVersionService } from './server/services/versionService.js';
import { initSocketAdapter } from './server/services/socketAdapter.js';
import { registerSocketHandlers } from './server/services/socketHandlers.js';
import { escapeHtml, sanitizeEmailLink, secureCompare, hashResetToken, pruneResetTokens } from './server/services/security.js';

import { registerCoreRoutes } from './server/routes/coreRoutes.js';
import { registerFeedbackRoutes } from './server/routes/feedbackRoutes.js';
import { registerPasswordResetRoutes } from './server/routes/passwordResetRoutes.js';
import { registerPublicRoutes } from './server/routes/publicRoutes.js';
import { registerSuperAdminRoutes } from './server/routes/superAdminRoutes.js';
import { registerTeamRoutes } from './server/routes/teamRoutes.js';

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

const corsOrigin = process.env.CORS_ORIGIN || '*';

const io = new Server(server, {
  path: '/socket.io',
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST']
  }
});

const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;

const dataStore = createDataStore({ rootDir: __dirname });
const versionService = createVersionService({ rootDir: __dirname });
const mailerService = createMailerService();
const logService = createLogService();
const tokenService = createTokenService({
  secureCompare,
  superAdminPassword: SUPER_ADMIN_PASSWORD
});
const teamService = createTeamService({ dataStore });
const sessionCache = new Map();

logService.attachConsole();

registerCoreRoutes({ app, versionService });

app.use(express.json({ limit: '1mb' }));

registerPublicRoutes({
  app,
  dataStore,
  mailerService,
  logService,
  escapeHtml,
  sanitizeEmailLink
});

registerTeamRoutes({
  app,
  dataStore,
  teamService,
  tokenService,
  mailerService,
  logService,
  escapeHtml
});

registerFeedbackRoutes({
  app,
  dataStore,
  teamService,
  mailerService,
  logService,
  escapeHtml
});

registerPasswordResetRoutes({
  app,
  dataStore,
  mailerService,
  escapeHtml,
  sanitizeEmailLink,
  hashResetToken,
  pruneResetTokens
});

registerSuperAdminRoutes({
  app,
  io,
  dataStore,
  tokenService,
  mailerService,
  logService,
  escapeHtml,
  superAdminPassword: SUPER_ADMIN_PASSWORD,
  sessionCache
});

registerSocketHandlers({ io, dataStore, sessionCache });

app.use(express.static(join(__dirname, 'dist')));

const staticLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  message: { error: 'too_many_requests', retryAfter: '1 minute' },
  standardHeaders: true,
  legacyHeaders: false
});

app.get(/.*/, staticLimiter, (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await dataStore.initDatabase();
    await dataStore.migrateFromLegacyFormat();
    await initSocketAdapter({ io, dataStore });

    server.listen(PORT, () => {
      console.log(`[Server] Running on port ${PORT}`);
    });
  } catch (err) {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  }
};

startServer();
