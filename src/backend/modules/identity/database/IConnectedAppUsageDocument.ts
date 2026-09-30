/**
 * @fileoverview Storage shape for when each connected app was last used.
 *
 * Better Auth's OAuth tables record grants and tokens, but not when an app
 * last made a call, and working that out from the refresh-token history cost
 * one query per grant on every list. The identity module keeps its own row per
 * `(userId, clientId)` instead, written by `ConnectedAppsService.recordUse`
 * when the MCP endpoint accepts a request, so a list reads every value for a
 * page in one query.
 */

import type { ObjectId } from 'mongodb';

/**
 * Physical collection name. Uses the identity module's historical
 * `module_user_*` prefix, shared with `module_user_wallets` and
 * `module_user_settings`.
 */
export const CONNECTED_APP_USAGE_COLLECTION = 'module_user_connected_app_usage';

/**
 * One grant's last-use time. A unique `(userId, clientId)` index makes this the
 * single row for that grant; revoking the grant deletes it.
 */
export interface IConnectedAppUsageDocument {
    /** Mongo identity. */
    _id: ObjectId;

    /** Better Auth user id (opaque hex string) the grant belongs to. */
    userId: string;

    /** OAuth client id of the app. */
    clientId: string;

    /** When the app last made an accepted call, to within the write throttle. */
    lastUsedAt: Date;
}
