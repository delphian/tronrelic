/**
 * @fileoverview Published contract for recording goal events.
 *
 * Why it exists: components that own a visitor action worth measuring, such as
 * the resource-markets plugin's links to rental markets, need that action
 * attributed to where the visitor came from. Attribution (sessions, sources,
 * landing pages, the ignore list, bot filtering, and cookie consent) already
 * lives in the traffic module, so the module records the goal and every
 * component reuses its rules instead of rebuilding them.
 *
 * The traffic module publishes an implementation on the service registry under
 * the name `'traffic-goals'`. The contract only records; reading goals back is
 * done through the traffic module's own dashboard, routes, and AI tools.
 *
 * The ignore list is applied when goals are read, as it is for page views, so
 * a caller records every goal and does not check the list itself.
 */

import type { IHttpRequest } from '../http/IHttpRequest.js';
import type { ITrafficGoal } from './ITrafficGoal.js';

/**
 * Records goal events against the visitor who sent a request.
 */
export interface ITrafficGoals {
    /**
     * Record that the visitor behind a request reached a goal. The traffic
     * module reads the visitor's analytics cookie, session, and network
     * details from the request itself, so the caller passes only what the goal
     * means.
     *
     * @param req - The incoming request from the visitor, as plugin and module
     *   route handlers receive it. Call this from the handler that serves the
     *   visitor's own request, never from a background job, or the goal is
     *   attributed to the wrong client.
     * @param goal - The goal's name and the properties to group it by.
     * @returns Resolves once the event is handed to the analytics store. Rejects
     *   when the goal breaks the naming rules on `ITrafficGoal`. Resolves
     *   without recording when the analytics store is not configured.
     */
    recordGoal(req: IHttpRequest, goal: ITrafficGoal): Promise<void>;
}
