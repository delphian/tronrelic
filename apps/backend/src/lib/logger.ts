import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Creates the logger instance for the TronRelic backend.
 *
 * Logs are written to both `.run/backend.log` (file) and stdout (for `docker logs` access).
 * This allows access to logs through either local file reads or Docker commands.
 *
 * The log level is set based on the NODE_ENV: 'debug' for development, 'info' for production.
 */
const transport = pino.transport({
  targets: [
    {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      target: 'pino/file',
      options: { destination: '.run/backend.log' }
    },
    {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: false,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    }
  ]
});

export const logger = pino(
  {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    base: {
      service: 'tronrelic-backend'
    }
  },
  transport
);
