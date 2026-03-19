/**
 * Configuration - BlazeConnector v3
 * Centralized configuration with type safety and validation
 */

import { z } from 'zod';

const ConfigSchema = z.object({
  // Application
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().int().positive().default(3005),
  appName: z.string().default('BlazeConnector'),
  
  // Database
  databaseUrl: z.string().url(),
  
  // Redis
  redisUrl: z.string().url(),
  
  // CORS
  corsOrigin: z.string().default('*'),
  
  // Logging
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  logPretty: z.coerce.boolean().default(true),
  
  // Message Queue
  queueConcurrency: z.coerce.number().int().positive().default(10),
  queueRetryAttempts: z.coerce.number().int().positive().default(3),
  queueRetryBaseDelay: z.coerce.number().int().positive().default(1000),
  queueMaxMessagesPerBatch: z.coerce.number().int().positive().default(100),
  
  // Rate Limiting
  rateLimitWindowMs: z.coerce.number().int().positive().default(60000),
  rateLimitMaxRequests: z.coerce.number().int().positive().default(100),
  
  // Worker
  workerEnabled: z.coerce.boolean().default(true),
  workerPollIntervalMs: z.coerce.number().int().positive().default(5000),
  
  // Integrations
  whatsappCloudUrl: z.string().url().default('https://graph.facebook.com/v21.0'),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  return ConfigSchema.parse({
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    appName: process.env.APP_NAME,
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    corsOrigin: process.env.CORS_ORIGIN,
    logLevel: process.env.LOG_LEVEL,
    logPretty: process.env.LOG_PRETTY,
    queueConcurrency: process.env.QUEUE_CONCURRENCY,
    queueRetryAttempts: process.env.QUEUE_RETRY_ATTEMPTS,
    queueRetryBaseDelay: process.env.QUEUE_RETRY_BASE_DELAY,
    queueMaxMessagesPerBatch: process.env.QUEUE_MAX_MESSAGES_PER_BATCH,
    rateLimitWindowMs: process.env.RATE_LIMIT_WINDOW_MS,
    rateLimitMaxRequests: process.env.RATE_LIMIT_MAX_REQUESTS,
    workerEnabled: process.env.WORKER_ENABLED,
    workerPollIntervalMs: process.env.WORKER_POLL_INTERVAL_MS,
    whatsappCloudUrl: process.env.WHATSAPP_CLOUD_URL,
  });
}

// Singleton config instance
let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

export function reloadConfig(): Config {
  _config = loadConfig();
  return _config;
}

// Helper to check environment
export const isDev = () => getConfig().nodeEnv === 'development';
export const isProd = () => getConfig().nodeEnv === 'production';
export const isTest = () => getConfig().nodeEnv === 'test';
