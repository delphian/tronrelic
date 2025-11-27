import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import type { Express } from 'express';
import type { IDatabaseService } from '@tronrelic/types';
import { requestContext } from '../api/middleware/request-context.js';
import { errorHandler } from '../api/middleware/error-handler.js';
import { createApiRouter } from '../api/routes/index.js';
import { env } from '../config/env.js';

export function createExpressApp(database?: IDatabaseService): Express {
  const app = express();

  app.set('trust proxy', true);
  app.use(requestContext);
  app.use(helmet());

  // CORS: Build allowed origins dynamically from environment
  const allowedOrigins: string[] = [
    'http://localhost:3000',
    'http://localhost:4000'
  ];

  // Add configured site URL if present
  if (env.SITE_URL) {
    allowedOrigins.push(env.SITE_URL);

    // Add www variant for production domains
    if (env.SITE_URL.startsWith('https://') && !env.SITE_URL.includes('www.')) {
      const wwwUrl = env.SITE_URL.replace('https://', 'https://www.');
      allowedOrigins.push(wwwUrl);
    }
  }

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('CORS policy: Origin not allowed'));
      }
    },
    credentials: true
  }));

  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  // Serve uploaded files from /public/uploads directory
  // Files are accessible at /uploads/* routes
  app.use('/uploads', express.static('public/uploads'));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  app.get('/metrics', async (req, res) => {
    if (!env.ENABLE_TELEMETRY) {
      res.status(503).send('# Telemetry disabled\n');
      return;
    }

    if (env.METRICS_TOKEN) {
      const header = req.headers['x-metrics-token'];
      const token = Array.isArray(header) ? header[0] : header;
      if (token !== env.METRICS_TOKEN) {
        res.status(403).send('Forbidden');
        return;
      }
    }

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send('# Market metrics moved to plugin API\n# See: /api/plugins/resource-markets/system/platforms\n# See: /api/plugins/resource-markets/system/freshness\n');
  });

  app.use('/api', createApiRouter(database));

  app.use(errorHandler);
  return app;
}
