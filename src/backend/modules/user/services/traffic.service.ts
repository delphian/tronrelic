/**
 * Traffic events service — sibling of UserService.
 *
 * Captures cookieless and pre-session HTTP traffic in ClickHouse so it does
 * not pollute the Mongo `users` collection. Backs the traffic-events split
 * tracked in `PLAN-traffic-events.md`. Phase 0 lands the skeleton; later
 * phases add the callers.
 *
 * ## Why This Service Exists
 *
 * The 2026-04-27 identity-cookie change moved bootstrap from a JS-runtime
 * mutation into a Next.js middleware → backend path. That removed the
 * implicit "client must run JavaScript" filter that previously kept bot
 * traffic out of `users`. Every cookieless GET now writes an empty row.
 * We keep wanting to *track* that traffic — just not in the identity
 * collection. ClickHouse is the right tool for high-volume append-only
 * event data with rich dimensions.
 *
 * ## Design Decisions
 *
 * - **Singleton** matching `UserService` and `GscService` for consistent DI.
 *   `TrafficService` has no public `IXxxService` interface today; it is a
 *   user-module internal collaborator. If a plugin ever needs it, expose
 *   `ITrafficService` via the service registry as the user module already
 *   does for `UserService`.
 * - **Optional ClickHouse.** The `ClickHouseModule` skips initialization
 *   when `CLICKHOUSE_HOST` is unset. `TrafficService` mirrors that posture:
 *   when ClickHouse is unavailable every public method silently no-ops
 *   (writes drop, reads return `[]`). The orphan-row fix in later phases
 *   stays correct because Mongo writes are gated independently — losing
 *   the analytics is the only consequence of a missing CH host, not data
 *   corruption.
 * - **Async insert friendly.** `ClickHouseService` is configured with
 *   `wait_for_async_insert: 0`, so `recordEvent` returns once the row is
 *   buffered server-side. Errors surface via the async-insert error
 *   poller in `ClickHouseService` rather than the awaited promise. That
 *   matches what we want from a request-path call: never block the
 *   response on analytics persistence.
 */

import type { Request } from 'express';
import type { IClickHouseService, ISystemLogService } from '@/types';
import { getClientIP, getCountryFromIP, getDeviceCategory } from './geo.service.js';

/**
 * Categorical event types written to `traffic_events.event_type`.
 *
 * Kept as a string union (not an enum) so the wire format is the bare
 * string and matches the ClickHouse `LowCardinality(String)` column. New
 * event types can be added without changing the migration; the column
 * stays variable-cardinality.
 */
export type TrafficEventType = 'bootstrap' | 'session_start';

/**
 * Single row written to `traffic_events`.
 *
 * Field names match column names exactly so the service can pass the
 * object straight to `ClickHouseService.insert()` without a remap. Every
 * non-required field is `null`-able to keep the contract honest about
 * what middleware will and will not forward in Phase 1.
 */
export interface ITrafficEvent {
    /** `'bootstrap'` (cookie minted) or `'session_start'` (cookie-validated). */
    event_type: TrafficEventType;
    /** Server-side wall clock at write time. */
    timestamp: Date;
    /** UUID minted by the bootstrap controller. Always present. */
    candidate_uid: string;

    /** Request URL or middleware-supplied `landingPath`. */
    path: string;
    /** HTTP `Referer` header, when present. */
    referer: string | null;
    /** `document.referrer` reported by the client (Phase 1 JSON body). */
    original_referrer: string | null;

    user_agent: string | null;
    accept_language: string | null;

    /** ISO-3166-1 alpha-2 derived from request IP at write time. */
    country: string | null;
    /** `'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown'`. */
    device: string;
    /** `'crawler' | 'monitoring' | ...` when classified, else null. */
    bot_class: string | null;

    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_term: string | null;
    utm_content: string | null;

