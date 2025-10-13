import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import type { Express } from 'express';
import { requestContext } from '../api/middleware/request-context.js';
import { errorHandler } from '../api/middleware/error-handler.js';
import { createApiRouter } from '../api/routes/index.js';
import { env } from '../config/env.js';
import { marketMetrics } from '../modules/markets/market-metrics.service.js';

export function createExpressApp(): Express {
  const app = express();

  app.set('trust proxy', true);
  app.use(requestContext);
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  app.get('/metrics', async (req, res, next) => {
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

    try {
      const metrics = await marketMetrics.collectMetrics();
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(metrics);
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', createApiRouter());

  app.use(errorHandler);
  return app;
}
