/**
 * @fileoverview Self-service HTTP interface for a user's connected apps.
 *
 * Lets a signed-in user see which apps they have authorized through OAuth and
 * revoke any of them, and gives the `/oauth/authorize` page the details it
 * shows before the user approves an app. The user id always comes from the
 * Better Auth session, never from the request, so a user can only see and
 * revoke their own grants.
 */

import type { Request, Response } from 'express';
import type { IConnectedAppsService, IHasAuthSession, IOAuthConsentContext, ISystemLogService } from '@/types';
import { MCP_TOOLS_SCOPE, MCP_USERS_GROUP_ID, isInGroup, isLoggedIn } from '@/types';
import { hostOf, isLoopbackHost } from '../services/hostOf.js';

/** Public details of an OAuth client, as Better Auth returns them. */
export interface IPublicOAuthClient {
    client_id: string;
    client_name?: string;
    client_uri?: string;
}

/**
 * Looks up a client's public details for the consent screen. Injected so the
 * controller does not depend on the Better Auth instance directly. Returns
 * null when the client is unknown or its metadata document cannot be fetched.
 */
export type PublicClientLookup = (clientId: string, req: Request) => Promise<IPublicOAuthClient | null>;

/** Plain-language labels for scopes, shown on the consent screen. */
const SCOPE_LABELS: Record<string, string> = {
    [MCP_TOOLS_SCOPE]: 'Use the TronRelic tools an admin has made available to your AI client, as you',
    offline_access: 'Stay connected without asking you to sign in again, until you revoke it'
};

/**
 * Handlers for `/api/user/connected-apps` and `/api/user/oauth/authorize-context`.
 */
export class ConnectedAppsController {
    /**
     * @param connectedApps - The grant store.
     * @param lookupClient - Resolves a client's public details, fetching a
     *   client metadata document when the client id is a URL.
     * @param logger - Module logger.
     */
    constructor(
        private readonly connectedApps: IConnectedAppsService,
        private readonly lookupClient: PublicClientLookup,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * `GET /api/user/connected-apps` — the caller's connected apps.
     *
     * @param req - Carries the session.
     * @param res - Answers with `{ apps }`, or 401.
     */
    list = async (req: Request, res: Response): Promise<void> => {
        const userId = sessionUserId(req);
        if (!userId) {
            res.status(401).json({ success: false, error: 'Authentication required' });
        } else {
            res.json({ success: true, apps: await this.connectedApps.listForUser(userId) });
        }
    };

    /**
     * `DELETE /api/user/connected-apps?clientId=...` — revoke one of the
     * caller's apps. The client id travels in the query string because it is
     * often a URL, which does not fit in a path segment.
     *
     * @param req - Carries the session and the client id.
     * @param res - Answers 204, 400, 401, or 404.
     */
    revoke = async (req: Request, res: Response): Promise<void> => {
        const userId = sessionUserId(req);
        const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : '';
        if (!userId) {
            res.status(401).json({ success: false, error: 'Authentication required' });
        } else if (!clientId) {
            res.status(400).json({ success: false, error: 'clientId is required' });
        } else if (await this.connectedApps.revoke(userId, clientId)) {
            this.logger.info({ userId, clientId }, 'User revoked a connected app');
            res.status(204).end();
        } else {
            res.status(404).json({ success: false, error: 'No such connected app' });
        }
    };

    /**
     * `GET /api/user/oauth/authorize-context` — what the consent screen shows.
     * Query: `client_id`, `redirect_uri`, `scope`, copied from the signed
     * authorization query the page was opened with.
     *
     * The page is only a display. Better Auth has already matched the redirect
     * URI against the client's registered list before sending the user here,
     * and the consent POST re-verifies the signed query, so a hand-edited page
     * URL can mislead the display but can never produce an authorization code.
     *
     * @param req - Carries the session and the authorization parameters.
     * @param res - Answers with the consent context, or 400 / 401 / 404.
     */
    authorizeContext = async (req: Request, res: Response): Promise<void> => {
        const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : '';
        const redirectUri = typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri : '';
        const scope = typeof req.query.scope === 'string' ? req.query.scope : '';
        const redirectHost = hostOf(redirectUri);
        if (!sessionUserId(req)) {
            res.status(401).json({ success: false, error: 'Authentication required' });
        } else if (!clientId || !redirectHost) {
            res.status(400).json({ success: false, error: 'client_id and a valid redirect_uri are required' });
        } else {
            const client = await this.lookupClient(clientId, req);
            if (!client) {
                res.status(404).json({ success: false, error: 'This app could not be identified.' });
            } else {
                const scopes = scope.split(' ').filter(value => value.length > 0);
                const context: IOAuthConsentContext = {
                    clientId: client.client_id,
                    clientName: client.client_name || client.client_id,
                    ...(client.client_uri ? { clientUri: client.client_uri } : {}),
                    redirectHost,
                    loopbackOnly: isLoopbackHost(redirectHost),
                    scopes: scopes.map(value => ({ scope: value, label: SCOPE_LABELS[value] ?? value })),
                    permitted: isInGroup(req as unknown as IHasAuthSession, MCP_USERS_GROUP_ID)
                };
                res.json({ success: true, context });
            }
        }
    };
}

/**
 * Read the signed-in user's id from the resolved session.
 *
 * @param req - The request carrying `authSession`.
 * @returns The user id, or null when nobody is signed in.
 */
function sessionUserId(req: Request): string | null {
    const withSession = req as unknown as IHasAuthSession;
    return isLoggedIn(withSession) ? withSession.authSession.user.id : null;
}