    sec_ch_ua: string | null;
    /** `0` or `1`. ClickHouse stores as `Nullable(UInt8)`. */
    sec_ch_ua_mobile: number | null;
    sec_ch_ua_platform: string | null;
    sec_fetch_dest: string | null;
    sec_fetch_mode: string | null;
    sec_fetch_site: string | null;
}

/**
 * Options for `getEventsForUser`.
 */
export interface IGetEventsForUserOptions {
    /** Maximum rows to return. Default: 50 — Phase 3 only needs the earliest few. */
    limit?: number;
    /** Earliest event types to include. Default: all. */
    eventTypes?: TrafficEventType[];
}

const TABLE_NAME = 'traffic_events';

/**
 * ClickHouse-backed traffic events store.
 *
 * Acquire via `TrafficService.setDependencies(...)` once during
 * `UserModule.init()`, then `TrafficService.getInstance()` in callers.
 */
export class TrafficService {
    private static instance: TrafficService | null = null;

    private constructor(
        private readonly clickhouse: IClickHouseService | undefined,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Initialize the singleton with dependencies.
     *
     * `clickhouse` is `undefined` when the deployment did not configure
     * `CLICKHOUSE_HOST`. The service stays usable in that mode — every
     * write is dropped, every read returns `[]`. Operators see the
     * single info-level log on init and choose whether the missing
     * analytics matters for their environment.
     */
    public static setDependencies(
        clickhouse: IClickHouseService | undefined,
        logger: ISystemLogService
    ): void {
        if (!TrafficService.instance) {
            TrafficService.instance = new TrafficService(clickhouse, logger);
            if (!clickhouse) {
                logger.info(
                    'TrafficService initialized without ClickHouse — traffic events will not be recorded'
                );
            }
        }
    }

    /**
     * @throws Error if `setDependencies()` has not been called first.
     */
    public static getInstance(): TrafficService {
        if (!TrafficService.instance) {
            throw new Error('TrafficService.setDependencies() must be called before getInstance()');
        }
        return TrafficService.instance;
    }

    /**
     * Reset singleton instance. Tests only.
     */
    public static resetInstance(): void {
        TrafficService.instance = null;
    }

    /**
     * True when ClickHouse is available and writes will succeed.
     */
    public isEnabled(): boolean {
        return this.clickhouse !== undefined;
    }

    /**
     * Record one traffic event. Fire-and-forget: returns synchronously
     * once the insert is dispatched, never blocks the request handler.
     * Errors are logged via the attached `.catch()` and additionally
     * surface via the async-insert error poller in `ClickHouseService`.
     */
    recordEvent(event: ITrafficEvent): void {
        if (!this.clickhouse) {
            return;
        }

        this.clickhouse.insert(TABLE_NAME, [serializeEvent(event)]).catch((error) => {
            this.logger.warn({ error, eventType: event.event_type }, 'Failed to record traffic event');
        });
    }

    /**
     * Return the earliest events recorded for a candidate UUID, oldest
     * first. Used by Phase 3's first-touch backfill on `startSession`:
     * pull the cookieless rows that landed before the user's JS started
     * the session, prefer those values over the post-hydration payload.
     *
     * Returns `[]` when ClickHouse is unavailable so callers can simply
     * fall back to whatever data they were going to use anyway.
     */
    async getEventsForUser(
        candidateUid: string,
        options: IGetEventsForUserOptions = {}
    ): Promise<ITrafficEvent[]> {
        if (!this.clickhouse) {
            return [];
        }

        const { limit = 50, eventTypes } = options;

        const eventFilter = eventTypes && eventTypes.length > 0
            ? 'AND event_type IN ({eventTypes:Array(String)})'
            : '';

        // Explicit column list (rather than SELECT *) so a future schema
        // addition we don't intend to read won't auto-bleed into our type.
        const sql = `
            SELECT
                event_type,
                timestamp,
                candidate_uid,
                path,
                referer,
                original_referrer,
                user_agent,
                accept_language,
                country,
                device,
                bot_class,
                utm_source,
                utm_medium,
                utm_campaign,
                utm_term,
                utm_content,
                sec_ch_ua,
                sec_ch_ua_mobile,
                sec_ch_ua_platform,
                sec_fetch_dest,
                sec_fetch_mode,
                sec_fetch_site
            FROM ${TABLE_NAME}
            WHERE candidate_uid = {candidateUid:UUID}
            ${eventFilter}
            ORDER BY timestamp ASC
            LIMIT {limit:UInt32}
        `;

        const params: Record<string, unknown> = { candidateUid, limit };
        if (eventTypes && eventTypes.length > 0) {
            params.eventTypes = eventTypes;
        }

        try {
            const rows = await this.clickhouse.query<TrafficEventRow>(sql, params);
            return rows.map(deserializeEvent);
        } catch (error) {
            this.logger.warn({ error, candidateUid }, 'Failed to read traffic events');
            return [];
        }
    }
}

/**
 * Inputs the controller can derive from the request body and cookie state
 * but the request headers cannot supply on their own.
 *
 * Phase 1 forwards a small JSON body alongside the inbound headers so the
 * backend has real visitor context (landing path, UTM params, original
 * referrer captured by the legacy-redirect middleware) on the bootstrap
 * call. The `startSession` payload supplies the same shape from the
 * frontend session-start fetch.
 */
export interface ITrafficEventBuilderInputs {
    /** Sanitized landing path; falls back to `req.path` when omitted. */
    landingPath?: string;
    /** UTM params parsed from the URL or session-start payload. */
    utm?: {
        source?: string | null;
        medium?: string | null;
        campaign?: string | null;
        term?: string | null;
        content?: string | null;
    };
    /** `document.referrer` reported by the client at landing. */
    originalReferrer?: string | null;
}

/**
 * Build an `ITrafficEvent` from an Express request and a candidate UUID.
 *
 * Centralizes "request → ITrafficEvent" mapping so both the bootstrap
 * controller (Phase 2) and the session-start controller (Phase 3) emit
 * rows with the same shape. The geo / device helpers are reused from
 * `geo.service.ts` so the device-category and country-derivation rules
 * stay in one place.
 *
 * The builder never throws — every dimension is `Nullable` in the
 * ClickHouse schema, so missing or malformed input collapses to `null`
 * rather than failing the inbound request.
 */
export function buildTrafficEvent(
    eventType: TrafficEventType,
    candidateUid: string,
    req: Request,
    inputs: ITrafficEventBuilderInputs = {}
): ITrafficEvent {
    const headers = req.headers ?? {};
    const userAgent = readSingleHeader(headers['user-agent']);
    const referer = readSingleHeader(headers['referer']);
    const acceptLanguage = readSingleHeader(headers['accept-language']);
    const secChUa = readSingleHeader(headers['sec-ch-ua']);
    const secChUaMobile = readSingleHeader(headers['sec-ch-ua-mobile']);
    const secChUaPlatform = readSingleHeader(headers['sec-ch-ua-platform']);
    const secFetchDest = readSingleHeader(headers['sec-fetch-dest']);
    const secFetchMode = readSingleHeader(headers['sec-fetch-mode']);
    const secFetchSite = readSingleHeader(headers['sec-fetch-site']);

    const utm = inputs.utm ?? {};

    return {
        event_type: eventType,
        timestamp: new Date(),
        candidate_uid: candidateUid,

        path: inputs.landingPath ?? (typeof req.path === 'string' ? req.path : '/'),
        referer: referer ?? null,
        original_referrer: inputs.originalReferrer ?? null,

        user_agent: userAgent ?? null,
        accept_language: acceptLanguage ?? null,

        country: getCountryFromIP(getClientIP({ ip: req.ip, headers })),
        device: getDeviceCategory(userAgent),
        // bot_class deferred — see PLAN-traffic-events.md "Open Questions".
        // Until the library-vs-regex decision lands, every row carries
        // null. Future Phase 4+ work can backfill via a CH `ALTER TABLE
        // ... UPDATE` over recent rows once the classifier exists.
        bot_class: null,

        utm_source: utm.source ?? null,
        utm_medium: utm.medium ?? null,
        utm_campaign: utm.campaign ?? null,
        utm_term: utm.term ?? null,
        utm_content: utm.content ?? null,

        sec_ch_ua: secChUa ?? null,
        sec_ch_ua_mobile: parseSecChUaMobile(secChUaMobile),
        sec_ch_ua_platform: secChUaPlatform ?? null,
        sec_fetch_dest: secFetchDest ?? null,
        sec_fetch_mode: secFetchMode ?? null,
        sec_fetch_site: secFetchSite ?? null
    };
}

/**
 * Express normalizes most headers to a single string but allows arrays
 * for ones that can repeat (e.g. `Set-Cookie`). For our forwarded set we
 * only care about the first occurrence; coercing the array form here
 * keeps the call site free of `Array.isArray` checks.
 */
function readSingleHeader(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) {
        return value[0];
    }
    return value;
}

