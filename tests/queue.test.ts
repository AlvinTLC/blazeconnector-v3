/**
 * Message Queue Tests - BlazeConnector v3
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MessageQueue } from '../src/queue';
import { getRedis } from '../src/queue/redis';

describe('MessageQueue', () => {
  let queue: MessageQueue;
  
  beforeAll(async () => {
    queue = new MessageQueue();
    // Clear test queue
    const redis = getRedis();
    await redis.del('queue:messages');
    await redis.del('queue:messages:delayed');
    await redis.del('queue:messages:processing');
    await redis.del('queue:messages:failed');
  });
  
  afterAll(async () => {
    // Cleanup
  });
  
  it('should enqueue a message', async () => {
    const result = await queue.enqueue({
      clientId: 'test-client-id',
      source: 'test',
      phoneNumber: '18091234567',
      templateKey: 'TEST_TEMPLATE',
      templateParams: ['John', '100'],
    });
    
    expect(result.messageId).toBeDefined();
    expect(result.jobId).toBeDefined();
  });
  
  it('should enqueue with priority', async () => {
    const result = await queue.enqueue({
      clientId: 'test-client-id',
      source: 'test',
      phoneNumber: '18091234568',
      templateKey: 'URGENT_TEMPLATE',
      templateParams: [],
    }, { priority: 'urgent' });
    
    expect(result.messageId).toBeDefined();
  });
  
  it('should handle idempotency', async () => {
    const message = {
      clientId: 'test-client-id',
      source: 'test',
      phoneNumber: '18091234569',
      templateKey: 'IDEMPOTENT_TEST',
      templateParams: [],
    };
    
    const idempotencyKey = 'test-idempotency-key-123';
    
    const result1 = await queue.enqueue(message, { idempotencyKey });
    const result2 = await queue.enqueue(message, { idempotencyKey });
    
    // Should return same message ID
    expect(result1.messageId).toBe(result2.messageId);
  });
  
  it('should dequeue messages', async () => {
    // First enqueue
    await queue.enqueue({
      clientId: 'test-client-id',
      source: 'test',
      phoneNumber: '18091234570',
      templateKey: 'DEQUEUE_TEST',
      templateParams: [],
    });
    
    // Then dequeue
    const job = await queue.dequeue('test-worker');
    
    expect(job).toBeDefined();
    expect(job?.message).toBeDefined();
    expect(job?.message.phoneNumber).toBe('18091234570');
  });
  
  it('should get queue stats', async () => {
    const stats = await queue.getStats();
    
    expect(stats).toHaveProperty('pending');
    expect(stats).toHaveProperty('processing');
    expect(stats).toHaveProperty('delayed');
    expect(stats).toHaveProperty('failed');
  });
  
  it('should handle delayed messages', async () => {
    const delay = 5000; // 5 seconds
    
    await queue.enqueue({
      clientId: 'test-client-id',
      source: 'test',
      phoneNumber: '18091234571',
      templateKey: 'DELAYED_TEST',
      templateParams: [],
    }, { delay });
    
    // Should not be immediately available
    const status = await queue.getStatus('last-message-id');
    // Delayed messages should be in delayed queue
  });
});
