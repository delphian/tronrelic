/**
 * @fileoverview Read the UTM tags from a URL's query string.
 */

import type { IUtmParams } from './IUtmParams.js';

/** The UTM keys accepted from a URL, without their `utm_` prefix. Anything else is ignored. */
const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

/**
 * Read the UTM tags a landing URL carries.
 *
 * Two places record a visit and both need the same tags: the Next.js
 * middleware, which records a visitor's first touch, and the browser's page
 * beacon, which records every navigation. Reading them through one function
 * keeps the two from accepting different keys.
 *
 * Empty values are dropped, so `?utm_source=` counts as untagged.
 *
 * @param searchParams - The query string of the URL the visitor landed on.
 * @returns The tags present, or null when the URL carries none, so a caller can
 *   leave the field out of its payload.
 */
export function readUtmParams(searchParams: URLSearchParams): IUtmParams | null {
    const utm: IUtmParams = {};
    for (const key of UTM_KEYS) {
        const value = searchParams.get(`utm_${key}`);
        if (value) {
            utm[key] = value;
        }
    }
    return Object.keys(utm).length > 0 ? utm : null;
}
