/**
 * @fileoverview The traffic ignore list as other components see it.
 *
 * Why it exists: plugins and other modules that count visitor activity need to
 * leave out the same people the traffic dashboard leaves out. The list and its
 * resolved tid set live inside `TrafficService`, and the list's admin service
 * can also change it, so neither is safe to publish directly. This class is the
 * read-only view the traffic module publishes as `'traffic-ignore-list'`.
 *
 * It also reads the visitor's identifiers off a request, so callers never need
 * to know the analytics cookie's name or where the session is attached.
 */

import type { IHttpRequest, ITrafficIgnoreList, ITrafficIgnoreSubject } from '@/types';
import { resolveTid } from '../api/traffic-cookies.js';

/**
 * Read-only ignore-list check published on the service registry.
 */
export class TrafficIgnoreList implements ITrafficIgnoreList {
    /**
     * @param lookup - The component holding the cached ignore list, which is
     *   `TrafficService` in production. Injected as the one method this class
     *   needs so tests can supply a stub.
     */
    constructor(private readonly lookup: Pick<ITrafficIgnoreList, 'isIgnored'>) {}

    /**
     * Check a visitor the caller has already identified, by delegating to the
     * cached list so the answer matches the dashboard's exclusion.
     *
     * @param subject - The visitor's user id and tid; either may be missing.
     * @returns True when either identifier belongs to an ignored person.
     */
    isIgnored(subject: ITrafficIgnoreSubject): boolean {
        return this.lookup.isIgnored(subject);
    }

    /**
     * Check the visitor who sent a request. Reads the logged-in user from the
     * session core attaches to every request and the tid from the analytics
     * cookie, then checks both.
     *
     * @param req - The incoming request from a plugin or module route.
     * @returns True when the request's visitor is an ignored person.
     */
    isRequestIgnored(req: IHttpRequest): boolean {
        const subject: ITrafficIgnoreSubject = {
            userId: req.authSession?.user.id ?? null,
            tid: resolveTid(req)
        };
        return this.lookup.isIgnored(subject);
    }
}
