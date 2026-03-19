/**
 * WebSocket Server - BlazeConnector v3
 * Real-time event broadcasting to clients
 */

import { log } from '../core/logger';
import { getPubSubClient, RedisKeys } from '../queue/redis';

// ============================================================================
// Types
// ============================================================================

interface WSClient {
  ws: WebSocket;
  clientId?: string;
  connectedAt: Date;
  subscriptions: Set<string>;
}

interface WSMessage {
  type: string;
  payload: unknown;
}

// ============================================================================
// WebSocket Server
// ============================================================================

export class WebSocketServer {
  private clients: Map<WebSocket, WSClient> = new Map();
  private redis = getPubSubClient();
  private redisSubscribed = false;
  
  constructor() {
    this.setupRedisSubscriber();
  }
  
  /**
   * Get Bun WebSocket handler
   */
  getHandler(): WebSocketHandler<WSClient> {
    return {
      open: (ws) => {
        const client: WSClient = {
          ws,
          connectedAt: new Date(),
          subscriptions: new Set(),
        };
        
        this.clients.set(ws, client);
        
        log.ws.info({
          totalClients: this.clients.size,
        }, 'WebSocket client connected');
        
        // Send welcome message
        ws.send(JSON.stringify({
          type: 'connected',
          payload: {
            message: 'Connected to BlazeConnector',
            timestamp: new Date(),
          },
        }));
      },
      
      message: (ws, message) => {
        const client = this.clients.get(ws);
        if (!client) return;
        
        try {
          const data = JSON.parse(message.toString()) as WSMessage;
          this.handleMessage(client, data);
        } catch (err) {
          log.ws.warn({ err }, 'Invalid WebSocket message');
          ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Invalid message format' },
          }));
        }
      },
      
      close: (ws) => {
        this.clients.delete(ws);
        log.ws.info({
          totalClients: this.clients.size,
        }, 'WebSocket client disconnected');
      },
      
      error: (ws, err) => {
        log.ws.error({ err }, 'WebSocket error');
        this.clients.delete(ws);
      },
    };
  }
  
  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(client: WSClient, message: WSMessage): void {
    switch (message.type) {
      case 'ping':
        client.ws.send(JSON.stringify({ type: 'pong', payload: { timestamp: new Date() } }));
        break;
        
      case 'subscribe':
        this.handleSubscribe(client, message.payload as { channels?: string[] });
        break;
        
      case 'unsubscribe':
        this.handleUnsubscribe(client, message.payload as { channels?: string[] });
        break;
        
      case 'authenticate':
        this.handleAuthenticate(client, message.payload as { clientId?: string; token?: string });
        break;
        
      default:
        client.ws.send(JSON.stringify({
          type: 'error',
          payload: { message: `Unknown message type: ${message.type}` },
        }));
    }
  }
  
  /**
   * Handle channel subscription
   */
  private handleSubscribe(client: WSClient, payload: { channels?: string[] }): void {
    if (!payload.channels || !Array.isArray(payload.channels)) {
      client.ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Invalid channels' },
      }));
      return;
    }
    
    for (const channel of payload.channels) {
      client.subscriptions.add(channel);
    }
    
    client.ws.send(JSON.stringify({
      type: 'subscribed',
      payload: { channels: payload.channels },
    }));
    
    log.ws.debug({ channels: payload.channels }, 'Client subscribed to channels');
  }
  
  /**
   * Handle channel unsubscription
   */
  private handleUnsubscribe(client: WSClient, payload: { channels?: string[] }): void {
    if (!payload.channels || !Array.isArray(payload.channels)) {
      return;
    }
    
    for (const channel of payload.channels) {
      client.subscriptions.delete(channel);
    }
    
    client.ws.send(JSON.stringify({
      type: 'unsubscribed',
      payload: { channels: payload.channels },
    }));
  }
  
  /**
   * Handle authentication
   */
  private handleAuthenticate(client: WSClient, payload: { clientId?: string; token?: string }): void {
    // TODO: Validate token against API keys
    if (payload.clientId) {
      client.clientId = payload.clientId;
      
      client.ws.send(JSON.stringify({
        type: 'authenticated',
        payload: { clientId: payload.clientId },
      }));
    }
  }
  
  /**
   * Setup Redis subscriber for broadcasting events
   */
  private async setupRedisSubscriber(): Promise<void> {
    if (this.redisSubscribed) return;
    
    await this.redis.subscribe(
      RedisKeys.channelMessages,
      RedisKeys.channelPayments,
      RedisKeys.channelEvents
    );
    
    this.redis.on('message', (channel, message) => {
      this.broadcastFromRedis(channel, message);
    });
    
    this.redisSubscribed = true;
    log.ws.info('Redis subscriber initialized');
  }
  
  /**
   * Broadcast message from Redis to connected WebSocket clients
   */
  private broadcastFromRedis(channel: string, message: string): void {
    let parsed: WSMessage;
    
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    
    // Find clients subscribed to this channel
    for (const [, client] of this.clients) {
      if (client.subscriptions.has(channel)) {
        try {
          client.ws.send(message);
        } catch (err) {
          log.ws.warn({ err }, 'Failed to send to client');
        }
      }
    }
  }
  
  /**
   * Broadcast to all connected clients
   */
  broadcast(message: WSMessage): void {
    const serialized = JSON.stringify(message);
    
    for (const [, client] of this.clients) {
      try {
        client.ws.send(serialized);
      } catch {
        // Client may have disconnected
      }
    }
  }
  
  /**
   * Broadcast to clients of a specific tenant
   */
  broadcastToClient(clientId: string, message: WSMessage): void {
    const serialized = JSON.stringify(message);
    
    for (const [, client] of this.clients) {
      if (client.clientId === clientId) {
        try {
          client.ws.send(serialized);
        } catch {
          // Client may have disconnected
        }
      }
    }
  }
  
  /**
   * Close all connections
   */
  close(): void {
    for (const [ws] of this.clients) {
      ws.close(1001, 'Server shutting down');
    }
    
    this.clients.clear();
    log.ws.info('WebSocket server closed');
  }
  
  /**
   * Get connected clients count
   */
  getClientCount(): number {
    return this.clients.size;
  }
}
