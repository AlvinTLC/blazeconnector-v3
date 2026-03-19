/**
 * Message Queue - BlazeConnector v3
 * 
 * Async, non-blocking message queue with:
 * - Priority-based processing
 * - Exponential backoff retries
 * - Idempotency keys
 * - Delayed message support
 * - Distributed locks
 * - Dead letter queue
 */

import { nanoid } from 'nanoid';
import { getRedis, RedisKeys, RedisTTL } from './redis';
import { log } from '../core/logger';
import { getConfig } from '../core/config';
import type { CreateMessage, Message, MessageStatus, MessagePriority } from '../types';
import { z } from 'zod';

// ============================================================================
// Queue Types
// ============================================================================

interface EnqueueOptions {
  priority?: MessagePriority;
  delay?: number; // milliseconds
  idempotencyKey?: string;
  maxAttempts?: number;
  processAfter?: Date;
}

interface QueueStats {
  pending: number;
  processing: number;
  delayed: number;
  failed: number;
  completed: number;
}

// Priority weights (higher = more urgent)
const PRIORITY_WEIGHTS: Record<MessagePriority, number> = {
  urgent: 100,
  high: 75,
  normal: 50,
  low: 25,
};

// ============================================================================
// Message Queue Class
// ============================================================================

export class MessageQueue {
  private redis = getRedis();
  private config = getConfig();
  
  /**
   * Enqueue a new message
   * Returns the message ID for tracking
   */
  async enqueue(
    message: CreateMessage,
    options: EnqueueOptions = {}
  ): Promise<{ messageId: string; jobId: string }> {
    const messageId = nanoid();
    const jobId = nanoid();
    const now = new Date();
    
    const priority = options.priority ?? 'normal';
    const priorityWeight = PRIORITY_WEIGHTS[priority];
    const processAfter = options.processAfter ?? 
      (options.delay ? new Date(Date.now() + options.delay) : now);
    
    // Check idempotency
    if (options.idempotencyKey) {
      const existingId = await this.redis.get(RedisKeys.idempotency(options.idempotencyKey));
      if (existingId) {
        log.queue.debug({ idempotencyKey: options.idempotencyKey, existingId }, 
          'Message already queued (idempotent)');
        return { messageId: existingId, jobId: existingId };
      }
    }
    
    // Create full message object
    const fullMessage: Message = {
      id: messageId,
      clientId: message.clientId,
      correlationId: message.correlationId,
      source: message.source,
      sourceMessageId: message.sourceMessageId,
      phoneNumber: message.phoneNumber,
      customerName: message.customerName,
      templateKey: message.templateKey,
      templateParams: message.templateParams ?? [],
      language: message.language ?? 'es',
      status: 'queued',
      priority,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? this.config.queueRetryAttempts,
      queuedAt: now,
      processingAt: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
      nextRetryAt: null,
      whatsappMessageId: undefined,
      errorCode: undefined,
      errorMessage: undefined,
      metadata: message.metadata,
      createdAt: now,
      updatedAt: now,
    };
    
    // Create job object
    const job = {
      id: jobId,
      name: 'send-message',
      data: fullMessage,
      priority: priorityWeight,
      delay: options.delay ?? 0,
      attempts: 0,
      maxAttempts: fullMessage.maxAttempts,
      createdAt: now.toISOString(),
      processAfter: processAfter.toISOString(),
      startedAt: null,
      completedAt: null,
      failedAt: null,
      error: null,
    };
    
    // Store message data
    await this.redis.hset(RedisKeys.message(messageId), {
      data: JSON.stringify(fullMessage),
      job: JSON.stringify(job),
    });
    
    // Add to appropriate queue
    if (processAfter > now) {
      // Delayed message
      const score = processAfter.getTime();
      await this.redis.zadd(RedisKeys.messageQueueDelayed, score, messageId);
      log.queue.debug({ messageId, processAfter }, 'Message scheduled for delayed processing');
    } else {
      // Immediate processing
      const score = this.calculateScore(priorityWeight, now);
      await this.redis.zadd(RedisKeys.messageQueue, score, messageId);
    }
    
    // Set idempotency key
    if (options.idempotencyKey) {
      await this.redis.setex(
        RedisKeys.idempotency(options.idempotencyKey),
        RedisTTL.idempotency,
        messageId
      );
    }
    
    log.queue.info({ messageId, jobId, priority, phoneNumber: message.phoneNumber }, 
      'Message enqueued');
    
    return { messageId, jobId };
  }
  
