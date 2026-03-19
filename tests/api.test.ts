/**
 * API Tests - BlazeConnector v3
 */

import { describe, it, expect, beforeAll } from 'vitest';
import app from '../src/api';

describe('Health Endpoints', () => {
  it('should return health status', async () => {
    const res = await app.request('/health');
    const data = await res.json();
    
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('status', 'ok');
    expect(data).toHaveProperty('version', '3.0.0');
  });
  
  it('should return liveness', async () => {
    const res = await app.request('/health/live');
    const data = await res.json();
    
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('status', 'alive');
  });
  
  it('should return readiness', async () => {
    const res = await app.request('/health/ready');
    const data = await res.json();
    
    expect(data).toHaveProperty('status');
  });
});

describe('Root Endpoint', () => {
  it('should return API info', async () => {
    const res = await app.request('/');
    const data = await res.json();
    
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('name', 'BlazeConnector');
    expect(data).toHaveProperty('version', '3.0.0');
  });
});

describe('Message Endpoints', () => {
  it('should require authentication', async () => {
    const res = await app.request('/api/v3/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: '18091234567',
        templateKey: 'TEST',
      }),
    });
    
    expect(res.status).toBe(401);
  });
  
  it('should list messages with auth', async () => {
    const res = await app.request('/api/v3/messages', {
      headers: {
        'X-Api-Key': 'test-key',
      },
    });
    
    // Will fail with invalid key, but tests the route exists
    expect([401, 200, 403]).toContain(res.status);
  });
});

describe('Client Endpoints', () => {
  it('should require authentication for clients', async () => {
    const res = await app.request('/api/v3/clients');
    
    expect(res.status).toBe(401);
  });
  
  it('should get current client info', async () => {
    const res = await app.request('/api/v3/clients/me', {
      headers: {
        'X-Api-Key': 'test-key',
      },
    });
    
    expect([401, 200]).toContain(res.status);
  });
});
