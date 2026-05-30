import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import type { Express } from 'express';
import { requestContext } from '../api/middleware/request-context.js';
import { errorHandler } from '../api/middleware/error-handler.js';
import { attachAuthSession } from '../api/middleware/auth-session.js';
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
  // Pass SESSION_SECRET so cookie-parser populates `req.signedCookies` for any
  // signed cookies (s:<value>.<HMAC> on the wire); unsigned cookies populate
  // `req.cookies`. Identity rides the Better Auth session cookie, which Better
  // Auth signs and verifies itself — this stays wired so any future signed
  // cookie is verifiable.
  app.use(cookieParser(env.SESSION_SECRET));
  // Body parsers consume the raw request stream, but Better Auth's
  // Node integration needs the original body to validate email-OTP
  // codes, OAuth callbacks, and passkey assertions. Skip them on
  // `/api/auth/*` so `toNodeHandler` (mounted by IdentityModule.run()) can
  // read the body itself. Cookie-parser above is safe to leave global
  // because it only reads headers.
  app.use(skipForAuthRoutes(express.json({ limit: '5mb' })));
  app.use(skipForAuthRoutes(express.urlencoded({ extended: true })));
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

  // Phase 2 of the auth refactor: mount the Better Auth session
  // middleware in the framework layer so every downstream route
  // (including the /api router mounted by bootstrapInit after this
  // function returns) inherits a pre-resolved req.authSession.
  // Registering it inside a module's run() would be too late —
  // bootstrapInit mounts the /api router before module.run() fires,
  // so middleware added there would never see /api/* requests. The
  // middleware lazily resolves the auth instance via the facade, so
  // it is safe to register here before IdentityModule.init() configures
  // the BA singleton; real traffic only arrives after both phases
  // complete and the server starts listening.
  app.use(attachAuthSession);

  // Note: API routes are mounted in bootstrapInit() after database is initialized
  // This allows routers to receive the shared coreDatabase via dependency injection

  app.use(errorHandler);
  return app;
}

/**
 * Wrap an Express middleware so it skips itself on `/api/auth/*` paths.
 *
 * Used to keep the global body parsers from consuming the request
 * stream that Better Auth's Node handler needs to read. The wrapper
 * preserves the original middleware's signature so it composes
 * transparently with `app.use(...)`.
 *
 * @param middleware - Middleware to bypass on auth routes.
 * @returns A new middleware that calls through on `/api/auth/*` and
 *          delegates to the original elsewhere.
 */
function skipForAuthRoutes(middleware: express.RequestHandler): express.RequestHandler {
  return function authBypass(req, res, next): void {
    if (req.path.startsWith('/api/auth/') || req.path === '/api/auth') {
      next();
      return;
    }
    middleware(req, res, next);
  };
}