  /**
   * Dequeue the next message for processing
   * Acquires a distributed lock to prevent duplicate processing
   */
  async dequeue(workerId: string): Promise<{ message: Message; jobId: string } | null> {
    // First, move any ready delayed messages to main queue
    await this.promoteDelayedMessages();
    
    // Get highest priority message (lowest score = highest priority)
    const now = Date.now();
    const results = await this.redis.zrangebyscore(
      RedisKeys.messageQueue,
      '-inf',
      now,
      'LIMIT',
      0,
      1
    );
    
    if (results.length === 0) {
      return null;
    }
    
    const messageId = results[0]!;
    
    // Try to acquire lock
    const lockAcquired = await this.redis.set(
      RedisKeys.messageLock(messageId),
      workerId,
      'PX',
      RedisTTL.messageLock * 1000,
      'NX'
    );
    
    if (!lockAcquired) {
      // Another worker got it, try next
      return this.dequeue(workerId);
    }
    
    // Remove from pending queue and add to processing
    await this.redis.zrem(RedisKeys.messageQueue, messageId);
    await this.redis.zadd(RedisKeys.messageQueueProcessing, now, messageId);
    
    // Get message data
    const data = await this.redis.hget(RedisKeys.message(messageId), 'data');
    if (!data) {
      log.queue.error({ messageId }, 'Message data not found');
      await this.cleanupMessage(messageId);
      return null;
    }
    
    const message: Message = JSON.parse(data);
    const jobData = await this.redis.hget(RedisKeys.message(messageId), 'job');
    const job = jobData ? JSON.parse(jobData) : { id: messageId };
    
    // Update message status
    message.status = 'processing';
    message.processingAt = new Date();
    message.attempts += 1;
    message.updatedAt = new Date();
    
    await this.redis.hset(RedisKeys.message(messageId), 'data', JSON.stringify(message));
    
    log.queue.debug({ messageId, workerId, attempt: message.attempts }, 
      'Message dequeued for processing');
    
    return { message, jobId: job.id };
  }
  
  /**
   * Mark a message as successfully processed
   */
  async ack(messageId: string, result: { whatsappMessageId?: string }): Promise<void> {
    const data = await this.redis.hget(RedisKeys.message(messageId), 'data');
    if (!data) return;
    
    const message: Message = JSON.parse(data);
    message.status = 'sent';
    message.sentAt = new Date();
    message.whatsappMessageId = result.whatsappMessageId;
    message.updatedAt = new Date();
    
    // Update and move to completed (we'll use a simple set for completed)
    await this.redis.hset(RedisKeys.message(messageId), 'data', JSON.stringify(message));
    await this.redis.zrem(RedisKeys.messageQueueProcessing, messageId);
    
    // Release lock
    await this.redis.del(RedisKeys.messageLock(messageId));
    
    log.queue.info({ messageId, whatsappMessageId: result.whatsappMessageId }, 
      'Message sent successfully');
  }
  
  /**
   * Mark a message as failed
   * Will be retried if attempts remaining, otherwise goes to dead letter queue
   */
  async nack(
    messageId: string, 
    error: { code?: string; message: string },
    retryable: boolean = true
  ): Promise<void> {
    const data = await this.redis.hget(RedisKeys.message(messageId), 'data');
    if (!data) return;
    
    const message: Message = JSON.parse(data);
    message.errorCode = error.code;
    message.errorMessage = error.message;
    message.updatedAt = new Date();
    
    await this.redis.zrem(RedisKeys.messageQueueProcessing, messageId);
    
    // Check if we should retry
    const shouldRetry = retryable && message.attempts < message.maxAttempts;
    
    if (shouldRetry) {
      // Calculate next retry with exponential backoff
      const baseDelay = this.config.queueRetryBaseDelay;
      const delay = baseDelay * Math.pow(2, message.attempts - 1);
      const nextRetryAt = new Date(Date.now() + delay);
      
      message.status = 'queued';
      message.nextRetryAt = nextRetryAt;
      
      // Add to delayed queue for retry
      await this.redis.zadd(
        RedisKeys.messageQueueDelayed,
        nextRetryAt.getTime(),
        messageId
      );
      
      log.queue.warn(
        { messageId, attempt: message.attempts, maxAttempts: message.maxAttempts, nextRetryAt },
        'Message failed, scheduled for retry'
      );
    } else {
      // No more retries, move to failed queue
      message.status = 'failed';
      message.failedAt = new Date();
      
      await this.redis.zadd(RedisKeys.messageQueueFailed, Date.now(), messageId);
      
      log.queue.error(
        { messageId, error, attempts: message.attempts },
        'Message failed permanently'
      );
    }
    
    await this.redis.hset(RedisKeys.message(messageId), 'data', JSON.stringify(message));
    await this.redis.del(RedisKeys.messageLock(messageId));
  }
  
