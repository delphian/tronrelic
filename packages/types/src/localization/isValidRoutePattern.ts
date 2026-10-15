/**
 * @fileoverview Validate a route pattern before it is stored.
 *
 * A malformed pattern would never match anything, and the administrator would
 * see a route listed as published that no visitor can reach. Checking the
 * shape on save turns that silent failure into an error message.
 */

/** Longest pattern accepted; real routes are far shorter. */
const MAX_PATTERN_LENGTH = 200;

/** Characters a literal segment may contain: the URL-safe set paths use here. */
const LITERAL_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/** Shape of a `:name` placeholder segment. */
const PARAM_SEGMENT = /^:[A-Za-z0-9_]+$/;

/**
 * Check that a route pattern uses the syntax `matchRoutePattern` reads.
 *
 * The pattern must start with `/`, contain no empty segments, query string, or
 * fragment, and use `*` only as the whole of its final segment.
 *
 * @param pattern - Candidate pattern from the admin form.
 * @returns True when the pattern can be stored.
 */
export function isValidRoutePattern(pattern: string): boolean {
    let valid = typeof pattern === 'string'
        && pattern.startsWith('/')
        && pattern.length <= MAX_PATTERN_LENGTH;

    if (valid && pattern !== '/') {
        const segments = pattern.replace(/\/$/, '').split('/').slice(1);
        valid = segments.every((segment, index) => {
            const isLast = index === segments.length - 1;
            return (segment === '*' && isLast)
                || PARAM_SEGMENT.test(segment)
                || LITERAL_SEGMENT.test(segment);
        });
    }

    return valid;
}
