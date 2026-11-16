/**
 * @fileoverview Logs WebSocket handshakes refused because they came from
 * another website, so an operator can see which site tried to open a socket.
 *
 * A refused HTTP request reaches the Express error handler, which logs the
 * refused origin. A refused socket handshake never does: engine.io answers it
 * with its own 400 and only emits a `connection_error` event.
 *
 * Facts about engine.io's `connection_error` event (version 6.6):
 * - It fires for every refused handshake: an unknown session id, an unknown
 *   transport, a bad handshake method, and a failed middleware.
 * - A refused origin arrives with `context.name` set to `MIDDLEWARE_FAILURE`.
 * - The error the origin check raised is not passed on, so the origin is read
 *   from the request headers and checked again.
 * - It fires for both the polling request and the WebSocket upgrade.
 *
 * The Origin header is chosen by the caller and a refused client keeps
 * retrying, so entries pass through a `WindowedLogLimiter` and the logged
 * value is cut to a fixed length.
 */
import type { IncomingHttpHeaders } from 'node:http';
import type { ISystemLogService } from '@/types';
import type { WindowedLogLimiter } from '../lib/WindowedLogLimiter.js';

/** Longest refused origin written to the log, in characters. A real origin is far shorter. */
export const MAX_LOGGED_ORIGIN_LENGTH = 200;

/** The `context.name` engine.io sets when a middleware refused the request. The origin check is the only middleware installed. */
const MIDDLEWARE_FAILURE = 'MIDDLEWARE_FAILURE';

/** The fields of engine.io's `connection_error` event that the logger reads. */
export interface IEngineConnectionError {
    /** The refused request. Only its headers are read. */
    req: { headers: IncomingHttpHeaders };

    /** Why engine.io refused the request. `name` is set when a middleware failed. */
    context?: { name?: string };
}

/**
 * Writes one bounded log entry for each website whose socket handshake the
 * origin check refused.
 *
 * A utility rather than a shared service: `WebSocketService` builds the one
 * instance it needs and hands it the engine's events.
 */
export class RefusedSocketOriginLogger {
    /**
     * @param logger - Where the entries are written. Only `warn` is used,
     *   because a refused origin is a stranger's request and not a fault.
     * @param limiter - Bounds how often one origin, and how many distinct
     *   origins, are logged, since the caller controls both.
     * @param isAllowedOrigin - The origin check's own rule, so this class
     *   logs exactly the origins that check refuses.
     */
    constructor(
        private readonly logger: Pick<ISystemLogService, 'warn'>,
        private readonly limiter: WindowedLogLimiter,
        private readonly isAllowedOrigin: (origin: string) => boolean
    ) {}

    /**
     * Log a refused handshake when the origin check is what refused it.
     *
     * Every other kind of `connection_error` is ignored, because those are
     * ordinary client mistakes and are not about where the request came from.
     * A middleware failure whose origin is missing or allowed is ignored too,
     * so an entry is never written naming an origin that was not refused.
     *
     * @param event - The engine's `connection_error` event, which carries the
     *   refused request and the reason engine.io gave.
     */
    record(event: IEngineConnectionError): void {
        const origin = event.req.headers.origin;
        const refusedByOriginCheck = event.context?.name === MIDDLEWARE_FAILURE
            && typeof origin === 'string'
            && origin.length > 0
            && !this.isAllowedOrigin(origin);
        if (refusedByOriginCheck) {
            const verdict = this.limiter.admit(origin);
            if (verdict === 'log') {
                this.logger.warn(
                    { origin: origin.slice(0, MAX_LOGGED_ORIGIN_LENGTH), repeatsNotLoggedForMinutes: this.limiter.windowMinutes },
                    'WebSocket handshake refused: the origin is not allowed'
                );
            } else if (verdict === 'ceiling-reached') {
                this.logger.warn(
                    { loggedOrigins: this.limiter.loggedKeys, windowMinutes: this.limiter.windowMinutes },
                    'Refused WebSocket origins are no longer being logged this window: the limit on distinct origins was reached'
                );
            }
        }
    }
}
