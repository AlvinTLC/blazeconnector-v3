/**
 * Integrations Service - BlazeConnector v3
 * Handles communication with external billing systems and messaging providers
 */

import { getDb } from '../db';
import { clientIntegrations } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { getRedis, RedisKeys } from '../queue/redis';
import { log } from '../core/logger';
import { z } from 'zod';

// ============================================================================
// Integration Config Schemas
// ============================================================================

export const MikrowispConfigSchema = z.object({
  apiUrl: z.string().url(),
  apiKey: z.string().min(1),
});

export const WisphubConfigSchema = z.object({
  apiUrl: z.string().url(),
  apiKey: z.string().min(1),
});

export const OficableConfigSchema = z.object({
  apiUrl: z.string().url(),
  apiKey: z.string().min(1),
});

export const WhatsAppCloudConfigSchema = z.object({
  phoneNumberId: z.string().min(1),
  token: z.string().min(1),
  businessAccountId: z.string().optional(),
});

export const TelegramConfigSchema = z.object({
  botToken: z.string().min(1),
  chatId: z.string().optional(),
});

export const ChatwootConfigSchema = z.object({
  apiUrl: z.string().url(),
  token: z.string().min(1),
  inboxId: z.string().optional(),
  accountId: z.string().optional(),
});

export type IntegrationConfig = 
  | z.infer<typeof MikrowispConfigSchema>
  | z.infer<typeof WisphubConfigSchema>
  | z.infer<typeof OficableConfigSchema>
  | z.infer<typeof WhatsAppCloudConfigSchema>
  | z.infer<typeof TelegramConfigSchema>
  | z.infer<typeof ChatwootConfigSchema>;

// ============================================================================
// Integration Service
// ============================================================================

export class IntegrationService {
  private db = getDb();
  private redis = getRedis();
  
  /**
   * Get integration config for a client
   */
  async getIntegration<T extends IntegrationConfig>(
    clientId: string,
    type: string
  ): Promise<T | null> {
    // Check cache
    const cacheKey = `integration:${clientId}:${type}`;
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
        eq(clientIntegrations.type, type as typeof clientIntegrations.$inferSelect.type),
        eq(clientIntegrations.enabled, true)
      ))
      .limit(1);
    
    if (results.length === 0) {
      return null;
    }
    
    const integration = results[0]!;
    
    // Cache for 5 minutes
    await this.redis.setex(cacheKey, 300, JSON.stringify(integration.config));
    
    return integration.config as T;
  }
  
  /**
   * Check if client has an integration enabled
   */
  async hasIntegration(clientId: string, type: string): Promise<boolean> {
    const integration = await this.getIntegration(clientId, type);
    return integration !== null;
  }
  
  /**
   * Get all integrations for a client
   */
  async getClientIntegrations(clientId: string): Promise<Record<string, IntegrationConfig>> {
    const results = await this.db
      .select()
      .from(clientIntegrations)
      .where(eq(clientIntegrations.clientId, clientId));
    
    const integrations: Record<string, IntegrationConfig> = {};
    
    for (const result of results) {
      if (result.enabled) {
        integrations[result.type] = result.config as IntegrationConfig;
      }
    }
    
    return integrations;
  }
  
  /**
   * Clear integration cache
   */
  async clearCache(clientId: string, type?: string): Promise<void> {
    if (type) {
      await this.redis.del(`integration:${clientId}:${type}`);
    } else {
      // Clear all integration cache for client
      const pattern = `integration:${clientId}:*`;
      const keys = await this.redis.keys(pattern);
      
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
  }
}

// Singleton
let _service: IntegrationService | null = null;

export function getIntegrationService(): IntegrationService {
  if (!_service) {
    _service = new IntegrationService();
  }
  return _service;
}

// ============================================================================
// HTTP Client Helper
// ============================================================================

export interface HttpClientOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

export async function httpGet<T>(
  url: string,
  options: HttpClientOptions = {}
): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: options.timeout ? AbortSignal.timeout(options.timeout) : undefined,
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return response.json();
}

export async function httpPost<T>(
  url: string,
  body: unknown,
  options: HttpClientOptions = {}
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: JSON.stringify(body),
    signal: options.timeout ? AbortSignal.timeout(options.timeout) : undefined,
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }
  
  return response.json();
}
