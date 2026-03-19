/**
 * Message Worker - BlazeConnector v3
 * Processes messages from Redis queue
 */

import { getMessageQueue } from '../queue/index.js';
import { log } from '../core/logger.js';
import { getConfig } from '../core/config.js';
import type { Message } from '../types/index.js';

export class MessageWorker {
  private queue = getMessageQueue();
  private config = getConfig();
  private running = false;
  private workerId: string;
  
  constructor(workerId?: string) {
    this.workerId = workerId ?? `worker-${Date.now()}`;
  }
  
  async start(): Promise<void> {
    if (this.running) return;
    
    this.running = true;
    log.worker.info({ workerId: this.workerId }, 'Message worker started');
    
    // Process messages in loop
    this.processLoop().catch(err => {
      log.worker.error({ err, workerId: this.workerId }, 'Worker error');
    });
  }
  
  async stop(): Promise<void> {
    this.running = false;
    log.worker.info({ workerId: this.workerId }, 'Message worker stopped');
  }
  
  private async processLoop(): Promise<void> {
    while (this.running) {
      try {
        const job = await this.queue.dequeue(this.workerId);
        
        if (job) {
          await this.processMessage(job.message);
        } else {
          // No messages, wait before polling again
          await this.sleep(this.config.workerPollIntervalMs);
        }
      } catch (err) {
        log.worker.error({ err, workerId: this.workerId }, 'Process loop error');
        await this.sleep(1000);
      }
    }
  }
  
  private async processMessage(message: Message): Promise<void> {
    try {
      log.worker.debug({ 
        workerId: this.workerId, 
        messageId: message.id,
        phone: message.phoneNumber 
      }, 'Processing message');
      
      // TODO: Integrate with WhatsApp Cloud API
      // For now, just mark as sent
      await this.queue.ack(message.id, { whatsappMessageId: `mock-${Date.now()}` });
      
      log.worker.info({ 
        workerId: this.workerId, 
        messageId: message.id 
      }, 'Message processed successfully');
      
    } catch (err) {
      const error = err as Error;
      
      await this.queue.nack(message.id, {
        code: 'PROCESSING_ERROR',
        message: error.message,
      }, true);
      
      log.worker.error({ 
        err, 
        workerId: this.workerId, 
        messageId: message.id 
      }, 'Message processing failed');
    }
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

let _worker: MessageWorker | null = null;

export function getMessageWorker(): MessageWorker {
  if (!_worker) {
    _worker = new MessageWorker();
  }
  return _worker;
}

export async function startMessageWorkerInstance(): Promise<void> {
  const worker = getMessageWorker();
  await worker.start();
}

export async function stopMessageWorkerInstance(): Promise<void> {
  if (_worker) {
    await _worker.stop();
  }
}
