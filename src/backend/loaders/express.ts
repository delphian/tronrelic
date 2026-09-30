import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import type { Express } from 'express';
import { requestContext } from '../api/middleware/request-context.js';
import { attachAuthSession } from '../api/middleware/auth-session.js';
import { env } from '../config/env.js';
import { corsOriginCallback } from '../config/cors.js';
import { MCP_ENDPOINT_PATH } from '../modules/identity/services/oauth-server-config.js';

export function createExpressApp(): Express {
  const app = express();

  // Trust only proxies on loopback and private networks (Nginx arrives via
  // Docker's port proxy, the frontend from the Docker network), so `req.ip`
  // is the last address one of our own proxies added. `true` trusted every
  // hop, which made `req.ip` the left-most X-Forwarded-For entry — a value
  // any client can write — and let callers pick their own rate-limit key.
  app.set('trust proxy', 'loopback, uniquelocal');
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
  // read the body itself. Skip them on `/mcp` too: the MCP endpoint checks
  // the bearer token first and only then parses the body with its own small
  // limit, so an anonymous caller cannot make the server read 5 MB. Cookie-parser
  // above is safe to leave global because it only reads headers.
  app.use(skipForRawBodyRoutes(express.json({ limit: '5mb' })));
  app.use(skipForRawBodyRoutes(express.urlencoded({ extended: true })));
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
  //
  // The error handler is deliberately not registered here. Express only searches
  // layers registered after the one that failed, so an error handler mounted at
  // app-creation time never sees an error raised by the /api router, a module
  // router, or a plugin router, because all of those mount later. bootstrap()
  // registers it once every router is in place.
  return app;
}

/**
 * Every spelling of the MCP endpoint path that Express's default routing
 * (case-insensitive, trailing slash optional) sends to the `/mcp` route.
 * Built from the same constant the MCP resource URL is derived from, so the
 * mounted route and this bypass cannot drift apart if the path changes.
 */
const ESCAPED_MCP_PATH = MCP_ENDPOINT_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MCP_PATH_PATTERN = new RegExp(`^${ESCAPED_MCP_PATH}/?$`, 'i');

/**
 * Wrap an Express middleware so it skips itself on paths that read their own
 * request body.
 *
 * Used to keep the global body parsers from consuming the request stream on
 * `/api/auth/*`, which Better Auth's Node handler reads itself, and on `/mcp`,
 * which parses its body only after the caller is authenticated. The wrapper
 * preserves the original middleware's signature so it composes transparently
 * with `app.use(...)`.
 *
 * @param middleware - Middleware to bypass on those paths.
 * @returns A new middleware that calls straight through on those paths and
 *          delegates to the original elsewhere.
 */
function skipForRawBodyRoutes(middleware: express.RequestHandler): express.RequestHandler {
  /**
   * Leave the request stream unread on paths that parse their own body, and
   * run the wrapped parser everywhere else.
   *
   * @param req - Incoming request; its path decides whether to skip.
   * @param res - Response, passed through to the wrapped parser.
   * @param next - Continues the middleware chain.
   */
  return function rawBodyBypass(req, res, next): void {
    // Express routes case-insensitively and ignores a trailing slash, so
    // `app.all('/mcp')` also serves `/MCP` and `/mcp/`. Match the same set
    // here, or those spellings would be body-parsed before authentication.
    const readsOwnBody = req.path.startsWith('/api/auth/') || req.path === '/api/auth' || MCP_PATH_PATTERN.test(req.path);
    if (readsOwnBody) {
      next();
    } else {
      middleware(req, res, next);
    }
  };
}
