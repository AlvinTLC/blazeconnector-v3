/**
 * Health Routes - BlazeConnector v3
 * Health check and system status endpoints
 */

import { Hono } from 'hono';
import { getRedis } from '../../queue/redis';
import { getDb } from '../../db';
import { getConfig } from '../../core/config';

const app = new Hono();

// Basic health check
app.get('/', async (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '3.0.0',
  });
});

// Detailed health check with dependencies
app.get('/detailed', async (c) => {
  const config = getConfig();
  const checks: Record<string, { status: string; latency?: number; error?: string }> = {};
  
  // Check Redis
  try {
    const redis = getRedis();
    const start = Date.now();
    await redis.ping();
    checks.redis = { status: 'ok', latency: Date.now() - start };
  } catch (err) {
    checks.redis = { status: 'error', error: String(err) };
  }
  
  // Check Database
  try {
    const db = getDb();
    const start = Date.now();
    await db.execute('SELECT 1');
    checks.database = { status: 'ok', latency: Date.now() - start };
  } catch (err) {
    checks.database = { status: 'error', error: String(err) };
  }
  
  const allHealthy = Object.values(checks).every(c => c.status === 'ok');
  
  return c.json({
    status: allHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '3.0.0',
    environment: config.nodeEnv,
    checks,
  }, allHealthy ? 200 : 503);
});

// Readiness probe
app.get('/ready', async (c) => {
  try {
    const redis = getRedis();
    const db = getDb();
    
    await Promise.all([
      redis.ping(),
      db.execute('SELECT 1'),
    ]);
    
    return c.json({ status: 'ready' });
  } catch {
    return c.json({ status: 'not ready' }, 503);
  }
});

// Liveness probe
app.get('/live', (c) => {
  return c.json({ status: 'alive' });
});

export default app;
