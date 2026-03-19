/**
 * BlazeConnector v3 - Entry Point
 * 
 * Production-ready ISP messaging and billing platform
 * Built with Bun + Hono + TypeScript
 */

import { serve } from 'bun';
import app from './api';
import { getConfig, isDev } from './core/config';
import { log } from './core/logger';
import { closeRedis, getRedis } from './queue/redis';
import { closeDb, getDb } from './db';
import { startMessageWorker, stopMessageWorker } from './workers';
import { WebSocketServer } from './ws/index.js';

// ============================================================================
// Startup
// ============================================================================

async function main() {
  const config = getConfig();
  
  log.system.info({
    version: '3.0.0',
    environment: config.nodeEnv,
    port: config.port,
  }, 'BlazeConnector v3 starting...');
  
  // Initialize connections
  log.system.info('Initializing database connection...');
  getDb();
  
  log.system.info('Initializing Redis connection...');
  getRedis();
  
  // Start message worker if enabled
  if (config.workerEnabled) {
    log.system.info('Starting message worker...');
    await startMessageWorker();
  }
  
  // Start WebSocket server
  const wsServer = new WebSocketServer();
  
  // Start HTTP server with Bun
  const server = serve({
    port: config.port,
    fetch(request, server) {
      // Handle WebSocket upgrade
      const url = new URL(request.url);
      
      if (url.pathname === '/ws') {
        const upgraded = server.upgrade(request, {
          data: { connectedAt: new Date() },
        });
        
        if (upgraded) {
          return undefined; // WebSocket handled
        }
        
        return new Response('WebSocket upgrade failed', { status: 500 });
      }
      
      // Handle HTTP requests with Hono
      return app.fetch(request, { server });
    },
    websocket: wsServer.getHandler(),
  });
  
  log.system.info(`🚀 Server running on http://localhost:${config.port}`);
  
  if (isDev()) {
    log.system.info(`📚 API Docs: http://localhost:${config.port}/api/v3/docs`);
    log.system.info(`❤️  Health: http://localhost:${config.port}/health`);
  }
  
  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.system.info(`Received ${signal}, shutting down gracefully...`);
    
    // Stop accepting new connections
    server.stop(true);
    
    // Stop message worker
    await stopMessageWorker();
    
    // Close WebSocket connections
    wsServer.close();
    
    // Close database
    await closeDb();
    
    // Close Redis
    await closeRedis();
    
    log.system.info('Shutdown complete');
    process.exit(0);
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  return server;
}

// Run
main().catch((err) => {
  log.system.fatal(err, 'Failed to start server');
  process.exit(1);
});

export { app };
