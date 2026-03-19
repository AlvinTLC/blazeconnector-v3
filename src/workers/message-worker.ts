/**
 * Message Worker - BlazeConnector v3
 * Processes messages from the queue and sends via WhatsApp Cloud API
 * 
 * Features:
 * - Concurrent processing
 * - Exponential backoff retries
 * - Dead letter queue for failed messages
 * - Graceful shutdown
 */

import { getMessageQueue } from '../queue';
import { getDb } from '../db';
import { messages, clientIntegrations } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { log } from '../core/logger';
import { getConfig } from '../core/config';
import { getRedis, RedisKeys } from '../queue/redis';
import type { Message } from '../types';

// ============================================================================
// WhatsApp Cloud Client
// ============================================================================

interface WhatsAppTemplate {
  name: string;
  language: { code: string };
  components?: Array<{
    type: 'header' | 'body' | 'button';
    parameters: Array<{ type: string; text?: string }>;
  }>;
}

interface WhatsAppResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

class WhatsAppCloudClient {
  private baseUrl: string;
  
  constructor() {
    this.baseUrl = getConfig().whatsappCloudUrl;
  }
  
  async sendTemplateMessage(
    phoneNumberId: string,
    token: string,
    to: string,
    template: WhatsAppTemplate
  ): Promise<WhatsAppResponse> {
    const url = `${this.baseUrl}/${phoneNumberId}/messages`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template,
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`WhatsApp API error: ${response.status} - ${error}`);
    }
    
    return response.json();
  }
  
  buildTemplate(templateKey: string, params: string[], language: string = 'es'): WhatsAppTemplate {
    const components: WhatsAppTemplate['components'] = [];
    
    if (params.length > 0) {
      components.push({
        type: 'body',
        parameters: params.map(p => ({ type: 'text', text: p })),
      });
    }
    
    return {
      name: templateKey,
      language: { code: language },
      components: components.length > 0 ? components : undefined,
    };
  }
}

// ============================================================================
// Message Worker
// ============================================================================

export class MessageWorker {
  private queue = getMessageQueue();
  private db = getDb();
  private redis = getRedis();
  private config = getConfig();
  private waClient = new WhatsAppCloudClient();
  
  private workerId: string;
  private running = false;
  private concurrency: number;
  private processedCount = 0;
  private failedCount = 0;
  
  constructor(workerId?: string) {
    this.workerId = workerId ?? `worker-${Date.now()}`;
    this.concurrency = this.config.queueConcurrency;
  }
  
