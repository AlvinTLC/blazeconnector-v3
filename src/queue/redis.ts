/**
 * Redis Client - BlazeConnector v3
 * Singleton Redis connection using ioredis
 */

import Redis from 'ioredis';
import { getConfig } from '../core/config';
import { log } from '../core/logger';

let _redis: Redis | null = null;
let _pubsub: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    const config = getConfig();
    
    _redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: false,
      keepAlive: 10000,
      connectTimeout: 10000,
      commandTimeout: 5000,
    });
    
    _redis.on('connect', () => {
      log.redis.info('Redis connected');
    });
    
    _redis.on('error', (err) => {
      log.redis.error({ err }, 'Redis connection error');
    });
    
    _redis.on('close', () => {
      log.redis.warn('Redis connection closed');
    });
  }
  
  return _redis;
}

export function getPubSubClient(): Redis {
  if (!_pubsub) {
    const config = getConfig();
    
    _pubsub = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null, // Required for pub/sub
      lazyConnect: false,
    });
    
    _pubsub.on('error', (err) => {
      log.redis.error({ err }, 'Redis pub/sub error');
    });
  }
  
  return _pubsub;
}

export async function closeRedis(): Promise<void> {
  const promises: Promise<void>[] = [];
  
  if (_redis) {
    promises.push(_redis.quit().then(() => { _redis = null; }));
  }
  
  if (_pubsub) {
    promises.push(_pubsub.quit().then(() => { _pubsub = null; }));
  }
  
  await Promise.all(promises);
  log.redis.info('Redis connections closed');
}

// Redis key helpers
export const RedisKeys = {
  // Queue keys
  messageQueue: 'queue:messages',
  messageQueuePriority: (priority: number) => `queue:messages:priority:${priority}`,
  messageQueueDelayed: 'queue:messages:delayed',
  messageQueueProcessing: 'queue:messages:processing',
  messageQueueFailed: 'queue:messages:failed',
  
  // Message state
  message: (id: string) => `message:${id}`,
  messageLock: (id: string) => `message:lock:${id}`,
  
  // Client cache
  client: (id: string) => `client:${id}`,
  clientBySlug: (slug: string) => `client:slug:${slug}`,
  clientIntegrations: (clientId: string) => `client:${clientId}:integrations`,
  
  // API Key cache
  apiKey: (hash: string) => `apikey:${hash}`,
  apiKeyByPrefix: (prefix: string) => `apikey:prefix:${prefix}`,
  
  // Rate limiting
  rateLimit: (clientId: string, type: string) => `ratelimit:${clientId}:${type}`,
  
  // Idempotency
  idempotency: (key: string) => `idempotency:${key}`,
  
  // Pub/Sub channels
  channelMessages: 'channel:messages',
  channelPayments: 'channel:payments',
  channelEvents: 'channel:events',
} as const;

// TTL constants
export const RedisTTL = {
  clientCache: 300, // 5 minutes
  apiKeyCache: 300, // 5 minutes
  messageLock: 60, // 1 minute
  idempotency: 86400, // 24 hours
  rateLimit: 60, // 1 minute
} as const;
