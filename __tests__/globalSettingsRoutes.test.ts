import express from 'express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDataStore } from '../server/services/dataStore.js';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';
import { postJson, request } from './helpers/routeTestServer';

/**
 * The five console routes that write one key of `global-settings`, against a
 * real SQLite store.
 *
 * The row holds the admin email, the new-team notification switch, the info
 * banner and the whole AI configuration (endpoint, key, model). Each route used
 * to load the row, change its own key and save the whole blob back — and the
 * load answers `{}` when the read fails. One database hiccup while saving the
 * banner therefore wrote `{ infoMessage }` alone over the row and erased every
 * other setting, while the route answered success. A route now changes its key
 * through `updateGlobalSettings`, whose read is strict: when it fails, the route
 * answers `500 failed_to_save` and the row is exactly as it was.
 *
 * The failure is injected into the SQLite driver itself, so it does not matter
 * which store function a route calls — which is what lets it fail on the code it
 * replaced. Two shapes of failure, because each catches a different regression:
 * every read failing catches a route that saves what a failed read answered, and
 * only the first read failing catches a route that reads the settings leniently
 * and then hands that copy to an update which ignores the row it locked — there
 * the update's own read succeeds, and the `{}` from the first read is written.
 */

const PG_ENV_KEYS = [
  'DATABASE_URL',
  'POSTGRES_HOST',
  'POSTGRESQL_SERVICE_HOST',
  'POSTGRES_USER',
  'POSTGRESQL_USER',
  'POSTGRES_PASSWORD',
  'POSTGRESQL_PASSWORD',
  'POSTGRES_DB',
  'POSTGRESQL_DATABASE',
  'DATA_STORE_PATH'
];

const SETTINGS_KEY = 'global-settings';
const VALID_TOKEN = 'super-admin-token';

const STORED = {
  adminEmail: 'admin@example.test',
  notifyNewTeam: true,
  infoMessage: 'Maintenance on Friday',
  ai: {
    enabled: true,
    apiUrl: 'https://llm.internal.example/v1',
    apiKey: 'sk-stored-key',
    model: 'mistral',
    allowSelfSignedCerts: false
  }
};

type Store = ReturnType<typeof createDataStore>;
type Statement = { get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown };

