/**
 * Client Routes - BlazeConnector v3
 * Client management endpoints
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { authenticate, requireScope, rateLimit } from '../middleware';
import { getDb } from '../../db';
import { clients, clientIntegrations, apiKeys } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { log } from '../../core/logger';
import { getRedis, RedisKeys, RedisTTL } from '../../queue/redis';
import { nanoid } from 'nanoid';
import { createHash, randomBytes } from 'crypto';

const app = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateClientSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  country: z.string().length(3).default('DO'),
  timezone: z.string().default('America/Santo_Domingo'),
  plan: z.enum(['basic', 'pro', 'enterprise']).default('basic'),
});

const UpdateClientSchema = CreateClientSchema.partial();

const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).min(1),
  expiresIn: z.number().int().positive().optional(), // seconds
});

const CreateIntegrationSchema = z.object({
  type: z.enum(['mikrowisp', 'wisphub', 'oficable', 'smartolt', 'oltcloud', 'wacloud', 'telegram', 'chatwoot', 'cardnet', 'azul', 'paypal']),
  enabled: z.boolean().default(true),
  config: z.record(z.unknown()),
  metadata: z.record(z.unknown()).optional(),
});

// ============================================================================
// Routes
// ============================================================================

// List clients (admin only)
app.get(
  '/',
  authenticate,
  requireScope('admin'),
  async (c) => {
    const db = getDb();
    
    const results = await db
      .select()
      .from(clients)
      .orderBy(clients.createdAt);
    
    return c.json({
      success: true,
      data: results,
    });
  }
);

// Get current client info
app.get(
  '/me',
  authenticate,
  async (c) => {
    const client = c.get('client');
    
    return c.json({
      success: true,
      data: client,
    });
  }
);

// Get client by ID
app.get(
  '/:id',
  authenticate,
  requireScope('admin'),
  async (c) => {
    const clientId = c.req.param('id');
    const db = getDb();
    
    const result = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    
    if (result.length === 0) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Client not found' },
      }, 404);
    }
    
    return c.json({
      success: true,
      data: result[0],
    });
  }
);

// Create client
app.post(
  '/',
  authenticate,
  requireScope('admin'),
  zValidator('json', CreateClientSchema),
  async (c) => {
    const body = c.req.valid('json');
    const db = getDb();
    
    // Check if slug exists
    const existing = await db
      .select()
      .from(clients)
      .where(eq(clients.slug, body.slug))
      .limit(1);
    
    if (existing.length > 0) {
      return c.json({
        success: false,
        error: { code: 'SLUG_EXISTS', message: 'Client slug already exists' },
      }, 400);
    }
    
    const result = await db
      .insert(clients)
      .values({
        name: body.name,
        slug: body.slug,
        country: body.country,
        timezone: body.timezone,
        plan: body.plan,
        status: 'active',
      })
      .returning();
    
    log.api.info({ clientId: result[0]!.id, slug: body.slug }, 'Client created');
    
    return c.json({
      success: true,
      data: result[0],
    }, 201);
  }
);

// Update client
app.patch(
  '/:id',
  authenticate,
  requireScope('admin'),
  zValidator('json', UpdateClientSchema),
  async (c) => {
    const clientId = c.req.param('id');
    const body = c.req.valid('json');
    const db = getDb();
    const redis = getRedis();
    
    const result = await db
      .update(clients)
      .set({
        ...body,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, clientId))
      .returning();
    
    if (result.length === 0) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Client not found' },
      }, 404);
    }
    
    // Invalidate cache
    await redis.del(RedisKeys.client(clientId));
    
    return c.json({
      success: true,
      data: result[0],
    });
  }
);

// Get client integrations
app.get(
  '/:id/integrations',
  authenticate,
  async (c) => {
    const client = c.get('client');
    const targetId = c.req.param('id');
    
    // Only allow admin or own client
    const apiKey = c.get('apiKey');
    if (targetId !== client.id && !apiKey.scopes.includes('admin')) {
      return c.json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      }, 403);
    }
    
    const db = getDb();
    
    const results = await db
      .select()
      .from(clientIntegrations)
      .where(eq(clientIntegrations.clientId, targetId));
    
    return c.json({
      success: true,
      data: results,
    });
  }
);

// Create/update integration
app.put(
  '/:id/integrations/:type',
  authenticate,
  requireScope('admin'),
  zValidator('json', CreateIntegrationSchema),
  async (c) => {
    const clientId = c.req.param('id');
    const integrationType = c.req.param('type') as typeof CreateIntegrationSchema._type.type;
    const body = c.req.valid('json');
    const db = getDb();
    const redis = getRedis();
    
    // Upsert integration
    const existing = await db
      .select()
      .from(clientIntegrations)
      .where(and(
        eq(clientIntegrations.clientId, clientId),
        eq(clientIntegrations.type, integrationType)
      ))
      .limit(1);
    
    let result;
    
    if (existing.length > 0) {
      result = await db
        .update(clientIntegrations)
        .set({
          enabled: body.enabled,
          config: body.config,
          metadata: body.metadata,
          updatedAt: new Date(),
        })
        .where(eq(clientIntegrations.id, existing[0]!.id))
        .returning();
    } else {
      result = await db
        .insert(clientIntegrations)
        .values({
          clientId,
          type: integrationType,
          enabled: body.enabled,
          config: body.config,
          metadata: body.metadata,
        })
        .returning();
    }
    
    // Invalidate cache
    await redis.del(RedisKeys.clientIntegrations(clientId));
    
    return c.json({
      success: true,
      data: result[0],
    });
  }
);

// List API keys for client
app.get(
  '/:id/api-keys',
  authenticate,
  async (c) => {
    const client = c.get('client');
    const targetId = c.req.param('id');
    
    const apiKey = c.get('apiKey');
    if (targetId !== client.id && !apiKey.scopes.includes('admin')) {
      return c.json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      }, 403);
    }
    
    const db = getDb();
    
    const results = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        status: apiKeys.status,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.clientId, targetId));
    
    return c.json({
      success: true,
      data: results,
    });
  }
);

// Create API key
app.post(
  '/:id/api-keys',
  authenticate,
  requireScope('admin'),
  zValidator('json', CreateApiKeySchema),
  async (c) => {
    const clientId = c.req.param('id');
    const body = c.req.valid('json');
    const db = getDb();
    
    // Generate API key
    const keyBytes = randomBytes(24);
    const keyValue = `bk_live_${keyBytes.toString('base64url')}`;
    const keyHash = createHash('sha256').update(keyValue).digest('hex');
    const keyPrefix = keyValue.slice(0, 12);
    
    const expiresAt = body.expiresIn 
      ? new Date(Date.now() + body.expiresIn * 1000) 
      : null;
    
    const result = await db
      .insert(apiKeys)
      .values({
        clientId,
        name: body.name,
        keyHash,
        keyPrefix,
        scopes: body.scopes,
        expiresAt,
      })
      .returning();
    
    log.api.info({ clientId, keyId: result[0]!.id, name: body.name }, 'API key created');
    
    // Return the key ONCE (never again)
    return c.json({
      success: true,
      data: {
        id: result[0]!.id,
        name: result[0]!.name,
        key: keyValue, // Only shown once!
        keyPrefix: result[0]!.keyPrefix,
        scopes: result[0]!.scopes,
        expiresAt: result[0]!.expiresAt,
      },
      message: 'Save this API key securely. It will not be shown again.',
    }, 201);
  }
);

// Revoke API key
app.delete(
  '/:id/api-keys/:keyId',
  authenticate,
  requireScope('admin'),
  async (c) => {
    const clientId = c.req.param('id');
    const keyId = c.req.param('keyId');
    const db = getDb();
    
    const result = await db
      .update(apiKeys)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(and(
        eq(apiKeys.id, keyId),
        eq(apiKeys.clientId, clientId)
      ))
      .returning();
    
    if (result.length === 0) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'API key not found' },
      }, 404);
    }
    
    // Invalidate cache
    const redis = getRedis();
    await redis.del(RedisKeys.apiKeyByPrefix(result[0]!.keyPrefix));
    
    return c.json({
      success: true,
      data: { id: keyId, status: 'revoked' },
    });
  }
);

export default app;