  /**
   * Start the worker
   */
  async start(): Promise<void> {
    if (this.running) {
      log.worker.warn({ workerId: this.workerId }, 'Worker already running');
      return;
    }
    
    this.running = true;
    log.worker.info({ workerId: this.workerId, concurrency: this.concurrency }, 
      'Message worker started');
    
    // Start processing loop
    this.processLoop();
  }
  
  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    log.worker.info({ workerId: this.workerId }, 'Stopping worker...');
    this.running = false;
  }
  
  /**
   * Main processing loop
   */
  private async processLoop(): Promise<void> {
    while (this.running) {
      try {
        // Process up to concurrency messages in parallel
        const tasks = [];
        
        for (let i = 0; i < this.concurrency; i++) {
          tasks.push(this.processOne());
        }
        
        await Promise.all(tasks);
        
        // Small delay before next batch
        await this.sleep(this.config.workerPollIntervalMs);
      } catch (err) {
        log.worker.error({ err, workerId: this.workerId }, 'Error in process loop');
        await this.sleep(1000);
      }
    }
    
    log.worker.info({ workerId: this.workerId }, 'Worker stopped');
  }
  
  /**
   * Process a single message
   */
  private async processOne(): Promise<void> {
    const job = await this.queue.dequeue(this.workerId);
    
    if (!job) {
      return;
    }
    
    const { message, jobId } = job;
    
    try {
      log.worker.debug({ 
        workerId: this.workerId, 
        messageId: message.id,
        attempt: message.attempts 
      }, 'Processing message');
      
      // Get WhatsApp Cloud integration for client
      const integration = await this.getWhatsAppIntegration(message.clientId);
      
      if (!integration) {
        throw new Error('WhatsApp Cloud integration not configured');
      }
      
      const config = integration.config as {
        phoneNumberId: string;
        token: string;
      };
      
      // Build template
      const template = this.waClient.buildTemplate(
        message.templateKey,
        message.templateParams,
        message.language
      );
      
      // Send message
      const result = await this.waClient.sendTemplateMessage(
        config.phoneNumberId,
        config.token,
        message.phoneNumber,
        template
      );
      
      const whatsappMessageId = result.messages[0]?.id;
      
      // Mark as sent
      await this.queue.ack(message.id, { whatsappMessageId });
      
      // Persist to database
      await this.persistMessage(message, 'sent', { whatsappMessageId });
      
      this.processedCount++;
      
      log.worker.info({
        workerId: this.workerId,
        messageId: message.id,
        whatsappMessageId,
        phoneNumber: message.phoneNumber,
      }, 'Message sent successfully');
      
    } catch (err) {
      const error = err as Error;
      
      // Determine if retryable
      const retryable = this.isRetryable(error);
      
      // Mark as failed (will retry or go to DLQ)
      await this.queue.nack(message.id, {
        code: this.getErrorCode(error),
        message: error.message,
      }, retryable);
      
      // Persist to database
      await this.persistMessage(message, 'failed', { 
        error: error.message,
        retryable 
      });
      
      this.failedCount++;
      
      log.worker.error({
        workerId: this.workerId,
        messageId: message.id,
        error: error.message,
        retryable,
      }, 'Message processing failed');
    }
  }
  
  /**
   * Get WhatsApp Cloud integration for a client
   */
  private async getWhatsAppIntegration(clientId: string) {
    // Check cache first
    const cacheKey = `client:${clientId}:wacloud`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Query database
    const results = await this.db
      .select()
      .from(clientIntegrations)
      .where(and(
        eq(clientIntegrations.clientId, clientId),
        eq(clientIntegrations.type, 'wacloud'),
        eq(clientIntegrations.enabled, true)
      ))
      .limit(1);
    
    if (results.length === 0) {
      return null;
    }
    
    const integration = results[0]!;
    
    // Cache for 5 minutes
    await this.redis.setex(cacheKey, 300, JSON.stringify(integration));
    
    return integration;
  }
  
  /**
   * Persist message to database
   */
  private async persistMessage(
    message: Message, 
    status: string,
    extra: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.db
        .insert(messages)
        .values({
          id: message.id,
          clientId: message.clientId,
          correlationId: message.correlationId,
          source: message.source,
          sourceMessageId: message.sourceMessageId,
          phoneNumber: message.phoneNumber,
          customerName: message.customerName,
          templateKey: message.templateKey,
          templateParams: message.templateParams,
          language: message.language,
          status: status as typeof messages.$inferSelect.status,
          priority: message.priority,
          attempts: message.attempts,
          maxAttempts: message.maxAttempts,
          queuedAt: message.queuedAt,
          processingAt: message.processingAt,
          sentAt: status === 'sent' ? new Date() : null,
          failedAt: status === 'failed' ? new Date() : null,
          whatsappMessageId: extra.whatsappMessageId as string,
          errorMessage: extra.error as string,
          metadata: message.metadata,
        })
        .onConflictDoUpdate({
          target: messages.id,
          set: {
            status: status as typeof messages.$inferSelect.status,
            attempts: message.attempts,
            updatedAt: new Date(),
            whatsappMessageId: extra.whatsappMessageId as string ?? undefined,
            errorMessage: extra.error as string ?? undefined,
          },
        });
    } catch (err) {
      log.worker.error({ err, messageId: message.id }, 'Failed to persist message');
    }
  }
  
  /**
   * Check if error is retryable
   */
  private isRetryable(error: Error): boolean {
    const message = error.message.toLowerCase();
    
    // Non-retryable errors
    if (message.includes('invalid') && message.includes('template')) return false;
    if (message.includes('invalid') && message.includes('phone')) return false;
    if (message.includes('not found')) return false;
    
    // Retryable errors (rate limits, timeouts, etc.)
    return true;
  }
  
  /**
   * Extract error code from error
   */
  private getErrorCode(error: Error): string {
    const message = error.message;
    
    if (message.includes('401') || message.includes('unauthorized')) return 'AUTH_ERROR';
    if (message.includes('403')) return 'FORBIDDEN';
    if (message.includes('404')) return 'NOT_FOUND';
    if (message.includes('429')) return 'RATE_LIMITED';
    if (message.includes('500')) return 'SERVER_ERROR';
    if (message.includes('503')) return 'SERVICE_UNAVAILABLE';
    
    return 'UNKNOWN_ERROR';
  }
  
  /**
   * Get worker statistics
   */
  getStats(): { processed: number; failed: number; running: boolean } {
    return {
      processed: this.processedCount,
      failed: this.failedCount,
      running: this.running,
    };
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Singleton Worker
// ============================================================================

let _worker: MessageWorker | null = null;

export function getMessageWorker(): MessageWorker {
  if (!_worker) {
    _worker = new MessageWorker();
  }
  return _worker;
}

export async function startMessageWorker(): Promise<void> {
  const worker = getMessageWorker();
  await worker.start();
}

export async function stopMessageWorker(): Promise<void> {
  if (_worker) {
    await _worker.stop();
  }
}