/**
 * Parse the `Sec-CH-UA-Mobile` header (`"?0"` / `"?1"`) into the 0/1 form
 * the ClickHouse `Nullable(UInt8)` column expects. Anything else maps to
 * null so a malformed client header doesn't poison the row.
 */
function parseSecChUaMobile(value: string | undefined): number | null {
    if (value === '?1') return 1;
    if (value === '?0') return 0;
    return null;
}

/**
 * Wire-format row returned by ClickHouse. `timestamp` arrives as a UTC
 * `DateTime64(3)` string in `YYYY-MM-DD HH:MM:SS.mmm` form (ClickHouse's
 * native format under `JSONEachRow`); everything else lines up with
 * `ITrafficEvent` directly.
 */
interface TrafficEventRow extends Omit<ITrafficEvent, 'timestamp'> {
    timestamp: string;
}

function pad(value: number, length: number): string {
    return String(value).padStart(length, '0');
}

/**
 * Render a `Date` in ClickHouse's native `DateTime64(3)` form, in UTC.
 *
 * The default `date_time_input_format=basic` rejects `toISOString()`
 * output (the `T...Z` form) — inserts would fail in production. The
 * column is declared `DateTime64(3, 'UTC')` so emitting in UTC keeps
 * the wire format and the column tz aligned regardless of which
 * ClickHouse node the row lands on.
 */
