export const SOCKET_ADAPTER_STRATEGIES = {
  REDIS: 'redis',
  POSTGRES: 'postgres',
  MEMORY: 'memory'
};

export const resolveSocketAdapterStrategy = ({ hasRedisConfig, usePostgres }) => {
  if (hasRedisConfig) {
    return SOCKET_ADAPTER_STRATEGIES.REDIS;
  }

  if (usePostgres) {
    return SOCKET_ADAPTER_STRATEGIES.POSTGRES;
  }

  return SOCKET_ADAPTER_STRATEGIES.MEMORY;
};
