/**
 * API Middleware - BlazeConnector v3
 * Authentication, rate limiting, and request processing
 */

import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createHash } from 'crypto';
import { getRedis, RedisKeys, RedisTTL } from '../queue/redis';
import { getDb } from '../db';
import { apiKeys, clients } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { log } from '../core/logger';
import { getConfig } from '../core/config';
import { z } from 'zod';

// ============================================================================
// Types
// ============================================================================

declare module 'hono' {
  interface ContextVariableMap {
    client: typeof clients.$inferSelect;
    apiKey: typeof apiKeys.$inferSelect;
    requestId: string;
  }
}

// ============================================================================
// Request ID
// ============================================================================

export async function requestId(c: Context, next: Next) {
  const id = crypto.randomUUID();
  c.set('requestId', id);
  c.header('X-Request-ID', id);
  await next();
}

// ============================================================================
// API Key Authentication
// ============================================================================

export async function authenticate(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const apiKeyHeader = c.req.header('X-Api-Key');
  
  let key: string | undefined;
  
  if (authHeader?.startsWith('Bearer ')) {
    key = authHeader.slice(7);
  } else if (apiKeyHeader) {
    key = apiKeyHeader;
  }
  
  if (!key) {
    throw new HTTPException(401, { 
      message: 'Missing API key. Provide X-Api-Key header or Authorization: Bearer <key>' 
    });
  }
  
  // Hash the key
  const keyHash = createHash('sha256').update(key).digest('hex');
  const keyPrefix = key.slice(0, 12);
  
  const redis = getRedis();
  const db = getDb();
  
  // Check Redis cache first
  const cachedKey = await redis.get(RedisKeys.apiKey(keyHash));
  
  let apiKey: typeof apiKeys.$inferSelect | null = null;
  
  if (cachedKey) {
    apiKey = JSON.parse(cachedKey);
  } else {
    // Query database
    const results = await db
      .select()
      .from(apiKeys)
      .where(and(
        eq(apiKeys.keyHash, keyHash),
        eq(apiKeys.status, 'active')
      ))
      .limit(1);
    
    if (results.length > 0) {
      apiKey = results[0]!;
      
      // Cache for future requests
      await redis.setex(
        RedisKeys.apiKey(keyHash),
        RedisTTL.apiKeyCache,
        JSON.stringify(apiKey)
      );
    }
  }
  
  if (!apiKey) {
    throw new HTTPException(401, { message: 'Invalid API key' });
  }
  
  // Check expiration
  if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
    throw new HTTPException(401, { message: 'API key has expired' });
  }
  
  // Get client
  const cachedClient = await redis.get(RedisKeys.client(apiKey.clientId));
  let client: typeof clients.$inferSelect | null = null;
  
  if (cachedClient) {
    client = JSON.parse(cachedClient);
  } else {
    const results = await db
      .select()
      .from(clients)
      .where(eq(clients.id, apiKey.clientId))
      .limit(1);
    
    if (results.length > 0) {
      client = results[0]!;
      await redis.setex(
        RedisKeys.client(client.id),
        RedisTTL.clientCache,
        JSON.stringify(client)
      );
    }
  }
  
  if (!client) {
    throw new HTTPException(401, { message: 'Client not found' });
  }
  
  if (client.status !== 'active') {
    throw new HTTPException(403, { message: 'Client account is not active' });
  }
  
  // Update last used
  await db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, apiKey.id));
  
  c.set('client', client);
  c.set('apiKey', apiKey);
  
  await next();
}

// ============================================================================
// Scope Authorization
// ============================================================================

export function requireScope(...requiredScopes: string[]) {
  return async (c: Context, next: Next) => {
    const apiKey = c.get('apiKey');
    
    if (!apiKey) {
      throw new HTTPException(401, { message: 'Not authenticated' });
    }
    
    const hasScope = apiKey.scopes.some(scope => 
      scope === 'admin' || requiredScopes.includes(scope)
    );
    
    if (!hasScope) {
      throw new HTTPException(403, { 
        message: `Missing required scope. Required: ${requiredScopes.join(' or ')}` 
      });
    }
    
    await next();
  };
}

// ============================================================================
// Rate Limiting
// ============================================================================

export async function rateLimit(c: Context, next: Next) {
  const client = c.get('client');
  if (!client) {
    await next();
    return;
  }
  
  const config = getConfig();
  const redis = getRedis();
  
  const key = RedisKeys.rateLimit(client.id, 'api');
  const current = await redis.incr(key);
  
  if (current === 1) {
    await redis.expire(key, Math.floor(config.rateLimitWindowMs / 1000));
  }
  
  if (current > config.rateLimitMaxRequests) {
    const ttl = await redis.ttl(key);
    c.header('X-RateLimit-Limit', String(config.rateLimitMaxRequests));
    c.header('X-RateLimit-Remaining', '0');
    c.header('X-RateLimit-Reset', String(ttl));
    
    throw new HTTPException(429, { 
      message: `Rate limit exceeded. Try again in ${ttl} seconds.` 
    });
  }
  
  c.header('X-RateLimit-Limit', String(config.rateLimitMaxRequests));
  c.header('X-RateLimit-Remaining', String(config.rateLimitMaxRequests - current));
  
  await next();
}

// ============================================================================
// Request Logging
// ============================================================================

export async function requestLogger(c: Context, next: Next) {
  const start = Date.now();
  const requestId = c.get('requestId');
  
  log.api.info({
    requestId,
    method: c.req.method,
    path: c.req.path,
    ip: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip'),
  }, 'Request started');
  
  await next();
  
  const duration = Date.now() - start;
  
  log.api.info({
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration,
  }, 'Request completed');
}

// ============================================================================
// Error Handler
// ============================================================================

export function errorHandler(err: Error, c: Context): Response {
  const requestId = c.get('requestId');
  
  if (err instanceof HTTPException) {
    return c.json({
      success: false,
      error: {
        code: `HTTP_${err.status}`,
        message: err.message,
      },
      meta: {
        timestamp: new Date(),
        requestId,
      },
    }, err.status);
  }
  
  // Validation errors
  if (err instanceof z.ZodError) {
    return c.json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: err.errors,
      },
      meta: {
        timestamp: new Date(),
        requestId,
      },
    }, 400);
  }
  
  // Unknown error
  log.api.error({ err, requestId }, 'Unhandled error');
  
  return c.json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
    meta: {
      timestamp: new Date(),
      requestId,
    },
  }, 500);
}

// ============================================================================
// Not Found Handler
// ============================================================================

export function notFoundHandler(c: Context): Response {
  return c.json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
    meta: {
      timestamp: new Date(),
      requestId: c.get('requestId'),
    },
  }, 404);
}
