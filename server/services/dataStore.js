import fs from 'fs';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';
import pg from 'pg';
import { createKeyedQueue } from './keyedQueue.js';
import { isJsonbRefusal, readRowsOneByOne } from './jsonbRefusal.js';
import { carryJiraLinks, carryJiraParents } from '../../utils/actionImpact.js';
import { DEFAULT_SESSION_EPOCH, newSessionEpoch, parseTeamAuthRow } from './sessionEpoch.js';

const TEAM_PREFIX = 'team:';
const SESSION_PREFIX = 'session:';
// A team's sealed Jira token, kept off the team record (see loadTeamSecret).
// Its fifth character is `-`, so no `LIKE 'team:%'` scan ever reads it as a
// team — which is what keeps it out of summaries, the console and backups.
const TEAM_SECRET_PREFIX = 'team-secret:';
// A team's session epoch (decision D3b, see loadTeamAuthState). The same
// fifth-character `-` as `team-secret:`, for the same reason: no `team:%`
// scan — summaries, the console, `loadAllTeams`, archives, an older pod's
// restore — ever reads it as a team, so no archive carries it and no restore
// rolls it back.
const TEAM_AUTH_PREFIX = 'team-auth:';
// The boot sweep never removes an epoch row younger than this, so it cannot
// take away an epoch a restore on another pod has just written (see
// sweepOrphanedTeamAuthRows). A number written into the SQL, never input.
const TEAM_AUTH_ORPHAN_MIN_AGE_MINUTES = 10;
const JIRA_SETTINGS_KEY = 'jira-settings';
const GLOBAL_SETTINGS_KEY = 'global-settings';

// What JSON.parse makes of an object, and nothing else: no array, no Map, no
// class instance — each of which would serialize as something other than the
// settings it seems to hold.
const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

// What one pod keeps of every team's feedbacks (loadAllTeamFeedbacks), in
// characters of their JSON text: images ride inline as data: URIs, and a pod
// has a 384 Mi memory limit. A team that does not fit is read from the
// database on every request instead. Overridable for tests only.
const TEAM_FEEDBACK_CACHE_MAX_CHARS = 16 * 1024 * 1024;

