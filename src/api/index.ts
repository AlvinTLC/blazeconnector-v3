/**
 * API Router - BlazeConnector v3
 * Main API routing
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestId, requestLogger, errorHandler, notFoundHandler } from './middleware.js';
import healthRoutes from './routes/health.js';
import messageRoutes from './routes/messages.js';
import clientRoutes from './routes/clients.js';
import { getConfig } from '../core/config.js';

const app = new Hono();

// ============================================================================
// Global Middleware
// ============================================================================

const config = getConfig();

app.use('*', cors({
  origin: config.corsOrigin,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
  exposeHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  maxAge: 86400,
}));

app.use('*', requestId);
app.use('*', requestLogger);

// ============================================================================
// Routes
// ============================================================================

// Health checks (no auth required)
app.route('/health', healthRoutes);

// API routes
const api = new Hono();

api.route('/messages', messageRoutes);
api.route('/clients', clientRoutes);

// Mount API under /api/v3
app.route('/api/v3', api);

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'BlazeConnector',
    version: '3.0.0',
    description: 'Production-ready ISP messaging and billing platform',
    health: '/health',
    api: '/api/v3',
  });
});

// ============================================================================
// Error Handling
// ============================================================================

app.notFound(notFoundHandler);
app.onError(errorHandler);

export default app;
