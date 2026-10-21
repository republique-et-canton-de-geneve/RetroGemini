/**
 * Run by `__tests__/restoreArchiveRetention.test.ts` as
 * `node --expose-gc restoreArchiveRetention.mjs`, because a vitest worker has
 * no `gc()`. It drives the two whole-store restore routes over HTTP and
 * reports, for each, whether the parsed archive was still reachable while the
 * post-restore passes ran.
 *
 * Why it matters: right after a faithful replace, the password pass
 * (`migrateLegacyPasswords` → `dataStore.loadAllTeams()`) parses every team
 * record again, and those records are the archive's data. A route that keeps
 * the parsed archive in scope across that pass holds two whole-store copies
 * at once — the peak a 384 Mi pod restoring a large row is OOM-killed by,
 * after the replace succeeded and before the audit row was written.
 *
 * Each case answers `{ status, passwords, emails }`: the HTTP status, then
 * whether the archive was reachable in the password pass and in the email
 * pass. The `control` case keeps the archive on purpose, to show this
 * detector sees a retained archive on the V8 it runs on.
 *
 * Plain JS with no test framework: what it prints, as one JSON line, is all
 * the test reads.
 */
import express from 'express';
import { gzipSync } from 'node:zlib';
import { registerSuperAdminRoutes } from '../../server/routes/superAdminRoutes.js';

if (typeof globalThis.gc !== 'function') {
  process.stderr.write('restoreArchiveRetention.mjs needs node --expose-gc\n');
  process.exit(2);
}

// The routes log every pass on `console.info`; only the JSON line is output.
console.info = () => {};
console.warn = () => {};

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 5));

// A WeakRef's target is kept until the end of the task that created or read
// it, so each collection runs in a task of its own.
const stillReachable = async (ref) => {
  for (let i = 0; i < 4; i += 1) {
    await nextTask();
    globalThis.gc();
  }
  return ref ? ref.deref() !== undefined : null;
};

// Large enough that a stray copy is not noise, small enough to run fast.
const makeArchiveData = () => ({
  teams: Array.from({ length: 2000 }, (_, i) => ({ id: `team-${i}`, name: `Team ${i}`, retrospectives: [] }))
});

let current = { ref: null, passwords: null, emails: null };
// The control case's strong reference.
const keptOnPurpose = [];
let keepTheArchive = false;

const dataStore = {
  // The password pass's whole-store read.
  loadAllTeams: async () => {
    current.passwords = await stillReachable(current.ref);
    return [];
  },
  // The email pass's read.
  loadTeamSummaries: async () => {
    current.emails = await stillReachable(current.ref);
    return [];
  },
  loadGlobalSettings: async () => ({}),
  updateGlobalSettings: async (updater) => updater({}) ?? {},
  atomicTeamUpdate: async () => ({ success: true }),
  // The uploaded route's replace: the parsed archive is what it is handed.
  savePersistedData: async (data) => {
    current.ref = new WeakRef(data);
    if (keepTheArchive) keptOnPurpose.push(data);
  }
};

const backupService = {
  listBackups: async () => [{ id: 'backup-1' }],
  createBackup: async () => ({ id: 'snapshot-1', type: 'auto' }),
  deleteBackup: async () => true,
  readBackupArchive: async () => {
    const archive = { filename: 'backup-1.json.gz', data: makeArchiveData() };
    current.ref = new WeakRef(archive.data);
    return archive;
  },
  restoreFromBackup: async (backupId, { archive }) => {
    if (keepTheArchive) keptOnPurpose.push(archive);
    return { id: backupId, filename: archive.filename };
  }
};

const tokenService = {
  validateSuperAdminAuth: (body) => body?.sessionToken === 'admin-token'
};

const app = express();
app.use(express.json());
registerSuperAdminRoutes({
  app,
  io: { fetchSockets: async () => [], serverSideEmit: () => {} },
  dataStore,
  tokenService,
  mailerService: { smtpEnabled: false, mailer: null },
  logService: { addServerLog: () => {}, getServerLogs: () => [], clearServerLogs: () => {} },
  escapeHtml: (value) => String(value ?? ''),
  superAdminPassword: undefined,
  sessionCache: new Map(),
  backupService,
  aiService: {},
  serverRuntime: { multiPodAdapter: false }
});

const server = await new Promise((resolve) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const base = `http://127.0.0.1:${server.address().port}`;

const restoreStored = () => fetch(`${base}/api/super-admin/backups/restore`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionToken: 'admin-token', backupId: 'backup-1' })
});

const restoreUploaded = () => fetch(`${base}/api/super-admin/restore`, {
  method: 'POST',
  headers: { 'content-type': 'application/octet-stream', 'x-super-admin-session-token': 'admin-token' },
  body: gzipSync(Buffer.from(JSON.stringify(makeArchiveData())))
});

const run = async (send, { keep = false } = {}) => {
  current = { ref: null, passwords: null, emails: null };
  keepTheArchive = keep;
  keptOnPurpose.length = 0;
  const response = await send();
  await response.arrayBuffer();
  const result = { status: response.status, passwords: current.passwords, emails: current.emails };
  keptOnPurpose.length = 0;
  return result;
};

const results = {
  control: await run(restoreStored, { keep: true }),
  stored: await run(restoreStored),
  uploaded: await run(restoreUploaded)
};

process.stdout.write(`${JSON.stringify(results)}\n`);
server.close();
process.exit(0);
