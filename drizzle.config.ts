/**
 * Drizzle Kit Configuration
 */

import { defineConfig } from 'drizzle-kit';
import { getConfig } from './src/core/config';

const config = getConfig();

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: config.databaseUrl,
  },
  verbose: true,
  strict: true,
});
