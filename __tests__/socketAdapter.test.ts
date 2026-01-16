import { describe, expect, it } from 'vitest';
import {
  resolveSocketAdapterStrategy,
  SOCKET_ADAPTER_STRATEGIES
} from '../socketAdapter';

describe('resolveSocketAdapterStrategy', () => {
  it('prefers Redis when a Redis config is available', () => {
    const strategy = resolveSocketAdapterStrategy({
      hasRedisConfig: true,
      usePostgres: true
    });

    expect(strategy).toBe(SOCKET_ADAPTER_STRATEGIES.REDIS);
  });

  it('uses PostgreSQL when Redis is unavailable and Postgres is enabled', () => {
    const strategy = resolveSocketAdapterStrategy({
      hasRedisConfig: false,
      usePostgres: true
    });

    expect(strategy).toBe(SOCKET_ADAPTER_STRATEGIES.POSTGRES);
  });

  it('falls back to in-memory adapter when no shared backend exists', () => {
    const strategy = resolveSocketAdapterStrategy({
      hasRedisConfig: false,
      usePostgres: false
    });

    expect(strategy).toBe(SOCKET_ADAPTER_STRATEGIES.MEMORY);
  });
});
