/**
 * Logger - BlazeConnector v3
 * Structured logging with Pino
 */

import pino from 'pino';
import { getConfig } from './config';

let _logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (!_logger) {
    const config = getConfig();
    
    _logger = pino({
      level: config.logLevel,
      transport: config.logPretty
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
      formatters: {
        level: (label) => ({ level: label }),
      },
      serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
      },
    });
  }
  
  return _logger;
}

// Convenience loggers per module
export const createLogger = (module: string) => {
  const logger = getLogger();
  return logger.child({ module });
};

// Pre-created loggers for common modules
export const log = {
  system: createLogger('system'),
  api: createLogger('api'),
  queue: createLogger('queue'),
  db: createLogger('db'),
  redis: createLogger('redis'),
  messaging: createLogger('messaging'),
  payments: createLogger('payments'),
  integrations: createLogger('integrations'),
  worker: createLogger('worker'),
  ws: createLogger('websocket'),
};