function formatClickHouseDateTime64Utc(date: Date): string {
    return (
        `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)} ` +
        `${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}.${pad(date.getUTCMilliseconds(), 3)}`
    );
}

/**
 * Inverse of `formatClickHouseDateTime64Utc`. Falls back to `new Date(value)`
 * for any unrecognized form so a future ClickHouse driver upgrade that
 * normalizes timestamps to ISO doesn't break us silently.
 */
function parseClickHouseDateTime64Utc(value: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z?$/.exec(value);
    if (!match) {
        return new Date(value);
    }
    const [, year, month, day, hour, minute, second, milliseconds = '0'] = match;
    return new Date(Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        Number(milliseconds.padEnd(3, '0'))
    ));
}

/**
 * Convert an `ITrafficEvent` into the shape ClickHouse expects on insert.
 * `timestamp` becomes a UTC `DateTime64(3)` string in ClickHouse's native
 * form so inserts succeed under the default `date_time_input_format=basic`.
 */
function serializeEvent(event: ITrafficEvent): Record<string, unknown> {
    return { ...event, timestamp: formatClickHouseDateTime64Utc(event.timestamp) };
}

/**
 * Inverse of `serializeEvent`. Re-hydrates the `Date` instance from
 * ClickHouse's native `DateTime64(3)` string form.
 */
function deserializeEvent(row: TrafficEventRow): ITrafficEvent {
    return { ...row, timestamp: parseClickHouseDateTime64Utc(row.timestamp) };
}
