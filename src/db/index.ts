/**
 * Database Connection - BlazeConnector v3
 * PostgreSQL with Drizzle ORM
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getConfig } from '../core/config.js';
import { log } from '../core/logger.js';
import * as schema from './schema.js';

let _db: ReturnType<typeof drizzle> | null = null;
let _connection: postgres.Sql | null = null;

export function getDb() {
  if (!_db) {
    const config = getConfig();
    
    _connection = postgres(config.databaseUrl, {
      max: 20,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    
    _db = drizzle(_connection, { schema });
    
    log.db.info('Database connection established');
  }
  
  return _db;
}

export async function closeDb(): Promise<void> {
  if (_connection) {
    await _connection.end();
    _connection = null;
    _db = null;
    log.db.info('Database connection closed');
  }
}

export { schema };