// Freezes plain objects and arrays, all the way down: what JSON.parse built.
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const createDataStore = ({ rootDir, teamFeedbackCacheMaxChars = TEAM_FEEDBACK_CACHE_MAX_CHARS }) => {
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
    const poolMax = (() => {
      const parsed = Number(process.env.PG_POOL_MAX);
      return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10;
    })();

    const pool = new pg.Pool({
      ...pgConfig,
      max: poolMax,
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
      await client.query(`
        CREATE TABLE IF NOT EXISTS backups (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          type TEXT NOT NULL,
          label TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          size_bytes INTEGER NOT NULL,
          team_count INTEGER NOT NULL DEFAULT 0,
          protected BOOLEAN NOT NULL DEFAULT FALSE,
          data BYTEA NOT NULL
        )
      `);
      // Audit H45 — the durable trace of privileged actions. Beside `backups`
      // rather than in `kv_store`, because the KV records are rewritten
      // wholesale by a restore and an audit trail a restore can erase is not
      // one. Append-only as far as the application is concerned: there is no
      // UPDATE and no DELETE against this table anywhere in the codebase.
      await client.query(`
        CREATE TABLE IF NOT EXISTS security_events (
          id BIGSERIAL PRIMARY KEY,
          created_at TEXT NOT NULL,
          action TEXT NOT NULL,
          actor TEXT NOT NULL,
          outcome TEXT NOT NULL,
          target TEXT,
          source_ip TEXT,
          correlation_id TEXT,
          detail TEXT
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
    db.prepare(
      `CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        type TEXT NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        size_bytes INTEGER NOT NULL,
        team_count INTEGER NOT NULL DEFAULT 0,
        protected INTEGER NOT NULL DEFAULT 0,
        data BLOB NOT NULL
      )`
    ).run();
    // Audit H45 — see the PostgreSQL statement above for why this table exists
    // and why it sits beside `backups`. The two are kept adjacent in this file
    // on purpose: a column added to one and not the other is a divergence a
    // SQLite-only test run cannot catch.
    db.prepare(
      `CREATE TABLE IF NOT EXISTS security_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        outcome TEXT NOT NULL,
        target TEXT,
        source_ip TEXT,
        correlation_id TEXT,
        detail TEXT
      )`
    ).run();
    return db;
  };

  // ---------------------------------------------------------------------------
  // Low-level KV helpers
  // ---------------------------------------------------------------------------

  // The two per-pod projection caches of the team rows. Every write of a
  // `team:` record below forgets its entry in both once the write is done
  // (`forgetTeamProjections`); a write that bypassed these helpers could not be
  // forgotten, which is why every `team:` writer goes through them.
  // key -> { stamp, size, summary }: the team summaries (loadTeamSummaries).
  const teamSummaryCache = new Map();
  // key -> { stamp, size, chars, row }: each team's id, name and frozen
  // feedbacks (loadAllTeamFeedbacks), within teamFeedbackCacheMaxChars.
  const teamFeedbackCache = new Map();

  const forgetTeamProjections = (key) => {
    if (typeof key === 'string' && key.startsWith(TEAM_PREFIX)) {
      teamSummaryCache.delete(key);
      teamFeedbackCache.delete(key);
    }
  };

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
    forgetTeamProjections(key);
  };

  const kvDelete = async (key) => {
    if (usePostgres) {
      await pgPool.query('DELETE FROM kv_store WHERE key = $1', [key]);
    } else {
      sqliteDb.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
    }
    forgetTeamProjections(key);
  };

  // Prefix scans use `LIKE 'prefix%'` rather than a `key >= lower AND key <
  // upper` range: range comparison depends on the column collation, and under a
  // locale collation (typical on PostgreSQL) punctuation such as ':' is ignored
  // at the primary level, so `'team:<id>'` sorts after `'team;'` and the range
  // silently matches nothing. LIKE prefix matching is collation-independent and
  // correct on both engines.
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

  // Keys-only prefix scan (no value deserialization). Used by faithful restore
  // to enumerate existing team records without parsing each team's full blob.
  const kvKeysByPrefix = async (prefix) => {
    if (usePostgres) {
      const result = await pgPool.query('SELECT key FROM kv_store WHERE key LIKE $1', [prefix + '%']);
      return result.rows.map((row) => row.key);
    }
    const rows = sqliteDb.prepare('SELECT key FROM kv_store WHERE key LIKE ?').all(prefix + '%');
    return rows.map((row) => row.key);
  };

  // Bulk delete every row whose key starts with `prefix`. Returns the number of
  // rows removed. Used by faithful restore to drop all live session:* state.
  const kvDeleteByPrefix = async (prefix) => {
    if (usePostgres) {
      const result = await pgPool.query('DELETE FROM kv_store WHERE key LIKE $1', [prefix + '%']);
      return result.rowCount ?? 0;
    }
    const info = sqliteDb.prepare('DELETE FROM kv_store WHERE key LIKE ?').run(prefix + '%');
    return info.changes ?? 0;
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
          forgetTeamProjections(key);
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
        if (result.success) forgetTeamProjections(key);
        return result;
      }
    } catch (err) {
      console.error(`[Server] Failed atomic team save for ${teamId}`, err);
      throw err;
    }
  };

  // ---------------------------------------------------------------------------
  // Per-team read-modify-write
  // ---------------------------------------------------------------------------

  // A team's updates run one at a time on this pod (keyedQueue.js), and each
  // one reads, updates and writes the record in one transaction holding the
  // row. They used to race through a compare-and-swap retried five times: with
  // a whole retro writing at once, one writer won each round, and on PostgreSQL
  // 9 to 10 of 16 simultaneous writers on a 1 MB team ended in
  // `max_retries_exceeded`, a 500 the client only logs. Now a writer waits: in
  // the queue behind this pod's writers, on the row lock behind another pod's.
  // A pod from an older release still compare-and-swaps through
  // atomicTeamSave, which takes the same lock and reads the revision written
  // here. The record is parsed once per update, and the updater runs once.
  //
  // The updater must be synchronous, since it runs inside the transaction
  // (every one in the codebase is). One that throws rolls its own update back
  // and rejects its own call; the updates queued behind it still run.
  const teamWriteQueue = createKeyedQueue();

  // The record to write for one update, or no payload when the updater
  // declined. The updater never sees the revision stamp.
  const applyTeamUpdater = (stored, updater) => {
    const { _rev, _updatedAt, ...cleanTeam } = stored;
    const updatedTeam = updater(cleanTeam);
    if (!updatedTeam) return { team: cleanTeam, payload: null };
    // A promise serializes as `{}`: written, it would replace the whole team.
    if (typeof updatedTeam.then === 'function') {
      Promise.resolve(updatedTeam).catch(() => {});
      throw new TypeError('atomicTeamUpdate: the updater must be synchronous');
    }
    const nextRev = Number(_rev ?? 0) + 1;
    const payload = JSON.stringify({ ...updatedTeam, _rev: nextRev, _updatedAt: new Date().toISOString() });
    return { team: updatedTeam, payload };
  };

  // The value a rotation writes into `team-auth:{teamId}`: blind, so it never
  // depends on the row it replaces (and a corrupt row is simply repaired).
  const nextTeamAuthRow = () => ({ v: 1, sessionEpoch: newSessionEpoch(), revokedAt: Date.now() });

  const upsertTeamAuthOnPostgres = (client, teamId, row) => client.query(
    `INSERT INTO kv_store (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = NOW()`,
    [teamAuthKey(teamId), JSON.stringify(row)]
  );

  const upsertTeamAuthOnSqlite = (teamId, row) => sqliteDb.prepare(
    `INSERT INTO kv_store (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = CURRENT_TIMESTAMP`
  ).run(teamAuthKey(teamId), JSON.stringify(row));

  const updateTeamOnPostgres = async (key, updater, teamId, { rotateSessionEpoch = false } = {}) => {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT value FROM kv_store WHERE key = $1 FOR UPDATE', [key]);
      const stored = locked.rows[0]?.value ? JSON.parse(locked.rows[0].value) : null;
      if (!stored) {
        await client.query('ROLLBACK');
        return { success: false, error: 'team_not_found' };
      }
      const { team, payload } = applyTeamUpdater(stored, updater);
      if (!payload) {
        await client.query('ROLLBACK');
        return { success: true, team };
      }
      await client.query('UPDATE kv_store SET value = $2, updated_at = NOW() WHERE key = $1', [key, payload]);
      // Decision D3b: the new session epoch commits with the password it
      // belongs to, under the team row's lock (see atomicTeamUpdate).
      const authRow = rotateSessionEpoch ? nextTeamAuthRow() : null;
      if (authRow) await upsertTeamAuthOnPostgres(client, teamId, authRow);
      await client.query('COMMIT');
      forgetTeamProjections(key);
      return authRow
        ? { success: true, team, sessionEpoch: authRow.sessionEpoch, revokedAt: authRow.revokedAt }
        : { success: true, team };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };

  const updateTeamOnSqlite = (key, updater, teamId, { rotateSessionEpoch = false } = {}) => {
    let wrote = false;
    const result = sqliteDb.transaction(() => {
      const row = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get(key);
      const stored = row?.value ? JSON.parse(row.value) : null;
      if (!stored) return { success: false, error: 'team_not_found' };
      const { team, payload } = applyTeamUpdater(stored, updater);
      if (!payload) return { success: true, team };
      sqliteDb.prepare('UPDATE kv_store SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?').run(payload, key);
      wrote = true;
      if (!rotateSessionEpoch) return { success: true, team };
      const authRow = nextTeamAuthRow();
      upsertTeamAuthOnSqlite(teamId, authRow);
      return { success: true, team, sessionEpoch: authRow.sessionEpoch, revokedAt: authRow.revokedAt };
    })();
    if (wrote) forgetTeamProjections(key);
    return result;
  };

  // `rotateSessionEpoch` (decision D3b): when the updater wrote the team, the
  // same transaction gives the team a new session epoch, and the result
  // carries it (`sessionEpoch`, `revokedAt`) — every session token minted
  // before stops validating. It is the password rotations' option. It must be
  // the same transaction: two rotations A and B serialize on the team row
  // lock, and an epoch written after the commit could interleave as "hash A,
  // hash B, epoch B, epoch A", leaving B's password with A's epoch — and A,
  // who does not know B's password, with a valid token. Inside the lock the
  // last rotation wins both fields. Lock order is the team row, then the auth
  // row, on every path that takes both; `rotateTeamSessionEpoch` takes the
  // auth row alone, so no two paths can deadlock.
  const atomicTeamUpdate = (teamId, updater, options = {}) => {
    const key = `team:${teamId}`;
    return teamWriteQueue.run(key, () => (
      usePostgres ? updateTeamOnPostgres(key, updater, teamId, options) : updateTeamOnSqlite(key, updater, teamId, options)
    ));
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
          // Retried silently; only exhaustion (below) is logged.
          if (attempt < MAX_RETRIES - 1) {
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
            continue;
          }
          throw err;
        }
      }
    }
    console.warn(`[Server] Team index update failed after ${MAX_RETRIES} retries`);
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
          // Retried silently; only exhaustion (below) is logged.
          if (attempt < MAX_RETRIES - 1) {
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
            continue;
          }
          throw err;
        }
      }
    }
    console.warn(`[Server] Meta update failed after ${MAX_RETRIES} retries`);
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

  // Whether a team record exists, without reading it: checking a session token
  // needs nothing more, and loading the record parses the team's whole history.
  // `octet_length` reads the stored length, not the value (see
  // loadTeamSummaries).
  const teamExists = async (teamId) => {
    const key = `team:${teamId}`;
    if (usePostgres) {
      const result = await pgPool.query('SELECT 1 FROM kv_store WHERE key = $1 AND octet_length(value) > 0', [key]);
      return result.rows.length > 0;
    }
    return !!sqliteDb.prepare('SELECT 1 FROM kv_store WHERE key = ? AND octet_length(value) > 0').get(key);
  };

  // ---------------------------------------------------------------------------
  // Team session epochs (`team-auth:{teamId}`, decision D3b)
  //
  // A team session token is valid only while the epoch it carries is the
  // team's current one, so every team route and every socket join reads this.
  // It is a row of its own rather than a field of the team record because the
  // hot path cannot afford the record: a token-authenticated persist must not
  // parse the team's history (38.1), and any projection of a field inside the
  // record's value casts the whole value on PostgreSQL. It is also out of
  // every archive, merge and `/update`, so nothing can carry it or roll it
  // back. A team with no row has never rotated: epoch '0', revoked never.
  // ---------------------------------------------------------------------------

  const teamAuthKey = (teamId) => {
    // `team-auth:undefined` would be one epoch shared by every caller bug.
    if (typeof teamId !== 'string' || teamId === '') {
      throw new TypeError('team auth: the team id must be a non-empty string');
    }
    return `${TEAM_AUTH_PREFIX}${teamId}`;
  };

  /**
   * Whether the team exists, and its session epoch, from one statement: both
   * values come from one snapshot, and the team record's value is never read
   * (`octet_length` reads the stored length, as `teamExists` does). Answers
   * `{ exists, sessionEpoch, revokedAt }` — `'0'` and `null` with no row. The
   * row is read strictly (`parseTeamAuthRow`): one that does not parse throws
   * `TeamAuthRowCorruptError`, and a query error throws as itself; a caller
   * never accepts a token on either.
   */
  const loadTeamAuthState = async (teamId) => {
    const teamKey = `team:${teamId}`;
    const authKey = teamAuthKey(teamId);
    let row;
    if (usePostgres) {
      const result = await pgPool.query(
        `SELECT EXISTS (SELECT 1 FROM kv_store WHERE key = $1 AND octet_length(value) > 0) AS team_exists,
                (SELECT value FROM kv_store WHERE key = $2) AS auth`,
        [teamKey, authKey]
      );
      row = result.rows[0];
    } else {
      row = sqliteDb.prepare(
        `SELECT EXISTS (SELECT 1 FROM kv_store WHERE key = ? AND octet_length(value) > 0) AS team_exists,
                (SELECT value FROM kv_store WHERE key = ?) AS auth`
      ).get(teamKey, authKey);
    }
    const exists = Boolean(row?.team_exists);
    if (typeof row?.auth !== 'string' || row.auth === '') {
      return { exists, sessionEpoch: DEFAULT_SESSION_EPOCH, revokedAt: null };
    }
    const { sessionEpoch, revokedAt } = parseTeamAuthRow(row.auth, teamId);
    return { exists, sessionEpoch, revokedAt };
  };

  /**
   * Gives the team a new session epoch outside any team write, and answers
   * `{ sessionEpoch, revokedAt }`. A blind upsert: the restores call it before
   * and after writing a team whose password they change, where the write is
   * not an `atomicTeamUpdate` that could carry the rotation.
   */
  const rotateTeamSessionEpoch = async (teamId) => {
    const row = nextTeamAuthRow();
    if (usePostgres) {
      await upsertTeamAuthOnPostgres(pgPool, teamId, row);
    } else {
      upsertTeamAuthOnSqlite(teamId, row);
    }
    return { sessionEpoch: row.sessionEpoch, revokedAt: row.revokedAt };
  };

  // Deleted *after* the team record, best-effort (see deleteTeamRecord): the
  // other order would reset a team that still exists to epoch '0' and revive
  // every token minted under '0' before its first rotation.
  const deleteTeamAuthRow = async (teamId) => {
    await kvDelete(teamAuthKey(teamId));
  };

  // Removes every auth row whose team record is gone, and answers how many: a
  // deletion whose last step failed, or a pod from before this release that
  // deleted a team without it. Run at startup, beside the secrets' sweep.
  //
  // One conditional statement per row, and never a row younger than
  // TEAM_AUTH_ORPHAN_MIN_AGE_MINUTES. The sweep runs while other pods serve,
  // and a restore that brings a deleted team back writes its epoch before and
  // after the record (rotateRecreatedTeamEpoch, savePersistedData). Checking
  // the record and then deleting, as two statements, let a restore land in
  // between: the sweep saw no record, the restore wrote the record and its new
  // epoch, and the delete took that epoch away — epoch '0' for a team that
  // exists, and every token from before its deletion current again. The age is
  // what closes it on PostgreSQL too: a delete whose snapshot predates the
  // record's commit keeps its NOT EXISTS answer when it re-checks a row the
  // rotation rewrote, but that row's `updated_at` is now. An orphan younger
  // than that waits for the next start, which costs nothing: no team holds it.
  const sweepOrphanedTeamAuthRows = async () => {
    let removed = 0;
    for (const key of await kvKeysByPrefix(TEAM_AUTH_PREFIX)) {
      const teamKey = `team:${key.slice(TEAM_AUTH_PREFIX.length)}`;
      if (usePostgres) {
        const result = await pgPool.query(
          `DELETE FROM kv_store
            WHERE key = $1
              AND updated_at < NOW() - INTERVAL '${TEAM_AUTH_ORPHAN_MIN_AGE_MINUTES} minutes'
              AND NOT EXISTS (SELECT 1 FROM kv_store team WHERE team.key = $2 AND octet_length(team.value) > 0)`,
          [key, teamKey]
        );
        removed += result.rowCount ?? 0;
      } else {
        const result = sqliteDb.prepare(
          `DELETE FROM kv_store
            WHERE key = ?
              AND datetime(updated_at) < datetime('now', '-${TEAM_AUTH_ORPHAN_MIN_AGE_MINUTES} minutes')
              AND NOT EXISTS (SELECT 1 FROM kv_store team WHERE team.key = ? AND octet_length(team.value) > 0)`
        ).run(key, teamKey);
        removed += result.changes;
      }
    }
    return removed;
  };

  const saveTeam = async (teamId, teamData) => {
    const rev = Number(teamData._rev ?? 0);
    const data = { ...teamData, _rev: rev + 1, _updatedAt: new Date().toISOString() };
    await kvSet(`team:${teamId}`, data);
    return data;
  };

  // ---------------------------------------------------------------------------
  // Team secrets (`team-secret:{teamId}`): each team's sealed Jira token
  //
  // Never on the team record. The record is sent to every member's browser,
  // written whole by several routes, copied by merges and restores, and
  // included in every backup a super admin can download; a row of its own is
  // none of those, so the token cannot leak through them, a restore never rolls
  // it back and a merge never copies it. What the row holds is sealed by
  // `secretBox.js`; this layer only stores it.
  // ---------------------------------------------------------------------------

  const teamSecretKey = (teamId) => {
    // `team-secret:undefined` would be one row shared by every caller bug.
    if (typeof teamId !== 'string' || teamId === '') {
      throw new TypeError('team secret: the team id must be a non-empty string');
    }
    return `${TEAM_SECRET_PREFIX}${teamId}`;
  };

  const loadTeamSecret = async (teamId) => kvGet(teamSecretKey(teamId));

  const saveTeamSecret = async (teamId, secret) => {
    await kvSet(teamSecretKey(teamId), secret);
  };

  const deleteTeamSecret = async (teamId) => {
    await kvDelete(teamSecretKey(teamId));
  };

  // Rewrites a team's secret row only while it still holds what `updater` was
  // shown, and answers whether it wrote. `updater(current)` is synchronous and
  // returns the new row, or null to leave it. The write is conditional on the
  // stored text, so a token saved between the read and the write — on this pod
  // or another — is never overwritten with the envelope it replaced; the
  // caller's change is simply dropped (marking a token refused by Jira is the
  // use: a newer token was not refused). A missing row is never created.
  const updateTeamSecret = async (teamId, updater) => {
    const key = teamSecretKey(teamId);
    if (usePostgres) {
      const read = await pgPool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
      const text = read.rows[0]?.value;
      if (!text) return false;
      const next = updater(JSON.parse(text));
      if (!next) return false;
      const written = await pgPool.query(
        'UPDATE kv_store SET value = $2, updated_at = NOW() WHERE key = $1 AND value = $3',
        [key, JSON.stringify(next), text]
      );
      return written.rowCount === 1;
    }
    return sqliteDb.transaction(() => {
      const row = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get(key);
      if (!row?.value) return false;
      const next = updater(JSON.parse(row.value));
      if (!next) return false;
      const written = sqliteDb.prepare(
        'UPDATE kv_store SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ? AND value = ?'
      ).run(JSON.stringify(next), key, row.value);
      return written.changes === 1;
    })();
  };

  // Removes every secret whose team record is gone and answers how many. A
  // pod from before secrets existed deletes a team without its secret during a
  // rolling update, and a token saved while its team was being deleted can land
  // after the record went; run at startup, this leaves neither behind.
  const sweepOrphanedTeamSecrets = async () => {
    let removed = 0;
    for (const key of await kvKeysByPrefix(TEAM_SECRET_PREFIX)) {
      if (await teamExists(key.slice(TEAM_SECRET_PREFIX.length))) continue;
      await kvDelete(key);
      removed += 1;
    }
    return removed;
  };

  // The secret goes first. The other order would leave, on a failure, a secret
  // nobody can reach or remove: the record is gone, and with it every way to
  // authenticate a retry. This way a failure throws with the team intact.
  //
  // The session epoch goes last, and its failure does not fail the deletion:
  // deleting it while the record still exists would reset a live team to epoch
  // '0' and revive every token minted under '0'. Left behind, it is an orphan
  // nobody can reach, removed by the boot sweep (sweepOrphanedTeamAuthRows).
  const deleteTeamRecord = async (teamId) => {
    await deleteTeamSecret(teamId);
    await kvDelete(`team:${teamId}`);
    try {
      await deleteTeamAuthRow(teamId);
    } catch (err) {
      console.warn(`[Server] The session epoch of deleted team ${JSON.stringify(String(teamId))} could not be removed; the boot sweep removes it`, err);
    }
  };

  const loadAllTeams = async () => {
    // `kvGetMultipleByPrefix('team:')` already restricts the scan to the
    // `team:` key space via `LIKE 'team:%'`, which never matches the
    // `team-index` record (its fifth character is `-`, not `:`), so no
    // post-scan key filter is needed here.
    const rows = await kvGetMultipleByPrefix('team:');
    return rows.map((r) => {
      const { _rev, _updatedAt, ...team } = r.value;
      return team;
    });
  };

  // Normalizes a JSON-array column extracted in SQL. PostgreSQL's json driver
  // returns an already-parsed array, SQLite's json_extract returns the array as
  // a JSON string, and an absent key yields null/undefined — all coerced here to
  // a plain array. Shared by every projection that pulls an array sub-field.
  const normalizeJsonArray = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value) {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  // The object counterpart of normalizeJsonArray: PostgreSQL's json driver
  // returns the parsed object, SQLite's json_extract its JSON text, and an
  // absent key null. Anything that is not one plain object reads as null.
  const normalizeJsonObject = (value) => {
    let parsed = value;
    if (typeof value === 'string' && value) {
      try {
        parsed = JSON.parse(value);
      } catch {
        return null;
      }
    }
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  };

  // Team summaries: the few fields the login picker (`/api/team/list`), the
  // console and the boot passes read for every team — id, name, recovery
  // address, last connection, the rosters and the merge provenance. They live
  // inside each team's record, next to its whole history, so even a projection
  // in SQL has the database read and parse every record in full — and
  // PostgreSQL did it once per projected column, because each `(value::jsonb)`
  // is its own cast: the login screen took 1.7 s for 40 teams holding 25 MB of
  // retrospectives, and grew with every retro run.
  //
  // So each pod keeps the projection of every team, keyed by a fingerprint
  // that costs no parse, and projects only the rows whose fingerprint moved —
  // parsing each once — and forgets the rows that are gone. The fingerprint is
  // the row's byte length (both engines read it from the row header) and its
  // version: `xmin` on PostgreSQL, which changes with every row version
  // whoever writes it (a pod from an older release included) and owes nothing
  // to a clock; `updated_at` on SQLite, read only when another connection has
  // committed (see readTeamSummaryRowsSqlite). This pod's own writes drop their
  // entry at once (`forgetTeamProjections`). Residual, accepted: on SQLite, a
  // second process writing a team twice in one second at the same length stays
  // invisible until that team's next write — SQLite deployments run one
  // process. The cache itself is declared with the KV helpers, which forget an
  // entry on every team write.
  const projectSummaryRow = (row) => ({
    stamp: String(row.stamp),
    size: Number(row.size),
    summary: {
      id: row.id,
      name: row.name,
      facilitatorEmail: row.facilitator_email || undefined,
      lastConnectionDate: row.last_connection_date || undefined,
      members: normalizeJsonArray(row.members),
      // Provenance of a team built by the super-admin merge
      // (`server/services/teamMerge.js`); empty for every other team. Read here
      // so finding a source's merged team never loads full records.
      mergedFrom: normalizeJsonArray(row.merged_from),
      // What the email heal pass reads at every boot, so it never loads full
      // records just to find the few that need a write.
      archivedMembers: normalizeJsonArray(row.archived_members),
      // The team's Jira target (`/jira/status`, read by every participant's
      // screen on Review entry and on every reconnect): a few bytes beside a
      // history that can weigh megabytes.
      jiraTarget: normalizeJsonObject(row.jira_target)
    }
  });

  // A row read without its version (SQLite, when no other connection wrote)
  // is judged on its length alone: every change this process made since has
  // already forgotten its entry.
  const isFresh = (entry, row) =>
    !!entry && entry.size === Number(row.size) && (row.stamp == null || entry.stamp === String(row.stamp));

  // Splits the fingerprint rows into the entries the cache already holds and
  // the keys to project. It runs synchronously right after the fingerprint
  // read, so a write of this pod that forgets an entry while the projection is
  // awaited cannot make a team vanish from this answer: the entry taken here
  // is the state the fingerprint read saw.
  const partitionByFreshness = (rows, cache) => {
    const known = new Map();
    const stale = [];
    for (const row of rows) {
      const cached = cache.get(row.key);
      if (isFresh(cached, row)) known.set(row.key, cached);
      else stale.push(row.key);
    }
    return { known, stale };
  };

  // The one projection of a team summary, for the rows `where` selects: the
  // whole list's stale rows and the single-row read share it, so the column
  // list cannot drift between them. On PostgreSQL every column comes from one
  // cast per row: `OFFSET 0` keeps the planner from folding the subquery into
  // the outer select, which would turn the single cast back into one per
  // column. The stamp and size are those of the row version projected, never
  // of an earlier fingerprint read.
  const summaryProjectionSql = (where) => (usePostgres
    ? `SELECT key, row_version::text AS stamp, octet_length(value) AS size,
              j->>'id' AS id,
              j->>'name' AS name,
              j->>'facilitatorEmail' AS facilitator_email,
              j->>'lastConnectionDate' AS last_connection_date,
              j->'members' AS members,
              j->'mergedFrom' AS merged_from,
              j->'archivedMembers' AS archived_members,
              j->'jiraTarget' AS jira_target
       FROM (SELECT key, xmin AS row_version, value, value::jsonb AS j
             FROM kv_store WHERE ${where} OFFSET 0) AS team_rows`
    : `SELECT key, updated_at AS stamp, octet_length(value) AS size,
              json_extract(value, '$.id') AS id,
              json_extract(value, '$.name') AS name,
              json_extract(value, '$.facilitatorEmail') AS facilitator_email,
              json_extract(value, '$.lastConnectionDate') AS last_connection_date,
              json_extract(value, '$.members') AS members,
              json_extract(value, '$.mergedFrom') AS merged_from,
              json_extract(value, '$.archivedMembers') AS archived_members,
              json_extract(value, '$.jiraTarget') AS jira_target
       FROM kv_store WHERE ${where}`);

  // LIKE (not a collation-sensitive range) for the same reason as
  // kvGetMultipleByPrefix above. `octet_length` reads the TOAST header, never
  // the value.
  const readTeamSummaryRowsPostgres = async () => {
    const stamps = await pgPool.query(
      `SELECT key, xmin::text AS stamp, octet_length(value) AS size
       FROM kv_store WHERE key LIKE $1`,
      [TEAM_PREFIX + '%']
    );
    const { known, stale } = partitionByFreshness(stamps.rows, teamSummaryCache);
    let projected = [];
    if (stale.length > 0) {
      const result = await pgPool.query(summaryProjectionSql('key = ANY($1)'), [stale]);
      projected = result.rows;
    }
    return { keys: stamps.rows.map((row) => row.key), known, projected };
  };

  // `updated_at` is stored after `value`, so reading it walks every record's
  // overflow pages: the whole store, on every read (6 ms at 25 MB, and
  // growing). `PRAGMA data_version` moves only when ANOTHER connection
  // commits, and this process's own writes already forget their entries, so
  // while it has not moved the row header's length is the whole fingerprint.
  // Synchronous from the fingerprint read to the cache update, so no write of
  // this process can land in between.
  let sqliteDataVersionSeen = null;
  const readTeamSummaryRowsSqlite = () => {
    const dataVersion = sqliteDb.pragma('data_version', { simple: true });
    const otherConnectionWrote = dataVersion !== sqliteDataVersionSeen;
    const stamps = sqliteDb.prepare(
      `SELECT key, ${otherConnectionWrote ? 'updated_at' : 'NULL'} AS stamp, octet_length(value) AS size
       FROM kv_store WHERE key LIKE ?`
    ).all(TEAM_PREFIX + '%');
    sqliteDataVersionSeen = dataVersion;
    const { known, stale } = partitionByFreshness(stamps, teamSummaryCache);
    const projected = stale.length === 0 ? [] : sqliteDb.prepare(
      summaryProjectionSql('key IN (SELECT value FROM json_each(?))')
    ).all(JSON.stringify(stale));
    return { keys: stamps.map((row) => row.key), known, projected };
  };

  // Brings this pod's summary cache up to date with the store, and answers
  // every team's key in storage order with the entry it projects to.
  const refreshTeamSummaries = async () => {
    const { keys, known, projected } = usePostgres
      ? await readTeamSummaryRowsPostgres()
      : readTeamSummaryRowsSqlite();

    const entries = new Map(known);
    for (const row of projected) {
      const entry = projectSummaryRow(row);
      entries.set(row.key, entry);
      teamSummaryCache.set(row.key, entry);
    }
    const present = new Set(keys);
    for (const key of teamSummaryCache.keys()) {
      if (!present.has(key)) teamSummaryCache.delete(key);
    }
    return { keys, entries };
  };

  // Roster rows are flat (`User`), so a copy per row is enough and costs a
  // tenth of a deep clone; the merge provenance and the Jira target are nested
  // and read by few callers.
  const copyRows = (rows) => rows.map((row) => (row && typeof row === 'object' ? { ...row } : row));
  const copySummary = (entry, { withMergeProvenance, withArchivedMembers, withJiraTarget }) => {
    const { mergedFrom, archivedMembers, jiraTarget, ...summary } = entry.summary;
    return {
      ...summary,
      members: copyRows(summary.members),
      ...(withMergeProvenance ? { mergedFrom: structuredClone(mergedFrom) } : {}),
      ...(withArchivedMembers ? { archivedMembers: copyRows(archivedMembers) } : {}),
      ...(withJiraTarget ? { jiraTarget: jiraTarget ? structuredClone(jiraTarget) : null } : {})
    };
  };

  // `withMergeProvenance` adds the super-admin merge's `mergedFrom` (the
  // console and the deletion step read it, the anonymous login picker never
  // does); `withArchivedMembers` adds the archived roster; `withJiraTarget` the
  // team's Jira target. Every summary is a copy: callers edit what they are
  // given, and must not edit the cache.
  const loadTeamSummaries = async ({ withMergeProvenance = false, withArchivedMembers = false, withJiraTarget = false } = {}) => {
    const { keys, entries } = await refreshTeamSummaries();
    const summaries = [];
    for (const key of keys) {
      // A row deleted between the two reads has no projection: it is gone.
      const entry = entries.get(key);
      if (!entry) continue;
      summaries.push(copySummary(entry, { withMergeProvenance, withArchivedMembers, withJiraTarget }));
    }
    return summaries;
  };

  // One team's summary, through the same cache and the same freshness rule as
  // the whole list, reading that one row only. A socket join resolves the
  // joiner's role from it, and `/jira/status` its target, so it runs on every
  // reconnect: reading every team's fingerprint there would re-project every
  // team written since the previous read, and during a live retrospective the
  // active teams' records change several times a second. A warm read parses
  // no record, whatever the team's history weighs, and a write by another pod
  // is seen (`xmin`, or `updated_at` once another connection committed).
  //
  // An empty value is "no team", as it is for kvGet and teamExists; casting it
  // would throw, and a join would then read the role as unknown.
  //
  // On PostgreSQL, readers of one team at one fingerprint share one
  // projection: a reconnect wave after a rolling update is one join per
  // participant, and each would otherwise run its own full cast of the same
  // record while holding one of the pod's pooled connections. A projection
  // issued after a fingerprint was read returns a row at least as new as it.
  const summaryProjections = new Map(); // `${key}\0${stamp}\0${size}` -> Promise<entry | null>
  const projectOneSummaryPostgres = (key, row) => {
    const fingerprint = `${key}\u0000${row.stamp}\u0000${row.size}`;
    const running = summaryProjections.get(fingerprint);
    if (running) return running;
    const started = (async () => {
      const result = await pgPool.query(summaryProjectionSql('key = $1'), [key]);
      const projected = result.rows[0];
      // Deleted between the two queries.
      if (!projected || !(Number(projected.size) > 0)) {
        forgetTeamProjections(key);
        return null;
      }
      const entry = projectSummaryRow(projected);
      teamSummaryCache.set(key, entry);
      return entry;
    })();
    summaryProjections.set(fingerprint, started);
    // Both handlers attached here, so a rejection reaches every caller
    // awaiting it and is never left unhandled.
    const forget = () => {
      if (summaryProjections.get(fingerprint) === started) summaryProjections.delete(fingerprint);
    };
    started.then(forget, forget);
    return started;
  };

  const readOneTeamSummaryPostgres = async (key) => {
    const result = await pgPool.query(
      'SELECT xmin::text AS stamp, octet_length(value) AS size FROM kv_store WHERE key = $1',
      [key]
    );
    const row = result.rows[0];
    if (!row || !(Number(row.size) > 0)) {
      forgetTeamProjections(key);
      return null;
    }
    const cached = teamSummaryCache.get(key);
    if (isFresh(cached, row)) return cached;
    return projectOneSummaryPostgres(key, row);
  };

  // Synchronous from the fingerprint to the cache update, like the list path.
  // It never moves `sqliteDataVersionSeen`: that marker says the WHOLE list
  // was re-stamped, and moving it here would make the next list read skip the
  // stamps of the other rows another connection rewrote at the same length.
  const readOneTeamSummarySqlite = (key) => {
    const dataVersion = sqliteDb.pragma('data_version', { simple: true });
    const otherConnectionWrote = dataVersion !== sqliteDataVersionSeen;
    const row = sqliteDb.prepare(
      `SELECT key, ${otherConnectionWrote ? 'updated_at' : 'NULL'} AS stamp, octet_length(value) AS size
       FROM kv_store WHERE key = ?`
    ).get(key);
    if (!row || !(Number(row.size) > 0)) {
      forgetTeamProjections(key);
      return null;
    }
    const cached = teamSummaryCache.get(key);
    if (isFresh(cached, row)) return cached;
    const projected = sqliteDb.prepare(summaryProjectionSql('key = ?')).get(key);
    if (!projected) {
      forgetTeamProjections(key);
      return null;
    }
    const entry = projectSummaryRow(projected);
    teamSummaryCache.set(key, entry);
    return entry;
  };

  const loadTeamSummary = async (teamId, { withMergeProvenance = false, withArchivedMembers = false, withJiraTarget = false } = {}) => {
    const key = `${TEAM_PREFIX}${teamId}`;
    const entry = usePostgres ? await readOneTeamSummaryPostgres(key) : readOneTeamSummarySqlite(key);
    return entry ? copySummary(entry, { withMergeProvenance, withArchivedMembers, withJiraTarget }) : null;
  };

  // Each team's id and stored password hash, nothing else: what the legacy
  // password pass (`passwordMigration.js`) reads at boot and after both
  // restore routes, which used to load and parse every full record in Node.
  // The database still parses each record (one cast per row on PostgreSQL);
  // Node parses none. A `passwordHash` that is not a string reads as null,
  // like a team with none. A row the database cannot parse makes the query
  // throw, which the pass reports as a failed scan.
  //
  // Deliberately NOT through the summary cache: the summaries feed the
  // anonymous login picker (`copySummary` spreads every field), and a hash
  // there would be one forgotten pick away from `/api/team/list`. Its only
  // caller is the password pass; no route may call it.
  //
  // On PostgreSQL one row whose text jsonb refuses but Node parses (a lone
  // surrogate escape, a `\u0000`: see jsonbRefusal.js) would fail the whole
  // statement, and with it the pass — after a restore of an archive from
  // before hashing, its teams would keep clear-text passwords no typed
  // password matches. So that one refusal falls back to reading the rows one
  // at a time in Node; a row Node cannot parse either still fails the read.
  const readPasswordHashRowsPostgres = async () => {
    try {
      return (await pgPool.query(
        `SELECT j->>'id' AS id,
                CASE WHEN jsonb_typeof(j->'passwordHash') = 'string' THEN j->>'passwordHash' END AS password_hash
         FROM (SELECT value::jsonb AS j FROM kv_store WHERE key LIKE $1 OFFSET 0) AS team_rows`,
        [TEAM_PREFIX + '%']
      )).rows;
    } catch (err) {
      if (!isJsonbRefusal(err)) throw err;
      console.warn(`[Server] A team record holds text PostgreSQL's jsonb refuses (${err.code}); reading the password hashes one team at a time`);
      return readRowsOneByOne({
        query: (sql, params) => pgPool.query(sql, params),
        prefix: TEAM_PREFIX,
        pick: (team) => ({
          id: team?.id,
          password_hash: typeof team?.passwordHash === 'string' ? team.passwordHash : null
        })
      });
    }
  };

  const loadTeamPasswordHashes = async () => {
    const rows = usePostgres
      ? await readPasswordHashRowsPostgres()
      : sqliteDb.prepare(
        `SELECT json_extract(value, '$.id') AS id,
                CASE WHEN json_type(value, '$.passwordHash') = 'text' THEN json_extract(value, '$.passwordHash') END AS password_hash
         FROM kv_store WHERE key LIKE ?`
      ).all(TEAM_PREFIX + '%');
    return rows.map((row) => ({
      // Text on PostgreSQL, whatever JSON type it was; the same on SQLite.
      id: row.id == null ? null : String(row.id),
      passwordHash: typeof row.password_hash === 'string' ? row.password_hash : null
    }));
  };

  // Feedback projection for the Feedback Hub (`/api/feedbacks/all`, on every
  // open and after every create, comment and delete) and the console's
  // feedback tab. It extracts only each team's id, name and teamFeedbacks in
  // SQL, so the heavy history never leaves the database (audit R10), and it is
  // cached per pod by the summaries' rule (see loadTeamSummaries): a
  // fingerprint that costs no parse, one cast per row whose fingerprint moved,
  // and this pod's own writes forgetting their entry. Uncached, it parsed every
  // team row on every call: 233 to 331 ms on PostgreSQL at 25 MB.
  //
  // Its own rules:
  // - **The SQLite marker of another connection's commit is its own.** Shared
  //   with the summaries, a summary read would mark the commit as seen, and the
  //   next feedback read would judge on length alone and miss a same-length
  //   foreign edit (a status `pending` -> `resolved` from another process).
  // - **The stamp and size of a projected entry come from the projection
  //   query's own row**, never from the fingerprint read: a write that lands in
  //   between is then re-projected on the next read.
  // - **The arrays are shared and frozen; callers build new objects, never edit
  //   them.** Both routes spread every feedback and sort a new outer array, and
  //   an edit throws (ES modules are strict) instead of corrupting the next
  //   answer.
  // - **A character budget bounds it, decided again at the end of every read**
  //   in storage order, so no admission state outlives a read: a team that does
  //   not fit is answered but not kept, and is projected again next time.
  // Orphaned feedbacks (`retro-meta`) are one row and are read by the routes.
  // Returns [{ id, name, teamFeedbacks }]; a team with no feedback key yields
  // an empty array.
  const projectFeedbackRow = (row) => {
    const text = typeof row.team_feedbacks === 'string' ? row.team_feedbacks : null;
    return {
      stamp: String(row.stamp),
      size: Number(row.size),
      chars: text ? text.length : 0,
      row: { id: row.id, name: row.name, teamFeedbacks: deepFreeze(normalizeJsonArray(text)) }
    };
  };

  const readTeamFeedbackRowsPostgres = async () => {
    const stamps = await pgPool.query(
      `SELECT key, xmin::text AS stamp, octet_length(value) AS size
       FROM kv_store WHERE key LIKE $1`,
      [TEAM_PREFIX + '%']
    );
    const { known, stale } = partitionByFreshness(stamps.rows, teamFeedbackCache);
    let projected = [];
    if (stale.length > 0) {
      // One cast per row, and `::text`, which we parse ourselves and whose
      // length is the budget's measure (see readTeamSummaryRowsPostgres for
      // `OFFSET 0`).
      const result = await pgPool.query(
        `SELECT key, row_version::text AS stamp, octet_length(value) AS size,
                j->>'id' AS id,
                j->>'name' AS name,
                (j->'teamFeedbacks')::text AS team_feedbacks
         FROM (SELECT key, xmin AS row_version, value, value::jsonb AS j
               FROM kv_store WHERE key = ANY($1) OFFSET 0) AS team_rows`,
        [stale]
      );
      projected = result.rows;
    }
    return { keys: stamps.rows.map((row) => row.key), known, projected };
  };

  // Synchronous from the fingerprint read to the cache update, like the
  // summaries: no write of this process can land in between.
  let sqliteFeedbackDataVersionSeen = null;
  const readTeamFeedbackRowsSqlite = () => {
    const dataVersion = sqliteDb.pragma('data_version', { simple: true });
    const otherConnectionWrote = dataVersion !== sqliteFeedbackDataVersionSeen;
    const stamps = sqliteDb.prepare(
      `SELECT key, ${otherConnectionWrote ? 'updated_at' : 'NULL'} AS stamp, octet_length(value) AS size
       FROM kv_store WHERE key LIKE ?`
    ).all(TEAM_PREFIX + '%');
    sqliteFeedbackDataVersionSeen = dataVersion;
    const { known, stale } = partitionByFreshness(stamps, teamFeedbackCache);
    const projected = stale.length === 0 ? [] : sqliteDb.prepare(
      `SELECT key, updated_at AS stamp, octet_length(value) AS size,
              json_extract(value, '$.id') AS id,
              json_extract(value, '$.name') AS name,
              json_extract(value, '$.teamFeedbacks') AS team_feedbacks
       FROM kv_store WHERE key IN (SELECT value FROM json_each(?))`
    ).all(JSON.stringify(stale));
    return { keys: stamps.map((row) => row.key), known, projected };
  };

  let warnedFeedbackBudget = false;
  const loadAllTeamFeedbacks = async () => {
    const { keys, known, projected } = usePostgres
      ? await readTeamFeedbackRowsPostgres()
      : readTeamFeedbackRowsSqlite();

    const entries = new Map(known);
    for (const row of projected) entries.set(row.key, projectFeedbackRow(row));

    // The cache is rebuilt from this read alone, so a team that is gone falls
    // out, and what is kept is decided again in storage order every time. A
    // known entry re-admitted here after a write of this pod forgot it during
    // the PostgreSQL await carries the old xmin, and is projected again next
    // time.
    teamFeedbackCache.clear();
    let kept = 0;
    const rows = [];
    for (const key of keys) {
      // A row deleted between the two reads has no projection: it is gone.
      const entry = entries.get(key);
      if (!entry) continue;
      if (kept + entry.chars <= teamFeedbackCacheMaxChars) {
        teamFeedbackCache.set(key, entry);
        kept += entry.chars;
      } else if (!warnedFeedbackBudget) {
        warnedFeedbackBudget = true;
        console.warn(`[Server] Feedback cache: team rows over its ${teamFeedbackCacheMaxChars}-character budget are read from the database on every request`);
      }
      rows.push({ ...entry.row });
    }
    return rows;
  };

  // ---------------------------------------------------------------------------
  // Session state (unchanged from before)
  // ---------------------------------------------------------------------------

  // The JSON text length of each session object this store parsed or wrote,
  // so the session cache (boundedCache.js) can size it without serializing it
  // again — a join is the reconnect-stampede path, and it already pays one
  // parse. Weak: an object nobody holds is forgotten with it. A copy
  // (`{ ...state }`) is not in it; the cache then measures that copy itself.
  const sessionTextLengths = new WeakMap();
  const noteSessionText = (state, text) => {
    if (state && typeof state === 'object') sessionTextLengths.set(state, text.length);
    return state;
  };
  const sessionTextLength = (state) => (state && typeof state === 'object' ? sessionTextLengths.get(state) : undefined);

  // `strict` makes a read failure throw instead of reading as "no session".
  // Every live caller wants the lenient answer — a socket join must not fail
  // because one read did — but the super-admin merge compares what it reads
  // with the team record, and there a failed read silently taken for "no
  // newer copy" would drop content from the merged team.
  const loadSessionState = async (sessionId, { strict = false } = {}) => {
    const key = `session:${sessionId}`;

    try {
      if (usePostgres) {
        const result = await pgPool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
        if (result.rows.length > 0 && result.rows[0].value) {
          return noteSessionText(JSON.parse(result.rows[0].value), result.rows[0].value);
        }
      } else {
        const row = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get(key);
        if (row?.value) {
          return noteSessionText(JSON.parse(row.value), row.value);
        }
      }
    } catch (err) {
      if (strict) throw err;
      console.warn('[Server] Failed to load session state', err);
    }

    return null;
  };

  // Compare-and-swap on the session `_rev`. `sessionData._rev` is the revision
  // the client built its change on (its last-seen authoritative rev). If that
  // base is older than what the server already has, the write is STALE: it was
  // computed from an out-of-date snapshot and would clobber newer state (this is
  // exactly how an idle participant's automatic roster-sync could revert a
  // completed retro). Stale writes are rejected — not persisted, not broadcast —
  // and the caller returns the authoritative state to the stale client so it can
  // resync. Accepted writes advance the rev monotonically.
  //
  // Returns { success, stale, data }:
  //   - success:true            -> data is the newly persisted state (with the new _rev)
  //   - success:false stale:true -> data is the current authoritative state (unchanged)
  const saveSessionState = async (sessionId, sessionData) => {
    const key = `session:${sessionId}`;
    const baseRev = Number(sessionData?._rev ?? 0);

    const applyDecision = (current) => {
      const currentRev = current ? Number(current._rev ?? 0) : 0;
      if (current && baseRev < currentRev) {
        return { rejected: true, current };
      }
      const nextRev = Math.max(currentRev, baseRev) + 1;
      const dataWithRev = { ...sessionData, _rev: nextRev, _updatedAt: new Date().toISOString() };
      return { rejected: false, dataWithRev };
    };

    try {
      if (usePostgres) {
        const client = await pgPool.connect();
        try {
          await client.query('BEGIN');
          const lockResult = await client.query(
            'SELECT value FROM kv_store WHERE key = $1 FOR UPDATE',
            [key]
          );
          const rowText = lockResult.rows.length > 0 ? lockResult.rows[0].value : null;
          const current = rowText ? JSON.parse(rowText) : null;

          const decision = applyDecision(current);
          if (decision.rejected) {
            await client.query('ROLLBACK');
            return { success: false, stale: true, data: noteSessionText(decision.current, rowText) };
          }

          const payload = JSON.stringify(decision.dataWithRev);
          await client.query(
            `INSERT INTO kv_store (key, value, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET
               value = EXCLUDED.value,
               updated_at = NOW()`,
            [key, payload]
          );
          await client.query('COMMIT');
          return { success: true, stale: false, data: noteSessionText(decision.dataWithRev, payload) };
        } catch (txErr) {
          await client.query('ROLLBACK').catch(() => {});
          throw txErr;
        } finally {
          client.release();
        }
      } else {
        return sqliteDb.transaction(() => {
          const row = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get(key);
          const current = row?.value ? JSON.parse(row.value) : null;

          const decision = applyDecision(current);
          if (decision.rejected) {
            return { success: false, stale: true, data: noteSessionText(decision.current, row.value) };
          }

          const payload = JSON.stringify(decision.dataWithRev);
          sqliteDb.prepare(
            `INSERT INTO kv_store (key, value, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = CURRENT_TIMESTAMP`
          ).run(key, payload);
          return { success: true, stale: false, data: noteSessionText(decision.dataWithRev, payload) };
        })();
      }
    } catch (err) {
      console.error('[Server] Failed to write session state', err);
      throw err;
    }
  };

  // ---------------------------------------------------------------------------
  // Global settings (`global-settings`): admin email, new-team notifications,
  // the info banner, the AI configuration
  //
  // Several independent settings share one row, each written by its own
  // console route. Reading and writing them are therefore two different
  // functions with two different attitudes to a failed read.
  // ---------------------------------------------------------------------------

  // For readers only. The info banner, the AI status and the notification
  // mails are right to degrade to "not configured" when the row cannot be
  // read. Never feed a write from it: on a read error it answers `{}`, and
  // saving that back with one key changed erases every other setting.
  const loadGlobalSettings = async () => {
    try {
      const data = await kvGet(GLOBAL_SETTINGS_KEY);
      return data || {};
    } catch (err) {
      console.warn('[Server] Failed to load global settings', err);
      return {};
    }
  };

  // The current settings, or a throw: a value that does not parse, or is not
  // one settings object, is not "nothing configured", and writing one key over
  // it would discard whatever a repair could still recover.
  const parseStoredGlobalSettings = (text) => {
    if (!text) return {};
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed)) {
      throw new TypeError('global settings: the stored value is not one settings object');
    }
    return parsed;
  };

  // The row to write, or null when the updater declined. The updater gets a
  // copy, so a declined update answers the stored settings even when it
  // mutated its argument first. A promise serializes as `{}` and a Map as `{}`
  // too, and an array or a string stored here would make every later strict
  // read throw, locking every setting: all refused.
  const applyGlobalSettingsUpdater = (current, updater) => {
    const next = updater(structuredClone(current));
    if (next === null || next === undefined) return null;
    if (typeof next.then === 'function') {
      Promise.resolve(next).catch(() => {});
      throw new TypeError('updateGlobalSettings: the updater must be synchronous');
    }
    if (!isPlainObject(next)) {
      throw new TypeError('updateGlobalSettings: the updater must answer one settings object');
    }
    return next;
  };

  const updateGlobalSettingsOnPostgres = async (updater) => {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      // Two first writers would otherwise both find no row to lock, both
      // insert, and one of their keys would be lost. With the row created
      // here, the second waits on the first's insert and then on its lock.
      await client.query(
        `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, '{}', NOW())
         ON CONFLICT (key) DO NOTHING`,
        [GLOBAL_SETTINGS_KEY]
      );
      const locked = await client.query('SELECT value FROM kv_store WHERE key = $1 FOR UPDATE', [GLOBAL_SETTINGS_KEY]);
      const current = parseStoredGlobalSettings(locked.rows[0]?.value);
      const next = applyGlobalSettingsUpdater(current, updater);
      if (!next) {
        // Also drops the empty row inserted above when there was none.
        await client.query('ROLLBACK');
        return current;
      }
      await client.query(
        'UPDATE kv_store SET value = $2, updated_at = NOW() WHERE key = $1',
        [GLOBAL_SETTINGS_KEY, JSON.stringify(next)]
      );
      await client.query('COMMIT');
      return next;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };

  const updateGlobalSettingsOnSqlite = (updater) => sqliteDb.transaction(() => {
    const row = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get(GLOBAL_SETTINGS_KEY);
    const current = parseStoredGlobalSettings(row?.value);
    const next = applyGlobalSettingsUpdater(current, updater);
    if (!next) return current;
    sqliteDb.prepare(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = CURRENT_TIMESTAMP`
    ).run(GLOBAL_SETTINGS_KEY, JSON.stringify(next));
    return next;
  })();

  // The only way to write the row. Reads, changes and writes it in one
  // transaction holding it, so two writers on two pods cannot lose each
  // other's change, and the read is strict: anything it cannot read as one
  // settings object throws, and nothing is written. `updater(current)` is
  // synchronous, gets the current settings (`{}` for a missing or empty row)
  // and answers the next ones, or null/undefined to change nothing. Answers
  // what is stored afterwards. Each caller sets its own key and keeps the rest.
  const updateGlobalSettings = async (updater) => {
    try {
      return usePostgres
        ? await updateGlobalSettingsOnPostgres(updater)
        : updateGlobalSettingsOnSqlite(updater);
    } catch (err) {
      console.error('[Server] Failed to update global settings', err);
      throw err;
    }
  };

  // ---------------------------------------------------------------------------
  // The Jira connection (`jira-settings`): enabled, base URL, self-signed TLS
  //
  // A row of its own rather than a key of `global-settings`. Its writers used
  // to replace that blob whole after a read that answers `{}` on an error, so a
  // database hiccup during an unrelated save would have erased the connection,
  // and every team's token would then have read as "Jira not configured".
  // `updateGlobalSettings` has closed that hazard for the settings left there,
  // but the connection keeps its own key: the console writes it whole, and a
  // row nobody else writes needs no reasoning about what sits beside it. This
  // read is strict — an error propagates — and a missing row is `null`. An
  // archive holds `team:` rows and `retro-meta` only (iterateArchiveTeams,
  // readArchiveMeta), so no backup archive carries it.
  // ---------------------------------------------------------------------------

  const loadJiraSettings = async () => kvGet(JIRA_SETTINGS_KEY);

  const saveJiraSettings = async (settings) => {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new TypeError('saveJiraSettings: the settings must be one object');
    }
    await kvSet(JIRA_SETTINGS_KEY, settings);
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

  // ---------------------------------------------------------------------------
  // Archive reads: what a backup, a snapshot and the download are built from
  //
  // Strict on purpose. They used to read through `loadPersistedData`, which
  // answered `{ teams: [] }` on any read error: one unreadable team row and
  // every backup stored an EMPTY archive that reported success — and since an
  // automatic backup that succeeds runs retention, each failed run purged one
  // good backup, until every recovery point was empty. A row the archive
  // cannot carry now fails the archive, naming its key and never its content.
  // ---------------------------------------------------------------------------

  // "Team record" only for a team row: `retro-meta` fails the same way, and
  // the line must not send an operator looking for a team.
  const archiveReadError = (key, reason) =>
    Object.assign(new Error(`${key.startsWith(TEAM_PREFIX) ? 'Team record' : 'Record'} ${JSON.stringify(key)} cannot be archived (${reason})`), {
      code: 'BACKUP_READ_FAILED',
      key,
      reason
    });

  // null: the row is gone (SQLite only: deleted between the key scan and the
  // read). The revision stamp is dropped, as loadTeam drops it.
  const archiveTeamFromRow = (key, text) => {
    if (text == null) return null;
    if (text === '') throw archiveReadError(key, 'empty');
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw archiveReadError(key, 'unparsable');
    }
    if (!isPlainObject(value)) throw archiveReadError(key, 'not_an_object');
    const { _rev, _updatedAt, ...team } = value;
    return team;
  };

  // Every team record, one at a time and in key order, for an archive built
  // team by team (backupArchive.js): the builder never holds the whole store.
  //
  // On PostgreSQL every team comes from ONE snapshot, as the single
  // `SELECT key, value … LIKE` it replaced gave: a `REPEATABLE READ READ
  // ONLY` transaction on one pooled client, held for the build (it blocks no
  // writer). Without it, an operation that moves data between two teams while
  // a backup runs — a console deletion moving a merge source's feedbacks into
  // the merged team, then deleting the source — could land in neither half.
  // SQLite has one connection, and a read transaction left open across the
  // awaits would swallow every other request's writes into it, so its rows are
  // read one at a time (accepted: SQLite deployments run one process and are
  // not the production engine; HARDENING_STATUS H10).
  //
  // `ORDER BY key` on both engines, written down rather than inherited from a
  // scan plan. Stopping early (a consumer that throws, `pipeline` destroying
  // its source) runs `finally`, which ends the transaction and releases the
  // client.
  async function* iterateArchiveTeams() {
    if (!usePostgres) {
      const keys = sqliteDb.prepare('SELECT key FROM kv_store WHERE key LIKE ? ORDER BY key').all(TEAM_PREFIX + '%');
      const readValue = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?');
      for (const { key } of keys) {
        const team = archiveTeamFromRow(key, readValue.get(key)?.value);
        if (team) yield team;
      }
      return;
    }
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const keys = await client.query('SELECT key FROM kv_store WHERE key LIKE $1 ORDER BY key', [TEAM_PREFIX + '%']);
      for (const { key } of keys.rows) {
        const { rows } = await client.query('SELECT value FROM kv_store WHERE key = $1', [key]);
        const team = archiveTeamFromRow(key, rows[0]?.value);
        if (team) yield team;
      }
    } finally {
      // Read-only: ending it either way is the same.
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  }

  // `retro-meta` for an archive. loadMetaData turns a present-but-malformed
  // row into empty lists (right for its writers, which rebuild it), which
  // would have the archive silently drop every orphaned feedback. Missing or
  // empty: the empty lists every meta reader sees. A list that is absent is
  // empty; one that is present and not a list fails, as archiveShape refuses
  // it on the way back in.
  const readArchiveMeta = async () => {
    const key = 'retro-meta';
    const text = usePostgres
      ? (await pgPool.query('SELECT value FROM kv_store WHERE key = $1', [key])).rows[0]?.value
      : sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get(key)?.value;
    if (text == null || text === '') return { resetTokens: [], orphanedFeedbacks: [] };
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw archiveReadError(key, 'unparsable');
    }
    if (!isPlainObject(value)) throw archiveReadError(key, 'not_an_object');
    for (const field of ['resetTokens', 'orphanedFeedbacks']) {
      if (value[field] !== undefined && !Array.isArray(value[field])) throw archiveReadError(key, 'list_malformed');
    }
    return { resetTokens: value.resetTokens ?? [], orphanedFeedbacks: value.orphanedFeedbacks ?? [] };
  };

  // The whole store as one archive object, read through the strict readers
  // above — so it throws instead of answering an archive that misses teams.
  // Production builds archives team by team (backupArchive.js) and no longer
  // calls this; the tests use it as the reference representation of an
  // archive, and built on the same readers it cannot drift from what ships.
  const loadPersistedData = async () => {
    const teams = [];
    for await (const team of iterateArchiveTeams()) teams.push(team);
    const meta = await readArchiveMeta();
    return normalizePersistedData({
      teams,
      meta: { revision: 0, updatedAt: new Date().toISOString() },
      resetTokens: meta.resetTokens,
      orphanedFeedbacks: meta.orphanedFeedbacks
    });
  };

  // `mode` controls how the archive is applied to the store:
  //   - 'merge'   (default): upsert the archive's teams/index/meta, leave every
  //     other record in place. This is the historical, additive behaviour and
  //     keeps non-restore callers untouched.
  //   - 'replace' (faithful restore): after upserting the archive, make the
  //     store match the archive exactly — delete team records absent from the
  //     archive (the index was already rebuilt from the archive, so a leftover
  //     `team:{id}` record would otherwise linger as a "ghost team" in prefix
  //     scans and the super-admin dashboard) and clear all live session state
  //     (a backup archive never carries `session:*` blobs, and a stale session
  //     could let a client re-persist pre-restore state and resurrect reverted
  //     data). The archive upsert runs first so a crash mid-cleanup leaves the
  //     restored data in place rather than a half-emptied store.
  //
  // A replace also leaves each team's Jira secret where a restore never rolls a
  // credential back, so it keeps two things true about Jira (see the steps
  // below): an action already created in Jira stays linked, and a secret
  // survives only for a team that is in the archive and existed before it.
  const savePersistedData = async (data, { mode = 'merge' } = {}) => {
    const normalized = normalizePersistedData(data);
    const replace = mode === 'replace';

    // Read before the first write: which teams exist now decides whose Jira
    // secret survives the replace, and whose current record its links are
    // carried from. A failure here throws with nothing written yet.
    const teamIdsBefore = replace
      ? new Set((await kvKeysByPrefix(TEAM_PREFIX)).map((key) => key.slice(TEAM_PREFIX.length)))
      : null;

    // The archive may predate issues created since. The team's token stays, so
    // an action restored without its link would be created in Jira again on
    // the next click: the current links are carried onto the archived copies
    // (`carryJiraLinks`), and so are the session parents of `sessionParent`
    // mode (`carryJiraParents`: the current key wins, since a parent the team
    // re-pointed since must not come back; the archive's claims come back as
    // they were, and expire into uncertain parents). Each current record is
    // read right before the archived one replaces it, one at a time, so a
    // restore never holds every team in memory at once. A record that cannot
    // be read is restored without the carry: losing links is recoverable, a
    // failed restore may not be.
    //
    // The same read decides the team's sessions (decision D3b): a session
    // never outlives the password it was opened with. `current` is null when
    // the record could not be read, which is told apart (`readable`) because
    // an unknown password is treated as a changed one.
    const readCurrentTeam = async (team) => {
      try {
        return { current: await loadTeam(team.id), readable: true };
      } catch (err) {
        console.warn(`[Server] Restore: team ${JSON.stringify(String(team.id))} is restored without carrying its current Jira links (its record could not be read)`, err);
        return { current: null, readable: false };
      }
    };

    // Best-effort, and logged: a restore that really happened must not be
    // reported as failed because a tiny write did not land. The rotation on
    // the other side of the team write is what covers a failure of this one.
    const rotateRestoredTeamEpoch = async (teamId, when) => {
      try {
        await rotateTeamSessionEpoch(teamId);
      } catch (err) {
        console.warn(`[Server] Restore: the session epoch of team ${JSON.stringify(teamId)} could not be rotated ${when} its record was written`, err);
      }
    };

    const archiveTeamIds = new Set();
    const indexMap = new Map();
    for (const team of normalized.teams) {
      const teamId = String(team.id);
      const existedBefore = replace && teamIdsBefore.has(teamId);
      const { current, readable } = existedBefore ? await readCurrentTeam(team) : { current: null, readable: true };
      const restored = current ? carryJiraParents(carryJiraLinks(team, current), current) : team;
      // Decision D3b. A restore that changes which password opens a team signs
      // that team out: the team did not exist before (it comes back with the
      // archived password), its record could not be read, or the archived hash
      // differs from the current one — a re-hash of the same password counts
      // too, which errs on the safe side. A restore that keeps a team's
      // password signs nobody out of it (zero downtime). Rotated before *and*
      // after the write: after alone has a hole a retry makes permanent (the
      // write lands, the rotation does not, and the retry compares two equal
      // hashes), before alone lets a login made in between — with the password
      // about to be rolled away — mint a token under the new epoch.
      const signsOut = replace && (!existedBefore || !readable || !current || current.passwordHash !== team.passwordHash);
      if (signsOut) await rotateRestoredTeamEpoch(teamId, 'before');
      await saveTeam(team.id, restored);
      if (signsOut) await rotateRestoredTeamEpoch(teamId, 'after');
      archiveTeamIds.add(teamId);
      indexMap.set(team.name.toLowerCase(), team.id);
    }
    await saveTeamIndex(indexMap);

    await saveMetaData({
      resetTokens: normalized.resetTokens,
      orphanedFeedbacks: normalized.orphanedFeedbacks
    });

    if (replace) {
      // Secrets before any team row goes, so a failure part-way never leaves a
      // secret behind a team the restore deleted. A secret is kept only for a
      // team in the archive that existed before: its token was never part of
      // the archive, and a restore never rolls a credential back. A team the
      // restore deletes loses its secret with it. A team it brings back
      // (deleted since the backup) had none: a row under its id is one its
      // deletion left behind, and re-attaching it would hand the revived team a
      // token nobody set for it since.
      for (const key of await kvKeysByPrefix(TEAM_SECRET_PREFIX)) {
        const teamId = key.slice(TEAM_SECRET_PREFIX.length);
        if (archiveTeamIds.has(teamId) && teamIdsBefore.has(teamId)) continue;
        await kvDelete(key);
      }

      const existingTeamKeys = await kvKeysByPrefix(TEAM_PREFIX);
      for (const key of existingTeamKeys) {
        const teamId = key.slice(TEAM_PREFIX.length);
        if (!archiveTeamIds.has(teamId)) {
          await kvDelete(key);
        }
      }
      // The session epochs of the teams the replace deleted, after their
      // records (the deleteTeamRecord order), and only of teams the archive
      // does not hold: removing a live team's row would reset it to epoch '0'.
      // Best-effort: a row left behind is an orphan the boot sweep removes.
      for (const key of await kvKeysByPrefix(TEAM_AUTH_PREFIX)) {
        if (archiveTeamIds.has(key.slice(TEAM_AUTH_PREFIX.length))) continue;
        try {
          await kvDelete(key);
        } catch (err) {
          console.warn(`[Server] Restore: the session epoch row ${JSON.stringify(key)} could not be removed; the boot sweep removes it`, err);
        }
      }
      await kvDeleteByPrefix(SESSION_PREFIX);
    }

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
  // Security event log (audit H45) — append-only
  //
  // Two functions, and that is the whole surface: there is no update and no
  // delete, which is what "append-only" means here. `__tests__/securityEventLog`
  // asserts that surface, so adding a third has to be argued for rather than
  // slipped in. The database itself does not enforce it — an operator with SQL
  // access can delete rows — and the docs say so rather than claiming more.
  // ---------------------------------------------------------------------------

  const appendSecurityEvent = async (event) => {
    const values = [
      event.createdAt,
      event.action,
      event.actor,
      event.outcome,
      event.target ?? null,
      event.sourceIp ?? null,
      event.correlationId ?? null,
      event.detail ?? null
    ];
    if (usePostgres) {
      await pgPool.query(
        `INSERT INTO security_events
           (created_at, action, actor, outcome, target, source_ip, correlation_id, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        values
      );
    } else {
      sqliteDb.prepare(
        `INSERT INTO security_events
           (created_at, action, actor, outcome, target, source_ip, correlation_id, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(...values);
    }
  };

  const mapSecurityEvent = (row) => ({
    id: Number(row.id),
    createdAt: row.created_at,
    action: row.action,
    actor: row.actor,
    outcome: row.outcome,
    target: row.target ?? null,
    sourceIp: row.source_ip ?? null,
    correlationId: row.correlation_id ?? null,
    detail: row.detail ?? null
  });

  // Newest first. Ordered by `id` rather than `created_at`: the timestamp is
  // an ISO string written by the application, so two events inside the same
  // millisecond — a burst of failed logins is exactly that — would come back
  // in an arbitrary order and an investigation would read the sequence wrong.
  const listSecurityEvents = async ({ limit = 200 } = {}) => {
    const bounded = Math.max(1, Math.min(Number(limit) || 200, 1000));
    if (usePostgres) {
      const result = await pgPool.query(
        'SELECT * FROM security_events ORDER BY id DESC LIMIT $1', [bounded]
      );
      return result.rows.map(mapSecurityEvent);
    }
    return sqliteDb
      .prepare('SELECT * FROM security_events ORDER BY id DESC LIMIT ?')
      .all(bounded)
      .map(mapSecurityEvent);
  };

  // ---------------------------------------------------------------------------
  // Backup storage (replaces filesystem-based backups for multi-pod support)
  // ---------------------------------------------------------------------------

  const saveBackup = async (entry, compressedData) => {
    if (usePostgres) {
      await pgPool.query(
        `INSERT INTO backups (id, filename, type, label, created_at, size_bytes, team_count, protected, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [entry.id, entry.filename, entry.type, entry.label || null, entry.createdAt,
         entry.sizeBytes, entry.teamCount, entry.protected || false, compressedData]
      );
    } else {
      sqliteDb.prepare(
        `INSERT INTO backups (id, filename, type, label, created_at, size_bytes, team_count, protected, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(entry.id, entry.filename, entry.type, entry.label || null, entry.createdAt,
            entry.sizeBytes, entry.teamCount, entry.protected ? 1 : 0, compressedData);
    }
  };

  const listBackups = async () => {
    if (usePostgres) {
      const result = await pgPool.query(
        `SELECT id, filename, type, label, created_at, size_bytes, team_count, protected
         FROM backups ORDER BY created_at DESC`
      );
      return result.rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        type: row.type,
        label: row.label || undefined,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        sizeBytes: row.size_bytes,
        teamCount: row.team_count,
        protected: !!row.protected
      }));
    } else {
      const rows = sqliteDb.prepare(
        `SELECT id, filename, type, label, created_at, size_bytes, team_count, protected
         FROM backups ORDER BY created_at DESC`
      ).all();
      return rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        type: row.type,
        label: row.label || undefined,
        createdAt: row.created_at,
        sizeBytes: row.size_bytes,
        teamCount: row.team_count,
        protected: !!row.protected
      }));
    }
  };

  const getBackupData = async (id) => {
    if (usePostgres) {
      const result = await pgPool.query(
        'SELECT data, filename FROM backups WHERE id = $1', [id]
      );
      if (result.rows.length === 0) return null;
      return { data: result.rows[0].data, filename: result.rows[0].filename };
    } else {
      const row = sqliteDb.prepare(
        'SELECT data, filename FROM backups WHERE id = ?'
      ).get(id);
      if (!row) return null;
      return { data: row.data, filename: row.filename };
    }
  };

  const deleteBackup = async (id) => {
    if (usePostgres) {
      const result = await pgPool.query('DELETE FROM backups WHERE id = $1', [id]);
      return result.rowCount > 0;
    } else {
      const result = sqliteDb.prepare('DELETE FROM backups WHERE id = ?').run(id);
      return result.changes > 0;
    }
  };

  const updateBackup = async (id, updates) => {
    const setClauses = [];
    const values = [];

    if (updates.label !== undefined) {
      setClauses.push(usePostgres ? `label = $${values.length + 1}` : 'label = ?');
      values.push(updates.label || null);
    }
    if (updates.protected !== undefined) {
      setClauses.push(usePostgres ? `protected = $${values.length + 1}` : 'protected = ?');
      values.push(usePostgres ? !!updates.protected : (updates.protected ? 1 : 0));
    }

    if (setClauses.length === 0) return null;

    if (usePostgres) {
      values.push(id);
      const result = await pgPool.query(
        `UPDATE backups SET ${setClauses.join(', ')} WHERE id = $${values.length}
         RETURNING id, filename, type, label, created_at, size_bytes, team_count, protected`,
        values
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id, filename: row.filename, type: row.type,
        label: row.label || undefined,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        sizeBytes: row.size_bytes, teamCount: row.team_count, protected: !!row.protected
      };
    } else {
      values.push(id);
      const result = sqliteDb.prepare(
        `UPDATE backups SET ${setClauses.join(', ')} WHERE id = ?`
      ).run(...values);
      if (result.changes === 0) return null;
      const row = sqliteDb.prepare(
        `SELECT id, filename, type, label, created_at, size_bytes, team_count, protected
         FROM backups WHERE id = ?`
      ).get(id);
      if (!row) return null;
      return {
        id: row.id, filename: row.filename, type: row.type,
        label: row.label || undefined, createdAt: row.created_at,
        sizeBytes: row.size_bytes, teamCount: row.team_count, protected: !!row.protected
      };
    }
  };

  // Returns a recent backup of the given type (created within the last
  // `withinMs`), or null. Used for the startup-backup dedup.
  const getRecentBackupByType = async (type, withinMs) => {
    const cutoff = new Date(Date.now() - withinMs).toISOString();
    if (usePostgres) {
      const result = await pgPool.query(
        `SELECT id FROM backups WHERE type = $1 AND created_at > $2 LIMIT 1`,
        [type, cutoff]
      );
      return result.rows.length > 0 ? result.rows[0] : null;
    } else {
      const row = sqliteDb.prepare(
        `SELECT id FROM backups WHERE type = ? AND created_at > ? LIMIT 1`
      ).get(type, cutoff);
      return row || null;
    }
  };

  // ---------------------------------------------------------------------------
  // Multi-pod scheduler election for `auto` backups
  // ---------------------------------------------------------------------------
  //
  // A dedicated KV marker records when the last scheduled `auto` backup interval
  // was claimed. `claimAutoBackupInterval` reads and advances it inside a single
  // serialized transaction, so exactly one pod wins a given interval even when
  // every pod's timer fires at once. This is why it is not a plain existence
  // check on the `backups` table: there, each pod's expensive load+gzip runs
  // between the check and the row insert, so many pods can pass the check before
  // any writes — the classic non-atomic check-then-write stampede. It is also a
  // separate marker from the `backups` table on purpose: a super-admin restore's
  // protected pre-restore snapshot is an `auto`-typed backup but must never count
  // as the interval's scheduled winner (it would otherwise suppress the next
  // scheduled backup for a whole window after a restore).
  const BACKUP_ELECTION_KEY = 'backup-election';

  const readElectionTimestamp = (raw) => {
    if (!raw) return 0;
    try {
      const parsed = Number(JSON.parse(raw)?.lastAutoBackupAt ?? 0);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      return 0;
    }
  };

  // Atomically claims the current scheduled-backup interval. Returns true if
  // THIS caller won it (and should proceed to create the backup), false if
  // another pod already claimed it within `windowMs`.
  const claimAutoBackupInterval = async (windowMs) => {
    const now = Date.now();
    const nextValue = JSON.stringify({ lastAutoBackupAt: now });

    if (usePostgres) {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        // Ensure the row exists so the FOR UPDATE below always locks it, making
        // even the very first claim on a fresh database atomic across pods.
        await client.query(
          `INSERT INTO kv_store (key, value, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO NOTHING`,
          [BACKUP_ELECTION_KEY, JSON.stringify({ lastAutoBackupAt: 0 })]
        );
        const locked = await client.query(
          'SELECT value FROM kv_store WHERE key = $1 FOR UPDATE',
          [BACKUP_ELECTION_KEY]
        );
        const last = readElectionTimestamp(locked.rows[0]?.value);
        if (last > 0 && now - last < windowMs) {
          await client.query('ROLLBACK');
          return false;
        }
        await client.query(
          'UPDATE kv_store SET value = $2, updated_at = NOW() WHERE key = $1',
          [BACKUP_ELECTION_KEY, nextValue]
        );
        await client.query('COMMIT');
        return true;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    } else {
      // better-sqlite3 transactions are synchronous and serialized, so the
      // read-decide-write below is atomic against any concurrent writer.
      return sqliteDb.transaction(() => {
        const row = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get(BACKUP_ELECTION_KEY);
        const last = readElectionTimestamp(row?.value);
        if (last > 0 && now - last < windowMs) {
          return false;
        }
        sqliteDb.prepare(
          `INSERT INTO kv_store (key, value, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
        ).run(BACKUP_ELECTION_KEY, nextValue);
        return true;
      })();
    }
  };

  // Releases the current interval claim (resets the marker) so the next
  // scheduler tick can re-elect — used when a claimed backup did not actually
  // persist, to avoid the store skipping a whole window with no scheduled backup.
  const releaseAutoBackupClaim = async () => {
    const value = JSON.stringify({ lastAutoBackupAt: 0 });
    if (usePostgres) {
      await pgPool.query(
        `INSERT INTO kv_store (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [BACKUP_ELECTION_KEY, value]
      );
    } else {
      sqliteDb.prepare(
        `INSERT INTO kv_store (key, value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
      ).run(BACKUP_ELECTION_KEY, value);
    }
  };

  const purgeOldBackups = async (types, maxCount) => {
    // Get non-protected backups of given types, ordered oldest first
    const typePlaceholders = usePostgres
      ? types.map((_, i) => `$${i + 1}`).join(', ')
      : types.map(() => '?').join(', ');

    const protectedVal = usePostgres ? false : 0;

    if (usePostgres) {
      const countResult = await pgPool.query(
        `SELECT id FROM backups WHERE type IN (${typePlaceholders}) AND protected = $${types.length + 1}
         ORDER BY created_at ASC`,
        [...types, protectedVal]
      );
      const excess = countResult.rows.length - maxCount;
      if (excess <= 0) return 0;

      const idsToDelete = countResult.rows.slice(0, excess).map((r) => r.id);
      const idPlaceholders = idsToDelete.map((_, i) => `$${i + 1}`).join(', ');
      await pgPool.query(`DELETE FROM backups WHERE id IN (${idPlaceholders})`, idsToDelete);
      return excess;
    } else {
      const rows = sqliteDb.prepare(
        `SELECT id FROM backups WHERE type IN (${typePlaceholders}) AND protected = ?
         ORDER BY created_at ASC`
      ).all(...types, protectedVal);
      const excess = rows.length - maxCount;
      if (excess <= 0) return 0;

      const idsToDelete = rows.slice(0, excess).map((r) => r.id);
      const idPlaceholders = idsToDelete.map(() => '?').join(', ');
      sqliteDb.prepare(`DELETE FROM backups WHERE id IN (${idPlaceholders})`).run(...idsToDelete);
      return excess;
    }
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

  const closeDatabase = async () => {
    if (pgPool) {
      await pgPool.end();
      pgPool = null;
    }

    if (sqliteDb) {
      sqliteDb.close();
      sqliteDb = null;
    }
  };

  const getPgPool = () => pgPool;
  const getSqliteDb = () => sqliteDb;

  return {
    initDatabase,

    // Per-team operations (new, contention-free)
    loadTeam,
    loadTeamRaw,
    teamExists,
    saveTeam,
    deleteTeamRecord,

    // Team session epochs (decision D3b): one cheap read for every token check,
    // a blind rotation for the restores, and the boot sweep
    loadTeamAuthState,
    rotateTeamSessionEpoch,
    sweepOrphanedTeamAuthRows,
    loadAllTeams,
    loadAllTeamFeedbacks,
    loadTeamSummaries,
    loadTeamSummary,
    // The legacy password pass's read: never cached, never sent anywhere
    loadTeamPasswordHashes,
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

    // Archive reads (strict: a row the archive cannot carry throws)
    iterateArchiveTeams,
    readArchiveMeta,

    // Legacy compat (backup/restore, aggregated reads)
    loadPersistedData,
    savePersistedData,
    refreshPersistedData,

    // Session state
    loadSessionState,
    saveSessionState,
    // The text length of a session object this store parsed or wrote, for
    // the session cache's byte cap (undefined for any other object)
    sessionTextLength,

    // Global settings: a lenient read for readers, a strict locked update for
    // writers (no whole-blob save: see updateGlobalSettings)
    loadGlobalSettings,
    updateGlobalSettings,

    // Jira: the connection (strict read) and each team's sealed token
    loadJiraSettings,
    saveJiraSettings,
    loadTeamSecret,
    saveTeamSecret,
    updateTeamSecret,
    deleteTeamSecret,
    sweepOrphanedTeamSecrets,

    // Migration
    migrateFromLegacyFormat,

    // Security event log (append-only: no update, no delete — audit H45)
    appendSecurityEvent,
    listSecurityEvents,

    // Backup storage
    saveBackup,
    listBackups,
    getBackupData,
    deleteBackup,
    updateBackup,
    getRecentBackupByType,
    claimAutoBackupInterval,
    releaseAutoBackupClaim,
    purgeOldBackups,

    // Infra
    closeDatabase,
    getPgPool,
    getSqliteDb,
    usePostgres
  };
};

export { createDataStore };
