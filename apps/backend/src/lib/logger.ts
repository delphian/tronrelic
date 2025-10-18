import pino from 'pino';
import { mkdirSync } from 'fs';
import { env } from '../config/env.js';

/**
 * Creates the logger instance for the TronRelic backend.
 *
 * Logs are written to both `.run/backend.log` (file) and stdout (for `docker logs` access).
 * This allows access to logs through either local file reads or Docker commands.
 *
 * The log level is set based on the NODE_ENV: 'debug' for development, 'info' for production.
 *
 * The `.run` directory is created automatically if it doesn't exist (important for Docker containers
 * where the directory may not be pre-created in the image).
 */

// Ensure .run directory exists before creating logger
// This is critical in Docker containers where the directory may not be pre-created in the image
try {
  mkdirSync('.run', { recursive: true });
} catch (err) {
  // If directory creation fails, we'll still try to create the logger
  // (it will log to stdout only if file logging fails)
  console.error('Warning: Could not create .run directory:', err);
}

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
