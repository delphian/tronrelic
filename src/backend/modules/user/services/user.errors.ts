/**
 * Typed errors thrown by `UserService`.
 *
 * Controllers map these to HTTP status codes via `instanceof` checks so
 * client-side validation failures don't slip through generic catches as 500s.
 */

/**
 * Invalid analytics date range supplied by the client (e.g. `startDate` is
 * after `endDate`). Thrown by `UserService.resolveAnalyticsRange`. Maps to
 * HTTP 400.
 */
export class AnalyticsRangeValidationError extends Error {
    readonly name = 'AnalyticsRangeValidationError';
    constructor(message: string) {
        super(message);
    }
}
