/**
 * Message Routes - BlazeConnector v3
 * API endpoints for message operations
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { authenticate, requireScope, rateLimit } from '../middleware';
import { getMessageQueue } from '../../queue';
import { getDb } from '../../db';
import { messages } from '../../db/schema';
import { eq, and, desc, gte } from 'drizzle-orm';
import { log } from '../../core/logger';
import { CreateMessageSchema, MessageStatusSchema, MessagePrioritySchema } from '../../types';

const app = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const SendMessageSchema = z.object({
  phoneNumber: z.string().min(10).max(15),
  templateKey: z.string().min(1).max(100),
  templateParams: z.array(z.string()).max(10).default([]),
  customerName: z.string().max(255).optional(),
  language: z.string().length(2).default('es'),
  priority: MessagePrioritySchema.default('normal'),
  idempotencyKey: z.string().max(100).optional(),
  delay: z.number().int().nonnegative().max(86400000).optional(), // Max 24h delay
  metadata: z.record(z.unknown()).optional(),
});

const GetMessagesSchema = z.object({
  status: MessageStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const BatchSendMessageSchema = z.object({
  messages: z.array(SendMessageSchema).min(1).max(100),
  idempotencyPrefix: z.string().max(50).optional(),
});

// ============================================================================
// Routes
// ============================================================================

// Send a single message
app.post(
  '/',
  authenticate,
  requireScope('messages:send'),
  rateLimit,
  zValidator('json', SendMessageSchema),
  async (c) => {
    const client = c.get('client');
    const body = c.req.valid('json');
    
    const queue = getMessageQueue();
    
    const { messageId, jobId } = await queue.enqueue(
      {
        clientId: client.id,
        source: 'api',
        phoneNumber: body.phoneNumber,
        customerName: body.customerName,
        templateKey: body.templateKey,
        templateParams: body.templateParams,
        language: body.language,
        priority: body.priority,
        metadata: body.metadata,
      },
      {
        priority: body.priority,
        idempotencyKey: body.idempotencyKey,
        delay: body.delay,
      }
    );
    
    log.api.info({
      clientId: client.id,
      messageId,
      phoneNumber: body.phoneNumber,
      templateKey: body.templateKey,
    }, 'Message queued');
    
    return c.json({
      success: true,
      data: {
        messageId,
        jobId,
        status: 'queued',
        message: 'Message queued for processing',
      },
      meta: {
        timestamp: new Date(),
        requestId: c.get('requestId'),
      },
    }, 202);
  }
);

// Send batch messages
app.post(
  '/batch',
  authenticate,
  requireScope('messages:send'),
  rateLimit,
  zValidator('json', BatchSendMessageSchema),
  async (c) => {
    const client = c.get('client');
    const body = c.req.valid('json');
    
    const queue = getMessageQueue();
    const results: Array<{ index: number; messageId: string; jobId: string; status: string }> = [];
    
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i]!;
      
      const idempotencyKey = body.idempotencyPrefix 
        ? `${body.idempotencyPrefix}-${i}` 
        : undefined;
      
      const { messageId, jobId } = await queue.enqueue(
        {
          clientId: client.id,
          source: 'api',
          phoneNumber: msg.phoneNumber,
          customerName: msg.customerName,
          templateKey: msg.templateKey,
          templateParams: msg.templateParams,
          language: msg.language,
          priority: msg.priority,
          metadata: msg.metadata,
        },
        {
          priority: msg.priority,
          idempotencyKey,
          delay: msg.delay,
        }
      );
      
      results.push({ index: i, messageId, jobId, status: 'queued' });
    }
    
    log.api.info({
      clientId: client.id,
      count: body.messages.length,
    }, 'Batch messages queued');
    
    return c.json({
      success: true,
      data: {
        total: body.messages.length,
        results,
      },
      meta: {
        timestamp: new Date(),
        requestId: c.get('requestId'),
      },
    }, 202);
  }
);

// Get message status
app.get(
  '/:id',
  authenticate,
  requireScope('messages:read'),
  async (c) => {
    const client = c.get('client');
    const messageId = c.req.param('id');
    
    const queue = getMessageQueue();
    const message = await queue.getStatus(messageId);
    
    if (!message) {
      return c.json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Message not found',
        },
      }, 404);
    }
    
    // Verify ownership
    if (message.clientId !== client.id) {
      return c.json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
        },
      }, 403);
    }
    
    return c.json({
      success: true,
      data: message,
      meta: {
        timestamp: new Date(),
        requestId: c.get('requestId'),
      },
    });
  }
);

// List messages
app.get(
  '/',
  authenticate,
  requireScope('messages:read'),
  zValidator('query', GetMessagesSchema),
  async (c) => {
    const client = c.get('client');
    const query = c.req.valid('query');
    
    const db = getDb();
    
    const conditions = [eq(messages.clientId, client.id)];
    
    if (query.status) {
      conditions.push(eq(messages.status, query.status));
    }
    
    const results = await db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(query.limit)
      .offset(query.offset);
    
    return c.json({
      success: true,
      data: results,
      meta: {
        timestamp: new Date(),
        requestId: c.get('requestId'),
        pagination: {
          limit: query.limit,
          offset: query.offset,
        },
      },
    });
  }
);

// Cancel a pending message
app.post(
  '/:id/cancel',
  authenticate,
  requireScope('messages:send'),
  async (c) => {
    const client = c.get('client');
    const messageId = c.req.param('id');
    
    const queue = getMessageQueue();
    const message = await queue.getStatus(messageId);
    
    if (!message) {
      return c.json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Message not found',
        },
      }, 404);
    }
    
    if (message.clientId !== client.id) {
      return c.json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
        },
      }, 403);
    }
    
    const cancelled = await queue.cancel(messageId);
    
    if (!cancelled) {
      return c.json({
        success: false,
        error: {
          code: 'CANNOT_CANCEL',
          message: 'Message cannot be cancelled (may be processing)',
        },
      }, 400);
    }
    
    return c.json({
      success: true,
      data: {
        messageId,
        status: 'cancelled',
      },
      meta: {
        timestamp: new Date(),
        requestId: c.get('requestId'),
      },
    });
  }
);

// Get queue statistics
app.get(
  '/queue/stats',
  authenticate,
  requireScope('messages:read'),
  async (c) => {
    const queue = getMessageQueue();
    const stats = await queue.getStats();
    
    return c.json({
      success: true,
      data: stats,
      meta: {
        timestamp: new Date(),
        requestId: c.get('requestId'),
      },
    });
  }
);

export default app;
