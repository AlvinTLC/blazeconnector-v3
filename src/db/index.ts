/**
 * Database - BlazeConnector v3
 * PostgreSQL connection with Drizzle ORM
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getConfig } from '../core/config';
import { log } from '../core/logger';
import * as schema from './schema';

let _db: ReturnType<typeof drizzle> | null = null;
let _connection: postgres.Sql | null = null;

export function getDb() {
  if (!_db) {
    const config = getConfig();
    
    _connection = postgres(config.databaseUrl, {
      max: 20,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {}, // Suppress notices
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
