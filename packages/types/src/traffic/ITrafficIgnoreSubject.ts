/**
 * @fileoverview The visitor identifiers checked against the traffic ignore list.
 *
 * Why it exists: the operator's ignore list names Better Auth accounts, but a
 * visitor is also known by the `tronrelic_tid` analytics cookie, which keeps the
 * same value before and after login. Checking both lets a caller exclude an
 * ignored person even on a request where they are not logged in, which is the
 * same whole-person rule the traffic dashboard applies.
 */

/**
 * One visitor, as far as a single request can identify them. Either field may
 * be missing: an anonymous visitor has no `userId`, and a visitor whose browser
 * has not been given an analytics cookie yet has no `tid`.
 */
export interface ITrafficIgnoreSubject {
    /**
     * Better Auth user id of the logged-in visitor, or null/undefined when the
     * request is anonymous. Matched against the ignore list directly.
     */
    userId?: string | null;

    /**
     * Value of the visitor's `tronrelic_tid` analytics cookie, or null/undefined
     * when the browser has none. Matched against every tid that has ever logged
     * in as an ignored account.
     */
    tid?: string | null;
}
