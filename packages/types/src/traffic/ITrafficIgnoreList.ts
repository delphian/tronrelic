/**
 * @fileoverview Published read-only contract for the traffic ignore list.
 *
 * Why it exists: operators keep a list of accounts, such as their own and their
 * staff's, whose activity should not count in site statistics. The traffic
 * module applies that list to its own dashboard. Other components that count
 * visitor activity, such as a plugin counting outbound link clicks, need to
 * apply the same list so their figures exclude the same people.
 *
 * The traffic module publishes an implementation on the service registry under
 * the name `'traffic-ignore-list'`. The contract is read-only on purpose: the
 * list is managed only from `/system/traffic`, and no consumer may change it.
 *
 * Both methods answer from an in-memory cache the traffic module refreshes
 * whenever the list changes, so they are synchronous and cheap enough to call on
 * every request. The cache has the same bounded staleness as the dashboard: a
 * browser that first logs in as an ignored account after the last refresh is
 * matched by its user id while logged in, but its anonymous requests are not
 * matched until the next refresh.
 */

import type { IHttpRequest } from '../http/IHttpRequest.js';
import type { ITrafficIgnoreSubject } from './ITrafficIgnoreSubject.js';

/**
 * Answers whether a visitor is on the operator's traffic ignore list.
 */
export interface ITrafficIgnoreList {
    /**
     * Check a visitor the caller has already identified. Use this when the
     * caller holds the user id and tid itself, for example from stored data.
     *
     * @param subject - The visitor's Better Auth user id and analytics cookie
     *   value, either of which may be missing.
     * @returns True when the user id is on the list, or when the tid has ever
     *   been logged in as an account on the list.
     */
    isIgnored(subject: ITrafficIgnoreSubject): boolean;

    /**
     * Check the visitor who sent an HTTP request. Use this from a route
     * handler, so the caller does not need to know the analytics cookie's name
     * or how the session is attached to the request.
     *
     * @param req - The incoming request, as plugin and module route handlers
     *   receive it.
     * @returns True when the request's logged-in user or its analytics cookie
     *   belongs to an ignored person.
     */
    isRequestIgnored(req: IHttpRequest): boolean;
}
