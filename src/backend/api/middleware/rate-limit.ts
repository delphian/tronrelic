import type { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../../loaders/redis.js';
import { RateLimitService } from '../../services/rate-limit.service.js';
import { RateLimitError } from '../../lib/errors.js';

const redis = () => getRedisClient();

/**
 * Build a per-IP rate-limiting middleware.
 *
 * The middleware is async, so a rejected `consume()` must be handled here:
 * Express 4 does not forward rejected promises from middleware to the error
 * handler, so an unhandled `RateLimitError` would surface as an unhandled
 * rejection (and never produce a 429) rather than a clean response. We catch
 * the limit case and answer 429 directly, and forward any other error through
 * `next` so the error handler can map it.
 *
 * @param windowSeconds - Sliding window length in seconds.
 * @param maxRequests - Allowed requests per window per IP.
 * @param keyPrefix - Per-endpoint bucket prefix so endpoints don't share a limit.
 * @returns Express middleware consuming one slot per request.
 */
export function createRateLimiter({ windowSeconds, maxRequests, keyPrefix }: { windowSeconds: number; maxRequests: number; keyPrefix: string; }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const limiter = new RateLimitService(redis(), windowSeconds, maxRequests);
    const key = `${keyPrefix}:${req.ip}`;
    try {
      await limiter.consume(key);
      next();
    } catch (error) {
      if (error instanceof RateLimitError) {
        res.status(429).json({ success: false, error: 'Too many requests' });
        return;
      }
      next(error);
    }
  };
}

/**
 * Default rate-limit settings for admin endpoints.
 *
 * 60-second window, 60 requests per IP — the same shape used by the
 * other rate-limited core routes (tokens, transactions, energy) and
 * the existing admin precedent at MenuModule's /manage route. Bounds
 * brute-force cost against the `requireAdmin` auth path while leaving
 * plenty of headroom for legitimate operator usage.
 */
const ADMIN_RATE_LIMIT_WINDOW_SECONDS = 60;
const ADMIN_RATE_LIMIT_MAX_REQUESTS = 60;

/**
 * Build a per-IP rate limiter using the platform-default admin
 * settings.
 *
 * New admin endpoints should chain this in front of `requireAdmin` so
 * the brute-force cost against the auth gate is bounded and CodeQL's
 * `js/missing-rate-limiting` rule sees rate-limiting before
 * authorization in the middleware stack. CodeQL pattern-matches
 * `express-rate-limit` and similar packages; it does not recognize
 * the in-house limiter, so the alert still fires and is dismissed
 * with the project's standard rationale.
 *
 * The `keyPrefix` argument identifies the endpoint's rate-limit
 * bucket. Different admin endpoints share the same window and max
 * but separate buckets, so one noisy admin tool does not starve
 * another from the same IP.
 *
 * @param keyPrefix - Endpoint-specific bucket prefix (e.g.
 *   `'system-zones'`, `'menu-manage'`).
 * @returns Express middleware that consumes one slot per request and
 *   responds 429 when the bucket is exhausted.
 */
export function createAdminRateLimiter(keyPrefix: string) {
  return createRateLimiter({
    windowSeconds: ADMIN_RATE_LIMIT_WINDOW_SECONDS,
    maxRequests: ADMIN_RATE_LIMIT_MAX_REQUESTS,
    keyPrefix
  });
}
