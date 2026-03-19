/**
 * Database Schema - BlazeConnector v3
 * Drizzle ORM schema definitions
 */

import { pgTable, pgEnum, uuid, varchar, boolean, timestamp, jsonb, integer, decimal, text, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================================================
// Enums
// ============================================================================

export const clientStatusEnum = pgEnum('client_status', ['active', 'inactive', 'suspended', 'trial']);
export const apiKeyStatusEnum = pgEnum('api_key_status', ['active', 'revoked']);
export const messageStatusEnum = pgEnum('message_status', ['pending', 'queued', 'processing', 'sent', 'delivered', 'read', 'failed', 'cancelled']);
export const messagePriorityEnum = pgEnum('message_priority', ['low', 'normal', 'high', 'urgent']);
export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded']);
export const paymentMethodEnum = pgEnum('payment_method', ['cardnet', 'azul', 'paypal', 'bank_transfer', 'cash']);
export const integrationTypeEnum = pgEnum('integration_type', [
  'mikrowisp', 'wisphub', 'oficable', 'smartolt', 'oltcloud',
  'wacloud', 'telegram', 'chatwoot', 'cardnet', 'azul', 'paypal'
]);

// ============================================================================
// Clients Table
// ============================================================================

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  status: clientStatusEnum('status').notNull().default('active'),
  country: varchar('country', { length: 3 }).notNull().default('DO'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('America/Santo_Domingo'),
  plan: varchar('plan', { length: 50 }).notNull().default('basic'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  statusIdx: index('clients_status_idx').on(table.status),
  slugIdx: uniqueIndex('clients_slug_idx').on(table.slug),
}));

// ============================================================================
// API Keys Table
// ============================================================================

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
  keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
  status: apiKeyStatusEnum('status').notNull().default('active'),
  scopes: text('scopes').array().notNull().default([]),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdBy: varchar('created_by', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  keyHashIdx: index('api_keys_key_hash_idx').on(table.keyHash),
  clientIdIdx: index('api_keys_client_id_idx').on(table.clientId),
}));

// ============================================================================
// Client Integrations Table
// ============================================================================

export const clientIntegrations = pgTable('client_integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  type: integrationTypeEnum('type').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  config: jsonb('config').notNull().default({}),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  clientTypeIdx: uniqueIndex('client_integrations_client_type_idx').on(table.clientId, table.type),
}));

// ============================================================================
// Messages Table (for persistent storage, queue uses Redis)
// ============================================================================

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  correlationId: varchar('correlation_id', { length: 100 }),
  
  // Source
  source: varchar('source', { length: 50 }).notNull(),
  sourceMessageId: varchar('source_message_id', { length: 100 }),
  
  // Destination
  phoneNumber: varchar('phone_number', { length: 15 }).notNull(),
  customerName: varchar('customer_name', { length: 255 }),
  
  // Content
  templateKey: varchar('template_key', { length: 100 }).notNull(),
  templateParams: text('template_params').array().notNull().default([]),
  language: varchar('language', { length: 2 }).notNull().default('es'),
  
  // Status
  status: messageStatusEnum('status').notNull().default('pending'),
  priority: messagePriorityEnum('priority').notNull().default('normal'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  
  // Timestamps
  queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
  processingAt: timestamp('processing_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  
  // Results
  whatsappMessageId: varchar('whatsapp_message_id', { length: 100 }),
  errorCode: varchar('error_code', { length: 50 }),
  errorMessage: text('error_message'),
  
  // Metadata
  metadata: jsonb('metadata'),
  
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  clientIdIdx: index('messages_client_id_idx').on(table.clientId),
  statusIdx: index('messages_status_idx').on(table.status),
  createdAtIdx: index('messages_created_at_idx').on(table.createdAt),
  sourceIdx: index('messages_source_idx').on(table.source, table.sourceMessageId),
}));

