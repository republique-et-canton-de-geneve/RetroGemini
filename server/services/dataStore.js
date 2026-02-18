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

  // ---------------------------------------------------------------------------
  // Low-level KV helpers
  // ---------------------------------------------------------------------------

  const kvGet = async (key) => {
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
    return null;
  };

  const kvSet = async (key, value) => {
    const payload = JSON.stringify(value);
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
  };

  const kvDelete = async (key) => {
    if (usePostgres) {
      await pgPool.query('DELETE FROM kv_store WHERE key = $1', [key]);
    } else {
      sqliteDb.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
    }
  };

  const kvGetMultipleByPrefix = async (prefix) => {
    if (usePostgres) {
      const result = await pgPool.query(
        'SELECT key, value FROM kv_store WHERE key LIKE $1',
        [prefix + '%']
      );
      return result.rows.map((row) => ({ key: row.key, value: JSON.parse(row.value) }));
    } else {
      const rows = sqliteDb.prepare('SELECT key, value FROM kv_store WHERE key LIKE ?').all(prefix + '%');
      return rows.map((row) => ({ key: row.key, value: JSON.parse(row.value) }));
    }
  };

  // ---------------------------------------------------------------------------
  // Per-team atomic compare-and-swap
  // ---------------------------------------------------------------------------

  const atomicTeamSave = async (teamId, teamData, expectedRevision) => {
    const key = `team:${teamId}`;
    const nextRev = expectedRevision + 1;
    const nextData = { ...teamData, _rev: nextRev, _updatedAt: new Date().toISOString() };
    const payload = JSON.stringify(nextData);

    try {
      if (usePostgres) {
        const client = await pgPool.connect();
        try {
          await client.query('BEGIN');
          const lockResult = await client.query(
            'SELECT value FROM kv_store WHERE key = $1 FOR UPDATE',
            [key]
          );

          const currentValue = lockResult.rows.length > 0 && lockResult.rows[0].value
            ? JSON.parse(lockResult.rows[0].value)
            : null;
          const serverRevision = currentValue ? Number(currentValue._rev ?? 0) : 0;

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
            [key, payload]
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
          const row = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get(key);
          const currentValue = row?.value ? JSON.parse(row.value) : null;
          const serverRevision = currentValue ? Number(currentValue._rev ?? 0) : 0;

          if (expectedRevision !== serverRevision) {
            return { success: false, data: currentValue };
          }

          sqliteDb.prepare(
            `INSERT INTO kv_store (key, value, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = CURRENT_TIMESTAMP`
          ).run(key, payload);
          return { success: true, data: nextData };
        })();
        return result;
      }
    } catch (err) {
      console.error(`[Server] Failed atomic team save for ${teamId}`, err);
      throw err;
    }
  };

  // ---------------------------------------------------------------------------
  // Per-team read-modify-write (replaces atomicUpdateTeam pattern)
  // ---------------------------------------------------------------------------

  const atomicTeamUpdate = async (teamId, updater) => {
    const MAX_RETRIES = 5;
    const key = `team:${teamId}`;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const teamData = await kvGet(key);
      if (!teamData) {
        return { success: false, error: 'team_not_found' };
      }

      const { _rev, _updatedAt, ...cleanTeam } = teamData;
      const updatedTeam = updater(cleanTeam);
      if (!updatedTeam) {
        return { success: true, team: cleanTeam };
      }

      const revision = Number(_rev ?? 0);
      const result = await atomicTeamSave(teamId, updatedTeam, revision);

      if (result.success) {
        return { success: true, team: updatedTeam };
      }

      if (attempt < MAX_RETRIES - 1) {
        console.warn(`[Server] Team update conflict for ${teamId}, retry ${attempt + 1}/${MAX_RETRIES}`);
      }
    }

    return { success: false, error: 'max_retries_exceeded' };
  };

  // ---------------------------------------------------------------------------
  // Team index: maps team names to IDs for fast login lookups
  // Uses Map internally to prevent prototype pollution from user-provided keys
  // ---------------------------------------------------------------------------

  const indexToMap = (data) => {
    const map = new Map();
    if (data?.teams && typeof data.teams === 'object') {
      for (const [k, v] of Object.entries(data.teams)) {
        map.set(k, v);
      }
    }
    return map;
  };

  const mapToIndex = (map) => {
    const teams = Object.create(null);
    for (const [k, v] of map.entries()) {
      teams[k] = v;
    }
    return { teams };
  };

  const loadTeamIndex = async () => {
    const data = await kvGet('team-index');
    return indexToMap(data);
  };

  const saveTeamIndex = async (map) => {
    await kvSet('team-index', mapToIndex(map));
  };

  const atomicTeamIndexUpdate = async (updater) => {
    const MAX_RETRIES = 5;
    const key = 'team-index';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (usePostgres) {
        const client = await pgPool.connect();
        try {
          await client.query('BEGIN');
          const lockResult = await client.query(
            'SELECT value FROM kv_store WHERE key = $1 FOR UPDATE',
            [key]
          );
          const raw = lockResult.rows.length > 0 && lockResult.rows[0].value
            ? JSON.parse(lockResult.rows[0].value)
            : { teams: {} };
          const currentMap = indexToMap(raw);

          const updatedMap = updater(currentMap);
          if (!updatedMap) {
            await client.query('ROLLBACK');
            return currentMap;
          }

          await client.query(
            `INSERT INTO kv_store (key, value, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET
               value = EXCLUDED.value,
               updated_at = NOW()`,
            [key, JSON.stringify(mapToIndex(updatedMap))]
          );
          await client.query('COMMIT');
          return updatedMap;
        } catch (txErr) {
          await client.query('ROLLBACK').catch(() => {});
          if (attempt < MAX_RETRIES - 1) {
            console.warn(`[Server] Team index update conflict, retry ${attempt + 1}/${MAX_RETRIES}`);
            continue;
          }
          throw txErr;
        } finally {
          client.release();
        }
      } else {
        try {
          const result = sqliteDb.transaction(() => {
            const row = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get(key);
            const raw = row?.value ? JSON.parse(row.value) : { teams: {} };
            const currentMap = indexToMap(raw);

            const updatedMap = updater(currentMap);
            if (!updatedMap) return currentMap;

            sqliteDb.prepare(
              `INSERT INTO kv_store (key, value, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET
                 value = excluded.value,
                 updated_at = CURRENT_TIMESTAMP`
            ).run(key, JSON.stringify(mapToIndex(updatedMap)));
            return updatedMap;
          })();
          return result;
        } catch (err) {
          if (attempt < MAX_RETRIES - 1) {
            console.warn(`[Server] Team index update conflict, retry ${attempt + 1}/${MAX_RETRIES}`);
            continue;
          }
          throw err;
        }
      }
    }
    throw new Error('Failed to update team index after max retries');
  };

  // ---------------------------------------------------------------------------
  // Metadata store (resetTokens, orphanedFeedbacks) - separate from teams
  // ---------------------------------------------------------------------------

  const normalizeMetaData = (data) => {
    const normalized = data && typeof data === 'object' ? data : {};
    if (!Array.isArray(normalized.resetTokens)) {
      normalized.resetTokens = [];
    }
    if (!Array.isArray(normalized.orphanedFeedbacks)) {
      normalized.orphanedFeedbacks = [];
    }
    return normalized;
  };

  const loadMetaData = async () => {
    const data = await kvGet('retro-meta');
    return normalizeMetaData(data);
  };

  const saveMetaData = async (data) => {
    await kvSet('retro-meta', normalizeMetaData(data));
  };

  const atomicMetaUpdate = async (updater) => {
    const MAX_RETRIES = 5;
    const key = 'retro-meta';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (usePostgres) {
        const client = await pgPool.connect();
        try {
          await client.query('BEGIN');
          const lockResult = await client.query(
            'SELECT value FROM kv_store WHERE key = $1 FOR UPDATE',
            [key]
          );
          const currentValue = lockResult.rows.length > 0 && lockResult.rows[0].value
            ? normalizeMetaData(JSON.parse(lockResult.rows[0].value))
            : normalizeMetaData({});

          const updated = updater(currentValue);
          if (!updated) {
            await client.query('ROLLBACK');
            return currentValue;
          }

          await client.query(
            `INSERT INTO kv_store (key, value, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET
               value = EXCLUDED.value,
               updated_at = NOW()`,
            [key, JSON.stringify(normalizeMetaData(updated))]
          );
          await client.query('COMMIT');
          return updated;
        } catch (txErr) {
          await client.query('ROLLBACK').catch(() => {});
          if (attempt < MAX_RETRIES - 1) {
            console.warn(`[Server] Meta update conflict, retry ${attempt + 1}/${MAX_RETRIES}`);
            continue;
          }
          throw txErr;
        } finally {
          client.release();
        }
      } else {
        try {
          const result = sqliteDb.transaction(() => {
            const row = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get(key);
            const currentValue = row?.value
              ? normalizeMetaData(JSON.parse(row.value))
              : normalizeMetaData({});

            const updated = updater(currentValue);
            if (!updated) return currentValue;

            sqliteDb.prepare(
              `INSERT INTO kv_store (key, value, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET
                 value = excluded.value,
                 updated_at = CURRENT_TIMESTAMP`
            ).run(key, JSON.stringify(normalizeMetaData(updated)));
            return updated;
          })();
          return result;
        } catch (err) {
          if (attempt < MAX_RETRIES - 1) {
            console.warn(`[Server] Meta update conflict, retry ${attempt + 1}/${MAX_RETRIES}`);
            continue;
          }
          throw err;
        }
      }
    }
    throw new Error('Failed to update meta after max retries');
  };

  // ---------------------------------------------------------------------------
  // Team CRUD helpers
  // ---------------------------------------------------------------------------

  const loadTeam = async (teamId) => {
    const data = await kvGet(`team:${teamId}`);
    if (!data) return null;
    const { _rev, _updatedAt, ...team } = data;
    return team;
  };

  const loadTeamRaw = async (teamId) => {
    return await kvGet(`team:${teamId}`);
  };

  const saveTeam = async (teamId, teamData) => {
    const rev = Number(teamData._rev ?? 0);
    const data = { ...teamData, _rev: rev + 1, _updatedAt: new Date().toISOString() };
    await kvSet(`team:${teamId}`, data);
    return data;
  };

  const deleteTeamRecord = async (teamId) => {
    await kvDelete(`team:${teamId}`);
  };

  const loadAllTeams = async () => {
    const rows = await kvGetMultipleByPrefix('team:');
    return rows
      .filter((r) => r.key.startsWith('team:') && !r.key.startsWith('team-'))
      .map((r) => {
        const { _rev, _updatedAt, ...team } = r.value;
        return team;
      });
  };

  // ---------------------------------------------------------------------------
  // Session state (unchanged from before)
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Global settings (unchanged)
  // ---------------------------------------------------------------------------

  const loadGlobalSettings = async () => {
    try {
      const data = await kvGet('global-settings');
      return data || {};
    } catch (err) {
      console.warn('[Server] Failed to load global settings', err);
      return {};
    }
  };

  const saveGlobalSettings = async (settings) => {
    try {
      await kvSet('global-settings', settings ?? {});
    } catch (err) {
      console.error('[Server] Failed to write global settings', err);
      throw err;
    }
  };

  // ---------------------------------------------------------------------------
  // Legacy compat: loadPersistedData / savePersistedData
  // These reconstruct the old monolithic format from per-team records.
  // Used by backup/restore and any remaining callers.
  // ---------------------------------------------------------------------------

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

  const loadPersistedData = async () => {
    try {
      const teams = await loadAllTeams();
      const meta = await loadMetaData();
      return normalizePersistedData({
        teams,
        meta: { revision: 0, updatedAt: new Date().toISOString() },
        resetTokens: meta.resetTokens,
        orphanedFeedbacks: meta.orphanedFeedbacks
      });
    } catch (err) {
      console.warn('[Server] Failed to load persisted data', err);
      return normalizePersistedData({ teams: [] });
    }
  };

  const savePersistedData = async (data) => {
    const normalized = normalizePersistedData(data);

    const indexMap = new Map();
    for (const team of normalized.teams) {
      await saveTeam(team.id, team);
      indexMap.set(team.name.toLowerCase(), team.id);
    }
    await saveTeamIndex(indexMap);

    await saveMetaData({
      resetTokens: normalized.resetTokens,
      orphanedFeedbacks: normalized.orphanedFeedbacks
    });

    return normalized;
  };

  const refreshPersistedData = async () => {
    return await loadPersistedData();
  };

  // ---------------------------------------------------------------------------
  // Migration from old single-blob format to per-team format
  // ---------------------------------------------------------------------------

  const migrateFromLegacyFormat = async () => {
    let legacyData = null;

    try {
      if (usePostgres) {
        const result = await pgPool.query('SELECT value FROM kv_store WHERE key = $1', ['retro-data']);
        if (result.rows.length > 0 && result.rows[0].value) {
          legacyData = JSON.parse(result.rows[0].value);
        }
      } else {
        const row = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get('retro-data');
        if (row?.value) {
          legacyData = JSON.parse(row.value);
        }
      }
    } catch (err) {
      console.warn('[Server] Failed to read legacy data during migration check', err);
    }

    if (!legacyData) return false;

    const existingIndex = await kvGet('team-index');
    if (existingIndex) {
      console.info('[Server] Per-team migration already done, cleaning up legacy key');
      await kvDelete('retro-data');
      return false;
    }

    const normalized = normalizePersistedData(legacyData);

    if (normalized.teams.length === 0 && normalized.resetTokens.length === 0 && normalized.orphanedFeedbacks.length === 0) {
      await kvDelete('retro-data');
      return false;
    }

    console.info(`[Server] Migrating ${normalized.teams.length} team(s) from single-blob to per-team storage...`);

    const indexMap = new Map();

    for (const team of normalized.teams) {
      const teamData = { ...team, _rev: 1, _updatedAt: new Date().toISOString() };
      await kvSet(`team:${team.id}`, teamData);
      indexMap.set(team.name.toLowerCase(), team.id);
    }

    await kvSet('team-index', mapToIndex(indexMap));

    await kvSet('retro-meta', normalizeMetaData({
      resetTokens: normalized.resetTokens,
      orphanedFeedbacks: normalized.orphanedFeedbacks
    }));

    await kvDelete('retro-data');

    console.info(`[Server] Migration complete: ${normalized.teams.length} team(s) migrated to per-team storage`);
    return true;
  };

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  const initDatabase = async () => {
    if (usePostgres) {
      pgPool = await initPostgres();
    } else {
      sqliteDb = initSqlite();
    }
  };

  const getPgPool = () => pgPool;
  const getSqliteDb = () => sqliteDb;

  return {
    initDatabase,

    // Per-team operations (new, contention-free)
    loadTeam,
    loadTeamRaw,
    saveTeam,
    deleteTeamRecord,
    loadAllTeams,
    atomicTeamSave,
    atomicTeamUpdate,

    // Team index
    loadTeamIndex,
    saveTeamIndex,
    atomicTeamIndexUpdate,

    // Metadata (resetTokens, orphanedFeedbacks)
    loadMetaData,
    saveMetaData,
    atomicMetaUpdate,

    // Legacy compat (backup/restore, aggregated reads)
    loadPersistedData,
    savePersistedData,
    refreshPersistedData,

    // Session state
    loadSessionState,
    saveSessionState,

    // Global settings
    loadGlobalSettings,
    saveGlobalSettings,

    // Migration
    migrateFromLegacyFormat,

    // Infra
    getPgPool,
    getSqliteDb,
    usePostgres
  };
};

export { createDataStore };
