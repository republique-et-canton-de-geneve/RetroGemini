import fs from 'fs';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';
import pg from 'pg';

const createDataStore = ({ rootDir }) => {
  const buildPostgresConfig = () => {
    if (process.env.DATABASE_URL) {
      return { connectionString: process.env.DATABASE_URL };
    }

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

  let pgPool = null;
  let sqliteDb = null;

  const initPostgres = async () => {
    const pool = new pg.Pool({
      ...pgConfig,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
    pool.on('error', (err) => {
      console.error('[Server] Postgres pool error', err);
    });

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

  const resolveDataStoreCandidates = () => {
    const candidates = [];

    if (process.env.DATA_STORE_PATH) {
      candidates.push(process.env.DATA_STORE_PATH);
    }

    candidates.push('/data/data.sqlite');
    candidates.push(join('/tmp', 'data.sqlite'));
    candidates.push(join(rootDir, 'data.sqlite'));

    return candidates;
  };

  const openSqliteDatabase = () => {
    const errors = [];

    for (const candidate of resolveDataStoreCandidates()) {
      try {
        fs.mkdirSync(dirname(candidate), { recursive: true });
        const database = new Database(candidate);
        console.info(`[Server] Using SQLite store at ${candidate}`);

        if (candidate.startsWith('/tmp')) {
          console.warn('');
          console.warn('┌─────────────────────────────────────────────────────────────────────────┐');
          console.warn('│ ⚠️  WARNING: Using ephemeral storage (/tmp)                           │');
          console.warn('│    Data will be LOST when the container restarts!                    │');
          console.warn('│                                                                      │');
          console.warn('│    To persist data:                                                  │');
          console.warn('│    - Railway: Add a Volume mounted at /data                          │');
          console.warn('│    - Docker: Use -v /host/path:/data                                 │');
          console.warn('│    - K8s/OpenShift: Create a PVC mounted at /data                    │');
          console.warn('│    - Or set DATA_STORE_PATH to a persistent location                 │');
          console.warn('└─────────────────────────────────────────────────────────────────────────┘');
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

  const normalizePersistedData = (data) => {
    const normalized = data && typeof data === 'object' ? data : { teams: [] };
    if (!Array.isArray(normalized.teams)) {
      normalized.teams = [];
    }

    if (!normalized.meta || typeof normalized.meta !== 'object') {
      normalized.meta = {
        revision: 0,
        updatedAt: new Date().toISOString()
      };
    } else {
      if (typeof normalized.meta.revision !== 'number') {
        normalized.meta.revision = 0;
      }
      if (!normalized.meta.updatedAt) {
        normalized.meta.updatedAt = new Date().toISOString();
      }
    }

    if (!Array.isArray(normalized.resetTokens)) {
      normalized.resetTokens = [];
    }

    if (!Array.isArray(normalized.orphanedFeedbacks)) {
      normalized.orphanedFeedbacks = [];
    }

    return normalized;
  };

  const bumpPersistedDataMeta = (data) => {
    const normalized = normalizePersistedData(data);
    return {
      ...normalized,
      meta: {
        revision: (normalized.meta.revision || 0) + 1,
        updatedAt: new Date().toISOString()
      }
    };
  };

  const loadPersistedData = async () => {
    try {
      if (usePostgres) {
        const result = await pgPool.query('SELECT value FROM kv_store WHERE key = $1', ['retro-data']);
        if (result.rows.length > 0 && result.rows[0].value) {
          return normalizePersistedData(JSON.parse(result.rows[0].value));
        }
      } else {
        const row = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get('retro-data');
        if (row?.value) {
          return normalizePersistedData(JSON.parse(row.value));
        }
      }
    } catch (err) {
      console.warn('[Server] Failed to load persisted data store', err);
    }
    return normalizePersistedData({ teams: [] });
  };

  const savePersistedData = async (data) => {
    const updatedData = bumpPersistedDataMeta(data);
    const payload = JSON.stringify(updatedData ?? normalizePersistedData({ teams: [] }));

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
      return updatedData;
    } catch (err) {
      console.error('[Server] Failed to write persisted data store', err);
      throw err;
    }
  };

  const atomicSavePersistedData = async (incomingData, expectedRevision) => {
    const nextData = bumpPersistedDataMeta({ ...incomingData, meta: { revision: expectedRevision, updatedAt: '' } });
    const payload = JSON.stringify(nextData);

    try {
      if (usePostgres) {
        const client = await pgPool.connect();
        try {
          await client.query('BEGIN');
          const lockResult = await client.query(
            'SELECT value FROM kv_store WHERE key = $1 FOR UPDATE',
            ['retro-data']
          );

          const currentValue = lockResult.rows.length > 0 && lockResult.rows[0].value
            ? normalizePersistedData(JSON.parse(lockResult.rows[0].value))
            : normalizePersistedData({ teams: [] });
          const serverRevision = Number(currentValue.meta?.revision ?? 0);

          if (expectedRevision !== serverRevision) {
            await client.query('ROLLBACK');
            return { success: false, data: currentValue };
          }

          await client.query(
            `INSERT INTO kv_store (key, value, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET
               value = EXCLUDED.value,
               updated_at = NOW()`,
            ['retro-data', payload]
          );
          await client.query('COMMIT');
          return { success: true, data: nextData };
        } catch (txErr) {
          await client.query('ROLLBACK').catch(() => {});
          throw txErr;
        } finally {
          client.release();
        }
      } else {
        const result = sqliteDb.transaction(() => {
          const row = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get('retro-data');
          const currentValue = row?.value
            ? normalizePersistedData(JSON.parse(row.value))
            : normalizePersistedData({ teams: [] });
          const serverRevision = Number(currentValue.meta?.revision ?? 0);

          if (expectedRevision !== serverRevision) {
            return { success: false, data: currentValue };
          }

          sqliteDb.prepare(
            `INSERT INTO kv_store (key, value, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = CURRENT_TIMESTAMP`
          ).run('retro-data', payload);
          return { success: true, data: nextData };
        })();
        return result;
      }
    } catch (err) {
      console.error('[Server] Failed atomic save', err);
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

    const currentRev = Number(sessionData?._rev ?? 0);
    const dataWithRev = { ...sessionData, _rev: currentRev + 1, _updatedAt: new Date().toISOString() };
    const payload = JSON.stringify(dataWithRev);

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
      return dataWithRev;
    } catch (err) {
      console.error('[Server] Failed to write session state', err);
      throw err;
    }
  };

  const refreshPersistedData = async () => {
    persistedData = await loadPersistedData();
    return persistedData;
  };

  const loadGlobalSettings = async () => {
    try {
      if (usePostgres) {
        const result = await pgPool.query('SELECT value FROM kv_store WHERE key = $1', ['global-settings']);
        if (result.rows.length > 0 && result.rows[0].value) {
          return JSON.parse(result.rows[0].value);
        }
      } else {
        const row = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get('global-settings');
        if (row?.value) {
          return JSON.parse(row.value);
        }
      }
    } catch (err) {
      console.warn('[Server] Failed to load global settings', err);
    }
    return {};
  };

  const saveGlobalSettings = async (settings) => {
    const payload = JSON.stringify(settings ?? {});

    try {
      if (usePostgres) {
        await pgPool.query(
          `INSERT INTO kv_store (key, value, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET
             value = EXCLUDED.value,
             updated_at = NOW()`,
          ['global-settings', payload]
        );
      } else {
        sqliteDb.prepare(
          `INSERT INTO kv_store (key, value, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             updated_at = CURRENT_TIMESTAMP`
        ).run('global-settings', payload);
      }
    } catch (err) {
      console.error('[Server] Failed to write global settings', err);
      throw err;
    }
  };

  const initDatabase = async () => {
    if (usePostgres) {
      pgPool = await initPostgres();
    } else {
      sqliteDb = initSqlite();
    }
  };

  let persistedData = normalizePersistedData({ teams: [] });

  const setPersistedData = (data) => {
    persistedData = normalizePersistedData(data);
  };

  const getPersistedData = () => persistedData;

  const atomicReadModifyWrite = async (mutator) => {
    const MAX_RETRIES = 5;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const currentData = await loadPersistedData();
      const modified = mutator(currentData);
      if (!modified) return currentData;

      const revision = Number(currentData.meta?.revision ?? 0);
      const result = await atomicSavePersistedData(modified, revision);
      if (result.success) {
        setPersistedData(result.data);
        return result.data;
      }
      console.warn(`[Server] Operation conflict, retry ${attempt + 1}/${MAX_RETRIES}`);
    }
    throw new Error('Failed to save after max retries');
  };

  const getPgPool = () => pgPool;
  const getSqliteDb = () => sqliteDb;

  return {
    initDatabase,
    loadPersistedData,
    savePersistedData,
    atomicSavePersistedData,
    atomicReadModifyWrite,
    loadSessionState,
    saveSessionState,
    refreshPersistedData,
    loadGlobalSettings,
    saveGlobalSettings,
    getPersistedData,
    setPersistedData,
    getPgPool,
    getSqliteDb,
    usePostgres
  };
};

export { createDataStore };