// ============================================================================
// Payments Table
// ============================================================================

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull().references(() => clients.id),
  customerId: varchar('customer_id', { length: 100 }),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('DOP'),
  method: paymentMethodEnum('method').notNull(),
  gateway: varchar('gateway', { length: 30 }),
  gatewayTxnId: varchar('gateway_txn_id', { length: 100 }),
  status: paymentStatusEnum('status').notNull().default('pending'),
  description: varchar('description', { length: 500 }),
  metadata: jsonb('metadata'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  clientIdIdx: index('payments_client_id_idx').on(table.clientId),
  customerIdIdx: index('payments_customer_id_idx').on(table.customerId),
  statusIdx: index('payments_status_idx').on(table.status),
  createdAtIdx: index('payments_created_at_idx').on(table.createdAt),
}));

// ============================================================================
// Bank Transfers Table
// ============================================================================

export const bankTransfers = pgTable('bank_transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull().references(() => clients.id),
  customerId: varchar('customer_id', { length: 100 }),
  customerPhone: varchar('customer_phone', { length: 30 }),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  paymentMethod: varchar('payment_method', { length: 50 }),
  reference: varchar('reference', { length: 100 }),
  bank: varchar('bank', { length: 100 }),
  bankTransactionNumber: varchar('bank_transaction_number', { length: 100 }),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  billingSystem: varchar('billing_system', { length: 30 }),
  billingReference: varchar('billing_reference', { length: 100 }),
  source: varchar('source', { length: 100 }),
  receivedBy: varchar('received_by', { length: 100 }),
  approvedBy: varchar('approved_by', { length: 100 }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  rejectedBy: varchar('rejected_by', { length: 100 }),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  rejectionReason: varchar('rejection_reason', { length: 500 }),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  notes: text('notes'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  clientIdIdx: index('bank_transfers_client_id_idx').on(table.clientId),
  statusIdx: index('bank_transfers_status_idx').on(table.status),
  customerIdIdx: index('bank_transfers_customer_id_idx').on(table.customerId),
}));

// ============================================================================
// Message Logs Table
// ============================================================================

export const messageLogs = pgTable('message_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull().references(() => clients.id),
  apiKeyId: uuid('api_key_id').references(() => apiKeys.id),
  endpoint: varchar('endpoint', { length: 255 }),
  method: varchar('method', { length: 10 }),
  service: varchar('service', { length: 50 }),
  action: varchar('action', { length: 100 }),
  status: varchar('status', { length: 20 }),
  statusCode: integer('status_code'),
  request: jsonb('request'),
  response: jsonb('response'),
  error: jsonb('error'),
  metadata: jsonb('metadata'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  clientIdIdx: index('message_logs_client_id_idx').on(table.clientId),
  serviceIdx: index('message_logs_service_idx').on(table.service),
  createdAtIdx: index('message_logs_created_at_idx').on(table.createdAt),
}));

// ============================================================================
// Relations
// ============================================================================

export const clientsRelations = relations(clients, ({ many, one }) => ({
  apiKeys: many(apiKeys),
  integrations: many(clientIntegrations),
  messages: many(messages),
  payments: many(payments),
  bankTransfers: many(bankTransfers),
  messageLogs: many(messageLogs),
}));

export const apiKeysRelations = relations(apiKeys, ({ one, many }) => ({
  client: one(clients, {
    fields: [apiKeys.clientId],
    references: [clients.id],
  }),
  logs: many(messageLogs),
}));

export const clientIntegrationsRelations = relations(clientIntegrations, ({ one }) => ({
  client: one(clients, {
    fields: [clientIntegrations.clientId],
    references: [clients.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  client: one(clients, {
    fields: [messages.clientId],
    references: [clients.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  client: one(clients, {
    fields: [payments.clientId],
    references: [clients.id],
  }),
}));

export const bankTransfersRelations = relations(bankTransfers, ({ one }) => ({
  client: one(clients, {
    fields: [bankTransfers.clientId],
    references: [clients.id],
  }),
}));

export const messageLogsRelations = relations(messageLogs, ({ one }) => ({
  client: one(clients, {
    fields: [messageLogs.clientId],
    references: [clients.id],
  }),
  apiKey: one(apiKeys, {
    fields: [messageLogs.apiKeyId],
    references: [apiKeys.id],
  }),
}));
