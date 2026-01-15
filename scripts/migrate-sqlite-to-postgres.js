#!/usr/bin/env node
/**
 * Migration script: SQLite → PostgreSQL
 *
 * Usage:
 *   node scripts/migrate-sqlite-to-postgres.js <sqlite-path> <postgres-url>
 *
 * Examples:
 *   node scripts/migrate-sqlite-to-postgres.js ./data.sqlite "postgresql://user:pass@host:5432/db"
 *   node scripts/migrate-sqlite-to-postgres.js /data/data.sqlite "$DATABASE_URL"
 */

import Database from 'better-sqlite3';
import pg from 'pg';

const [,, sqlitePath, postgresUrl] = process.argv;

if (!sqlitePath || !postgresUrl) {
  console.error('Usage: node migrate-sqlite-to-postgres.js <sqlite-path> <postgres-url>');
  console.error('');
  console.error('Examples:');
  console.error('  node scripts/migrate-sqlite-to-postgres.js ./data.sqlite "postgresql://user:pass@host:5432/db"');
  console.error('  node scripts/migrate-sqlite-to-postgres.js /data/data.sqlite "$DATABASE_URL"');
  process.exit(1);
}

async function migrate() {
  console.log('=== SQLite to PostgreSQL Migration ===\n');

  // 1. Open SQLite database
  console.log(`[1/5] Opening SQLite database: ${sqlitePath}`);
  let sqliteDb;
  try {
    sqliteDb = new Database(sqlitePath, { readonly: true });
    console.log('      ✓ SQLite connection successful\n');
  } catch (err) {
    console.error(`      ✗ Failed to open SQLite: ${err.message}`);
    process.exit(1);
  }

  // 2. Read data from SQLite
  console.log('[2/5] Reading data from SQLite...');
  let data;
  try {
    const row = sqliteDb.prepare('SELECT value FROM kv_store WHERE key = ?').get('retro-data');
    if (row?.value) {
      data = JSON.parse(row.value);
      const teamCount = data.teams?.length || 0;
      let sessionCount = 0;
      let healthCheckCount = 0;
      for (const team of data.teams || []) {
        sessionCount += team.retrospectives?.length || 0;
        healthCheckCount += team.healthChecks?.length || 0;
      }
      console.log(`      ✓ Found ${teamCount} team(s), ${sessionCount} retrospective(s), ${healthCheckCount} health check(s)\n`);
    } else {
      console.log('      ⚠ No data found in SQLite (empty database)');
      data = { teams: [] };
    }
  } catch (err) {
    console.error(`      ✗ Failed to read SQLite data: ${err.message}`);
    process.exit(1);
  }

  // 3. Connect to PostgreSQL
  console.log('[3/5] Connecting to PostgreSQL...');
  const pgPool = new pg.Pool({
    connectionString: postgresUrl,
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  let pgClient;
  try {
    pgClient = await pgPool.connect();
    console.log('      ✓ PostgreSQL connection successful\n');
  } catch (err) {
    console.error(`      ✗ Failed to connect to PostgreSQL: ${err.message}`);
    process.exit(1);
  }

  // 4. Create table if not exists
  console.log('[4/5] Ensuring PostgreSQL table exists...');
  try {
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('      ✓ Table kv_store ready\n');
  } catch (err) {
    console.error(`      ✗ Failed to create table: ${err.message}`);
    pgClient.release();
    await pgPool.end();
    process.exit(1);
  }

  // 5. Check if PostgreSQL already has data
  console.log('[5/5] Migrating data to PostgreSQL...');
  try {
    const existing = await pgClient.query('SELECT value FROM kv_store WHERE key = $1', ['retro-data']);

    if (existing.rows.length > 0 && existing.rows[0].value) {
      const existingData = JSON.parse(existing.rows[0].value);
      const existingTeams = existingData.teams?.length || 0;

      if (existingTeams > 0) {
        console.log(`      ⚠ PostgreSQL already has ${existingTeams} team(s)`);
        console.log('');
        console.log('      Choose an option:');
        console.log('        1. Run with --force to overwrite existing data');
        console.log('        2. Manually backup PostgreSQL data first');
        console.log('');

        if (!process.argv.includes('--force')) {
          console.log('      Migration aborted (use --force to overwrite)');
          pgClient.release();
          await pgPool.end();
          process.exit(1);
        }
        console.log('      --force flag detected, overwriting...');
      }
    }

    // Insert/update data
    const payload = JSON.stringify(data);
    await pgClient.query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      ['retro-data', payload]
    );

    console.log('      ✓ Data migrated successfully!\n');
  } catch (err) {
    console.error(`      ✗ Failed to migrate data: ${err.message}`);
    pgClient.release();
    await pgPool.end();
    process.exit(1);
  }

  // Cleanup
  pgClient.release();
  await pgPool.end();
  sqliteDb.close();

  console.log('=== Migration Complete ===');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Verify your application works with PostgreSQL');
  console.log('  2. Set DATABASE_URL environment variable');
  console.log('  3. Redeploy your application');
}

migrate().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
