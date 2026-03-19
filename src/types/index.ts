/**
 * Core Types - BlazeConnector v3
 * All domain types with strict TypeScript + Zod validation
 */

import { z } from 'zod';

// ============================================================================
// Client Types
// ============================================================================

export const ClientStatusSchema = z.enum(['active', 'inactive', 'suspended', 'trial']);
export type ClientStatus = z.infer<typeof ClientStatusSchema>;

export const ClientSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  status: ClientStatusSchema,
  country: z.string().length(3).default('DO'),
  timezone: z.string().default('America/Santo_Domingo'),
  plan: z.enum(['basic', 'pro', 'enterprise']).default('basic'),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type Client = z.infer<typeof ClientSchema>;

// ============================================================================
// API Key Types
// ============================================================================

export const ApiKeyStatusSchema = z.enum(['active', 'revoked']);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;

export const ApiKeyScopeSchema = z.enum([
  'admin',
  'billing:read',
  'billing:write',
  'messages:read',
  'messages:send',
  'onu:read',
  'onu:manage',
  'payments:read',
  'payments:write',
  'logs:read',
  'internal',
]);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

export const ApiKeySchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  name: z.string().min(1).max(100),
  keyHash: z.string().length(64),
  keyPrefix: z.string().max(12),
  status: ApiKeyStatusSchema,
  scopes: z.array(ApiKeyScopeSchema),
  lastUsedAt: z.coerce.date().nullable(),
  expiresAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type ApiKey = z.infer<typeof ApiKeySchema>;

// ============================================================================
// Message Types
// ============================================================================

export const MessageStatusSchema = z.enum([
  'pending',
  'queued',
  'processing',
  'sent',
  'delivered',
  'read',
  'failed',
  'cancelled',
]);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const MessagePrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export type MessagePriority = z.infer<typeof MessagePrioritySchema>;

export const MessageSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  correlationId: z.string().optional(),
  
  // Source info
  source: z.string().max(50), // oficable, mikrowisp, wisphub, api, etc.
  sourceMessageId: z.string().optional(),
  
  // Destination
  phoneNumber: z.string().min(10).max(15),
  customerName: z.string().optional(),
  
  // Content
  templateKey: z.string().min(1).max(100),
  templateParams: z.array(z.string()).max(10),
  language: z.string().length(2).default('es'),
  
  // Status tracking
  status: MessageStatusSchema,
  priority: MessagePrioritySchema.default('normal'),
  attempts: z.number().int().nonnegative().default(0),
  maxAttempts: z.number().int().positive().default(3),
  
  // Timestamps
  queuedAt: z.coerce.date(),
  processingAt: z.coerce.date().nullable(),
  sentAt: z.coerce.date().nullable(),
  deliveredAt: z.coerce.date().nullable(),
  readAt: z.coerce.date().nullable(),
  failedAt: z.coerce.date().nullable(),
  nextRetryAt: z.coerce.date().nullable(),
  
  // Results
  whatsappMessageId: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  
  // Metadata
  metadata: z.record(z.unknown()).optional(),
  
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type Message = z.infer<typeof MessageSchema>;

export const CreateMessageSchema = MessageSchema.pick({
  clientId: true,
  correlationId: true,
  source: true,
  sourceMessageId: true,
  phoneNumber: true,
  customerName: true,
  templateKey: true,
  templateParams: true,
  language: true,
  priority: true,
  metadata: true,
}).partial({
  correlationId: true,
  sourceMessageId: true,
  customerName: true,
  language: true,
  priority: true,
  metadata: true,
});

export type CreateMessage = z.infer<typeof CreateMessageSchema>;

// ============================================================================
// Queue Types
// ============================================================================

export const QueueJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  data: z.record(z.unknown()),
  priority: z.number().int().default(0),
  delay: z.number().int().nonnegative().default(0),
  attempts: z.number().int().nonnegative().default(0),
  maxAttempts: z.number().int().positive().default(3),
  createdAt: z.coerce.date(),
  processAfter: z.coerce.date(),
  startedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
  failedAt: z.coerce.date().nullable(),
  error: z.string().optional(),
});

export type QueueJob = z.infer<typeof QueueJobSchema>;

export const QueueJobResultSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    data: z.unknown(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
    retryable: z.boolean().default(true),
  }),
]);

export type QueueJobResult = z.infer<typeof QueueJobResultSchema>;

// ============================================================================
// Integration Types
// ============================================================================

export const IntegrationTypeSchema = z.enum([
  'mikrowisp',
  'wisphub',
  'oficable',
  'smartolt',
  'oltcloud',
  'wacloud',
  'telegram',
  'chatwoot',
  'cardnet',
  'azul',
  'paypal',
]);
export type IntegrationType = z.infer<typeof IntegrationTypeSchema>;

export const ClientIntegrationSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  type: IntegrationTypeSchema,
  enabled: z.boolean(),
  config: z.record(z.unknown()),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type ClientIntegration = z.infer<typeof ClientIntegrationSchema>;

// ============================================================================
// Payment Types
// ============================================================================

export const PaymentMethodSchema = z.enum([
  'cardnet',
  'azul',
  'paypal',
  'bank_transfer',
  'cash',
]);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const PaymentStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'refunded',
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const PaymentSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  customerId: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().length(3).default('DOP'),
  method: PaymentMethodSchema,
  gateway: z.string().optional(),
  gatewayTxnId: z.string().optional(),
  status: PaymentStatusSchema,
  description: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
  completedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type Payment = z.infer<typeof PaymentSchema>;

// ============================================================================
// API Response Types
// ============================================================================

export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }).optional(),
    meta: z.object({
      timestamp: z.coerce.date(),
      requestId: z.string().optional(),
    }).optional(),
  });

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    timestamp: Date;
    requestId?: string;
  };
};

// ============================================================================
// WebSocket Types
// ============================================================================

export const WSEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message:status'),
    payload: z.object({
      messageId: z.string().uuid(),
      status: MessageStatusSchema,
      timestamp: z.coerce.date(),
    }),
  }),
  z.object({
    type: z.literal('payment:received'),
    payload: z.object({
      paymentId: z.string().uuid(),
      clientId: z.string().uuid(),
      amount: z.number(),
      method: PaymentMethodSchema,
    }),
  }),
  z.object({
    type: z.literal('client:updated'),
    payload: z.object({
      clientId: z.string().uuid(),
      changes: z.record(z.unknown()),
    }),
  }),
]);

export type WSEvent = z.infer<typeof WSEventSchema>;
