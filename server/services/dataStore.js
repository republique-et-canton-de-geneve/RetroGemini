import fs from 'fs';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';
import pg from 'pg';

const TEAM_PREFIX = 'team:';
const SESSION_PREFIX = 'session:';

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
      // A conflict here is expected under concurrency and is retried silently;
      // only an exhausted retry budget (below) is worth a log line.
    }

    console.warn(`[Server] Team update for ${teamId} failed after ${MAX_RETRIES} retries`);
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

  // Summary projection for list/dashboard views. Extracts only the lightweight
  // fields those views need (id, name, facilitator email, last connection,
  // member roster) directly in SQL, so the server never deserializes each
  // team's full retrospective/health-check history just to render a list. This
  // is the hot path behind the login screen's team picker and the super-admin
  // dashboard; at 100-200 teams, parsing every full team blob per request is
  // the dominant cost this avoids.
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

  const loadTeamSummaries = async () => {
    // LIKE (not a collation-sensitive range) for the same reason as
    // kvGetMultipleByPrefix above.
    if (usePostgres) {
      const result = await pgPool.query(
        `SELECT (value::jsonb)->>'id' AS id,
                (value::jsonb)->>'name' AS name,
                (value::jsonb)->>'facilitatorEmail' AS facilitator_email,
                (value::jsonb)->>'lastConnectionDate' AS last_connection_date,
                (value::jsonb)->'members' AS members
         FROM kv_store WHERE key LIKE $1`,
        [TEAM_PREFIX + '%']
      );
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        facilitatorEmail: row.facilitator_email || undefined,
        lastConnectionDate: row.last_connection_date || undefined,
        members: normalizeJsonArray(row.members)
      }));
    }

    const rows = sqliteDb.prepare(
      `SELECT json_extract(value, '$.id') AS id,
              json_extract(value, '$.name') AS name,
              json_extract(value, '$.facilitatorEmail') AS facilitator_email,
              json_extract(value, '$.lastConnectionDate') AS last_connection_date,
              json_extract(value, '$.members') AS members
       FROM kv_store WHERE key LIKE ?`
    ).all(TEAM_PREFIX + '%');

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      facilitatorEmail: row.facilitator_email || undefined,
      lastConnectionDate: row.last_connection_date || undefined,
      members: normalizeJsonArray(row.members)
    }));
  };

  // Feedback projection for the Feedback Hub and the super-admin feedback view.
  // Like loadTeamSummaries, it extracts only each team's id, name and
  // teamFeedbacks array directly in SQL, so those endpoints never deserialize
  // every team's full retrospective/health-check history in JS just to collect
  // bug reports and feature requests (audit R10). The heavy history fields never
  // leave the database. Returns [{ id, name, teamFeedbacks }]; teams with no
  // feedback key yield an empty array.
  const loadAllTeamFeedbacks = async () => {
    if (usePostgres) {
      const result = await pgPool.query(
        `SELECT (value::jsonb)->>'id' AS id,
                (value::jsonb)->>'name' AS name,
                (value::jsonb)->'teamFeedbacks' AS team_feedbacks
         FROM kv_store WHERE key LIKE $1`,
        [TEAM_PREFIX + '%']
      );
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        teamFeedbacks: normalizeJsonArray(row.team_feedbacks)
      }));
    }

    const rows = sqliteDb.prepare(
      `SELECT json_extract(value, '$.id') AS id,
              json_extract(value, '$.name') AS name,
              json_extract(value, '$.teamFeedbacks') AS team_feedbacks
       FROM kv_store WHERE key LIKE ?`
    ).all(TEAM_PREFIX + '%');

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      teamFeedbacks: normalizeJsonArray(row.team_feedbacks)
    }));
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
          const current = lockResult.rows.length > 0 && lockResult.rows[0].value
            ? JSON.parse(lockResult.rows[0].value)
            : null;

          const decision = applyDecision(current);
          if (decision.rejected) {
            await client.query('ROLLBACK');
            return { success: false, stale: true, data: decision.current };
          }

          await client.query(
            `INSERT INTO kv_store (key, value, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET
               value = EXCLUDED.value,
               updated_at = NOW()`,
            [key, JSON.stringify(decision.dataWithRev)]
          );
          await client.query('COMMIT');
          return { success: true, stale: false, data: decision.dataWithRev };
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
            return { success: false, stale: true, data: decision.current };
          }

          sqliteDb.prepare(
            `INSERT INTO kv_store (key, value, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = CURRENT_TIMESTAMP`
          ).run(key, JSON.stringify(decision.dataWithRev));
          return { success: true, stale: false, data: decision.dataWithRev };
        })();
      }
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
  const savePersistedData = async (data, { mode = 'merge' } = {}) => {
    const normalized = normalizePersistedData(data);

    const archiveTeamIds = new Set();
    const indexMap = new Map();
    for (const team of normalized.teams) {
      await saveTeam(team.id, team);
      archiveTeamIds.add(String(team.id));
      indexMap.set(team.name.toLowerCase(), team.id);
    }
    await saveTeamIndex(indexMap);

    await saveMetaData({
      resetTokens: normalized.resetTokens,
      orphanedFeedbacks: normalized.orphanedFeedbacks
    });

    if (mode === 'replace') {
      const existingTeamKeys = await kvKeysByPrefix(TEAM_PREFIX);
      for (const key of existingTeamKeys) {
        const teamId = key.slice(TEAM_PREFIX.length);
        if (!archiveTeamIds.has(teamId)) {
          await kvDelete(key);
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
    saveTeam,
    deleteTeamRecord,
    loadAllTeams,
    loadAllTeamFeedbacks,
    loadTeamSummaries,
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
