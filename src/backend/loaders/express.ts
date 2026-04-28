import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import type { Express } from 'express';
import { requestContext } from '../api/middleware/request-context.js';
import { errorHandler } from '../api/middleware/error-handler.js';
import { env } from '../config/env.js';
import { corsOriginCallback } from '../config/cors.js';

export function createExpressApp(): Express {
  const app = express();

  app.set('trust proxy', true);
  app.use(requestContext);
  app.use(helmet());

  app.use(cors({
    origin: corsOriginCallback,
    credentials: true
  }));

  app.use(compression());
  // Pass SESSION_SECRET so cookie-parser populates `req.signedCookies` for
  // signed cookies (s:<value>.<HMAC> on the wire). Unsigned cookies still
  // populate `req.cookies` so legacy clients keep working during the grace
  // window in `userContextMiddleware` — but `requireAdmin` reads only from
  // `req.signedCookies` to close the cookie-forgery vector.
  app.use(cookieParser(env.SESSION_SECRET));
  app.use(express.json({ limit: '5mb' }));
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

  // Note: API routes are mounted in bootstrapInit() after database is initialized
  // This allows routers to receive the shared coreDatabase via dependency injection

  app.use(errorHandler);
  return app;
}
