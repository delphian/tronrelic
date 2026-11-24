/**
 * @fileoverview Turns a visitor's request and a validated goal into the row
 * stored in `traffic_goal_events`.
 *
 * Why it exists: a goal's bot class, country, device, network, and address
 * hashes have to mean exactly what they mean on a `page` row, or attributing a
 * goal to its session would compare two different classifications. So this
 * builder does not classify anything itself. It runs the request through
 * `buildTrafficEvent`, the builder the page beacon uses (and with it the
 * built-in bot classifier and the operator's bot rules), and keeps the fields
 * a goal row needs.
 *
 * For a visitor without analytics consent it stores no identifier at all: no
 * tid, no account id, and no address hashes, matching the consent module's
 * anonymous page-view count.
 */

import type { Request } from 'express';
import type { IHttpRequest } from '@/types';
import { buildTrafficEvent, NO_TID, type ITrafficGoalEvent } from './traffic.service.js';
import type { IBotRuleMatcher } from './bot-rule-matcher.js';

/** Longest stored page path, the same cap the page beacon applies. */
const MAX_GOAL_PATH_LENGTH = 500;

/** What the recorder has already worked out about the request before building the row. */
export interface IGoalEventContext {
    /** The visitor's tid, or `null` when there is none or it must not be read. */
    tid: string | null;
    /** The Better Auth user id, or `null` when anonymous. Used for bot rules even when not stored. */
    userId: string | null;
    /** Whether the visitor allowed analytics, which decides whether identifiers are stored. */
    analyticsConsent: boolean;
    /** The operator's active bot rules, applied exactly as for a page event. */
    botRules: IBotRuleMatcher;
}

/**
 * Read a single header value, taking the first when Express gives an array.
 *
 * @param value - Raw header value.
 * @returns The first value, or undefined.
 */
function readHeader(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

/**
 * Find the path of the page a goal happened on.
 *
 * A component records a goal from its own API route, so the request's path
 * is that route, not a page. The browser's `Referer` names the page the
 * visitor was on when they acted. It is used only when its host is this
 * site's host, so a link to the goal endpoint from another site does not
 * record that site's path as one of ours. The query string and fragment are
 * dropped, as the page beacon drops them.
 *
 * @param req - The visitor's request.
 * @returns The page path, or null when the referrer is missing, foreign, or malformed.
 */
export function pagePathFromReferer(req: IHttpRequest): string | null {
    let path: string | null = null;
    const referer = readHeader(req.headers['referer']);
    const host = readHeader(req.headers['host']);
    if (referer && host) {
        try {
            const url = new URL(referer);
            const siteHost = host.split(':')[0]!.toLowerCase().replace(/^www\./, '');
            const refererHost = url.hostname.toLowerCase().replace(/^www\./, '');
            if (refererHost === siteHost && url.pathname.startsWith('/')) {
                path = url.pathname.slice(0, MAX_GOAL_PATH_LENGTH);
            }
        } catch {
            path = null;
        }
    }
    return path;
}

/**
 * Build the `traffic_goal_events` row for one goal.
 *
 * @param req - The visitor's request, as a plugin or module route receives it.
 *   At runtime this is the Express request, which is what `buildTrafficEvent`
 *   reads headers, address, and path from.
 * @param goal - The validated goal name and properties.
 * @param context - The tid, user, consent, and bot rules the recorder resolved.
 * @returns The row to insert.
 */
export function buildTrafficGoalEvent(
    req: IHttpRequest,
    goal: { name: string; properties: Record<string, string> },
    context: IGoalEventContext
): ITrafficGoalEvent {
    const pagePath = pagePathFromReferer(req);
    // Classified as a `page` event: a goal arrives from the visitor's browser
    // with its cookies, as a page beacon does, so the bot rules written for
    // page reports apply to it. The page path, when known, stands in for the
    // landing path so probe-path heuristics see the page rather than the API
    // route.
    const event = buildTrafficEvent('page', context.tid ?? NO_TID, req as unknown as Request, {
        ...(pagePath ? { landingPath: pagePath } : {}),
        userId: context.userId,
        botRules: context.botRules
    });
    const identified = context.analyticsConsent;

    return {
        timestamp: event.timestamp,
        candidate_uid: identified && context.tid ? context.tid : NO_TID,
        user_id: identified ? context.userId : null,
        goal: goal.name,
        properties: goal.properties,
        path: pagePath ?? '',
        analytics_consent: identified ? 1 : 0,
        bot_class: event.bot_class,
        bot_rule: event.bot_rule,
        country: event.country,
        device: event.device,
        asn: event.asn,
        ip_hash: identified ? event.ip_hash : null,
        subnet_hash: identified ? event.subnet_hash : null
    };
}
