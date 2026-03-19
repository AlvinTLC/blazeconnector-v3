/**
 * BlazeConnector v3 - Entry Point
 * 
 * Production-ready ISP messaging and billing platform
 * Built with Hono + TypeScript (Bun or Node.js)
 */

import { serve } from '@hono/node-server';
import app from './api/index.js';
import { getConfig, isDev } from './core/config.js';
import { log } from './core/logger.js';
import { closeRedis, getRedis } from './queue/redis.js';
import { closeDb, getDb } from './db/index.js';
import { startMessageWorker, stopMessageWorker } from './workers/index.js';

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
  
  // Detect runtime and start server
  const isBun = typeof Bun !== 'undefined';
  
  // Use Hono's Node adapter
  const server = serve({
    fetch: app.fetch,
    port: config.port,
  });
  
  const runtime = isBun ? 'Bun' : 'Node.js';
  log.system.info(`🚀 Server running on ${runtime} at http://localhost:${config.port}`);
  
  if (isDev()) {
    log.system.info(`📚 Health: http://localhost:${config.port}/health`);
  }
  
  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.system.info(`Received ${signal}, shutting down gracefully...`);
    
    server.close();
    
    // Stop message worker
    await stopMessageWorker();
    
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
  log.system.fatal({ err }, 'Failed to start server');
  process.exit(1);
});

export { app };
