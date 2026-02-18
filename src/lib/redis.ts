import { getEnv } from "../config/env";

/**
 * Returns a Redis connection config object suitable for BullMQ.
 * BullMQ manages its own ioredis instances internally.
 */
export function getRedisConfig() {
  return { url: getEnv().REDIS_URL };
}