  /**
   * Get message status by ID
   */
  async getStatus(messageId: string): Promise<Message | null> {
    const data = await this.redis.hget(RedisKeys.message(messageId), 'data');
    if (!data) return null;
    return JSON.parse(data);
  }
  
  /**
   * Get queue statistics
   */
  async getStats(): Promise<QueueStats> {
    const [pending, processing, delayed, failed] = await Promise.all([
      this.redis.zcard(RedisKeys.messageQueue),
      this.redis.zcard(RedisKeys.messageQueueProcessing),
      this.redis.zcard(RedisKeys.messageQueueDelayed),
      this.redis.zcard(RedisKeys.messageQueueFailed),
    ]);
    
    return { pending, processing, delayed, failed, completed: 0 };
  }
  
  /**
   * Promote delayed messages that are ready to be processed
   */
  private async promoteDelayedMessages(): Promise<void> {
    const now = Date.now();
    
    // Get all delayed messages that are ready
    const ready = await this.redis.zrangebyscore(
      RedisKeys.messageQueueDelayed,
      '-inf',
      now
    );
    
    if (ready.length === 0) return;
    
    for (const messageId of ready) {
      // Get message to check priority
      const data = await this.redis.hget(RedisKeys.message(messageId), 'data');
      if (!data) continue;
      
      const message: Message = JSON.parse(data);
      const priorityWeight = PRIORITY_WEIGHTS[message.priority];
      const score = this.calculateScore(priorityWeight, new Date());
      
      // Move to main queue
      await this.redis.zrem(RedisKeys.messageQueueDelayed, messageId);
      await this.redis.zadd(RedisKeys.messageQueue, score, messageId);
    }
    
    log.queue.debug({ count: ready.length }, 'Delayed messages promoted');
  }
  
  /**
   * Calculate queue score (lower = higher priority)
   */
  private calculateScore(priority: number, timestamp: Date): number {
    // Score = (max_priority - priority) * timestamp_divisor + timestamp
    // This ensures priority ordering, then FIFO within same priority
    const maxPriority = 100;
    const timestampDivisor = 1e12; // Normalize timestamp
    return (maxPriority - priority) * timestampDivisor + timestamp.getTime();
  }
  
  /**
   * Clean up message data
   */
  private async cleanupMessage(messageId: string): Promise<void> {
    await Promise.all([
      this.redis.del(RedisKeys.message(messageId)),
      this.redis.del(RedisKeys.messageLock(messageId)),
      this.redis.zrem(RedisKeys.messageQueue, messageId),
      this.redis.zrem(RedisKeys.messageQueueProcessing, messageId),
      this.redis.zrem(RedisKeys.messageQueueDelayed, messageId),
    ]);
  }
  
  /**
   * Cancel a pending message
   */
  async cancel(messageId: string): Promise<boolean> {
    const message = await this.getStatus(messageId);
    if (!message) return false;
    
    if (message.status === 'processing') {
      log.queue.warn({ messageId }, 'Cannot cancel message that is being processed');
      return false;
    }
    
    message.status = 'cancelled';
    message.updatedAt = new Date();
    await this.redis.hset(RedisKeys.message(messageId), 'data', JSON.stringify(message));
    await this.cleanupMessage(messageId);
    
    log.queue.info({ messageId }, 'Message cancelled');
    return true;
  }
}

// Singleton instance
let _queue: MessageQueue | null = null;

export function getMessageQueue(): MessageQueue {
  if (!_queue) {
    _queue = new MessageQueue();
  }
  return _queue;
}