// The next `failures` SELECTs that name the settings row throw (all of them by
// default), while `failing.on` is set. The other rows, and every write, still
// work — a read that fails on its own is the case the old code turned into an
// erase.
const failSettingsReads = (store: Store, failures = Infinity) => {
  const db = store.getSqliteDb()! as unknown as { prepare: (sql: string) => Statement };
  const realPrepare = db.prepare.bind(db);
  const failing = { on: true, remaining: failures };
  db.prepare = (sql: string) => {
    const statement = realPrepare(sql);
    if (!/^\s*SELECT/i.test(sql)) return statement;
    return new Proxy(statement, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if ((property === 'get' || property === 'all') && typeof value === 'function') {
          return (...args: unknown[]) => {
            if (failing.on && failing.remaining > 0 && args.includes(SETTINGS_KEY)) {
              failing.remaining -= 1;
              throw new Error('disk I/O error');
            }
            return value.apply(target, args);
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };
  return failing;
};

const readRaw = (store: Store): string | null => {
  const row = store.getSqliteDb()!
    .prepare('SELECT value FROM kv_store WHERE key = ?')
    .get(SETTINGS_KEY) as { value: string } | undefined;
  return row?.value ?? null;
};

const writeRaw = (store: Store, value: string) => {
  store.getSqliteDb()!.prepare(
    'INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(SETTINGS_KEY, value);
};

const buildApp = (dataStore: Store) => {
  const app = express();
  app.use(express.json());
  const aiService = { suggestGroupTitle: vi.fn(async () => 'A suggested title') };
  registerSuperAdminRoutes({
    app,
    io: { fetchSockets: vi.fn(async () => []), serverSideEmit: vi.fn() },
    dataStore,
    tokenService: {
      validateSuperAdminAuth: (body: { sessionToken?: string } | undefined) => body?.sessionToken === VALID_TOKEN
    },
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn(), getServerLogs: vi.fn(() => []), clearServerLogs: vi.fn() },
    escapeHtml: (value: string) => String(value ?? ''),
    superAdminPassword: 'super-secret',
    sessionCache: new Map(),
    backupService: {},
    aiService,
    serverRuntime: { multiPodAdapter: false }
  });
  return { app, aiService };
};

const auth = (body: Record<string, unknown>) => ({ sessionToken: VALID_TOKEN, ...body });

// Each route, the body that changes its key, and the key as it is then stored.
const WRITERS: [string, Record<string, unknown>, (settings: Record<string, any>) => void][] = [
  ['/api/super-admin/info-message', { infoMessage: 'New banner' }, (s) => {
    expect(s.infoMessage).toBe('New banner');
  }],
  ['/api/super-admin/update-admin-email', { adminEmail: 'New@Example.test;' }, (s) => {
    expect(s.adminEmail).toBe('new@example.test');
  }],
  ['/api/super-admin/update-notify-new-team', { notifyNewTeam: false }, (s) => {
    expect(s.notifyNewTeam).toBe(false);
  }],
  ['/api/super-admin/update-ai-settings', { enabled: true, apiUrl: ' https://llm.other.example/v1 ', apiKey: 'sk-new', model: 'llama' }, (s) => {
    expect(s.ai).toEqual({ enabled: true, apiUrl: 'https://llm.other.example/v1', apiKey: 'sk-new', model: 'llama', allowSelfSignedCerts: false });
  }],
  ['/api/super-admin/test-ai', { apiUrl: 'https://llm.other.example/v1', apiKey: 'sk-new', model: 'llama' }, (s) => {
    expect(s.ai).toEqual({ enabled: true, apiUrl: 'https://llm.other.example/v1', apiKey: 'sk-new', model: 'llama', allowSelfSignedCerts: false });
  }]
];

const KEY_OF: Record<string, keyof typeof STORED> = {
  '/api/super-admin/info-message': 'infoMessage',
  '/api/super-admin/update-admin-email': 'adminEmail',
  '/api/super-admin/update-notify-new-team': 'notifyNewTeam',
  '/api/super-admin/update-ai-settings': 'ai',
  '/api/super-admin/test-ai': 'ai'
};

describe('console routes writing global-settings (SQLite)', () => {
  let dataStore: Store;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-global-settings-routes-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();
    writeRaw(dataStore, JSON.stringify(STORED));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await dataStore.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    for (const key of PG_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it.each(WRITERS)('%s answers 500 and erases nothing when the settings cannot be read', async (path, body) => {
    const { app, aiService } = buildApp(dataStore);
    const before = readRaw(dataStore);
    const failing = failSettingsReads(dataStore);

    const response = await request(app, path, postJson(auth(body)));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'failed_to_save' });
    // Not run with half-saved settings, nor with the old ones.
    expect(aiService.suggestGroupTitle).not.toHaveBeenCalled();

    failing.on = false;
    expect(readRaw(dataStore)).toBe(before);
    expect(await dataStore.loadGlobalSettings()).toEqual(STORED);
  });

  it.each(WRITERS)('%s erases nothing when only the first read of the settings fails', async (path, body) => {
    // A transient error: the next read works. A route that read the row
    // leniently first would get `{}` here, and an update that wrote that copy
    // instead of the row it locked would save this one key over everything.
    const { app, aiService } = buildApp(dataStore);
    const before = readRaw(dataStore);
    failSettingsReads(dataStore, 1);

    const response = await request(app, path, postJson(auth(body)));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'failed_to_save' });
    expect(aiService.suggestGroupTitle).not.toHaveBeenCalled();
    expect(readRaw(dataStore)).toBe(before);
  });

  it.each(WRITERS)('%s answers 500 and leaves an unreadable row as it is', async (path, body) => {
    // A row that does not parse is not "nothing configured": writing the one
    // key over it would throw away whatever a repair could still recover.
    writeRaw(dataStore, '{"adminEmail":"admin@example.test",');
    const { app, aiService } = buildApp(dataStore);

    const response = await request(app, path, postJson(auth(body)));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'failed_to_save' });
    expect(aiService.suggestGroupTitle).not.toHaveBeenCalled();
    expect(readRaw(dataStore)).toBe('{"adminEmail":"admin@example.test",');
  });

  it.each(WRITERS)('%s stores its own key and keeps every other', async (path, body, expectStored) => {
    const { app } = buildApp(dataStore);

    const response = await request(app, path, postJson(auth(body)));

    expect(response.status).toBe(200);
    const stored = await dataStore.loadGlobalSettings();
    expectStored(stored);
    const key = KEY_OF[path];
    const { [key]: _changed, ...others } = stored;
    const { [key]: _before, ...othersBefore } = STORED;
    expect(others).toEqual(othersBefore);
  });

  it('runs the AI test once the form values are saved', async () => {
    const { app, aiService } = buildApp(dataStore);

    const response = await request(app, '/api/super-admin/test-ai', postJson(auth({ apiUrl: 'https://llm.other.example/v1' })));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, response: 'A suggested title' });
    expect(aiService.suggestGroupTitle).toHaveBeenCalledTimes(1);
  });
});
