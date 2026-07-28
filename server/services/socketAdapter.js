import { createAdapter as createRedisAdapter } from '@socket.io/redis-adapter';
import { createAdapter as createPostgresAdapter } from '@socket.io/postgres-adapter';
import { createClient } from 'redis';

const SOCKET_ADAPTER_STRATEGIES = {
  REDIS: 'redis',
  POSTGRES: 'postgres',
  MEMORY: 'memory'
};

/**
 * Picks the cross-pod broadcast backend. Redis wins when configured, then
 * PostgreSQL when it is already the data store; otherwise the process keeps
 * Socket.IO's in-memory adapter, which is correct for a single pod only.
 */
const resolveSocketAdapterStrategy = ({ hasRedisConfig, usePostgres }) => {
  if (hasRedisConfig) {
    return SOCKET_ADAPTER_STRATEGIES.REDIS;
  }

  if (usePostgres) {
    return SOCKET_ADAPTER_STRATEGIES.POSTGRES;
  }

  return SOCKET_ADAPTER_STRATEGIES.MEMORY;
};

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

const initRedisAdapter = async (io, redisConfig) => {
  try {
    const pubClient = createClient(redisConfig);
    const subClient = pubClient.duplicate();

    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createRedisAdapter(pubClient, subClient));
    console.info('[Server] Using Redis adapter for Socket IO (multi-pod ready)');
    return true;
  } catch (err) {
    console.error('[Server] Failed to initialize Redis adapter', err);
    return false;
  }
};

const initPostgresAdapter = async (io, pgPool) => {
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
    console.info('[Server] Using PostgreSQL adapter for Socket IO (multi-pod ready)');
    return true;
  } catch (err) {
    console.error('[Server] Failed to initialize PostgreSQL adapter', err);
    return false;
  }
};

const initSocketAdapter = async ({ io, dataStore }) => {
  const redisConfig = buildRedisConfig();
  const strategy = resolveSocketAdapterStrategy({
    hasRedisConfig: !!redisConfig,
    usePostgres: dataStore.usePostgres
  });

  if (strategy === SOCKET_ADAPTER_STRATEGIES.REDIS) {
    return initRedisAdapter(io, redisConfig);
  }

  if (strategy === SOCKET_ADAPTER_STRATEGIES.POSTGRES) {
    return initPostgresAdapter(io, dataStore.getPgPool());
  }

  console.info('[Server] Using in-memory Socket IO adapter (single-pod)');
  return false;
};

export { initSocketAdapter, resolveSocketAdapterStrategy, SOCKET_ADAPTER_STRATEGIES };
