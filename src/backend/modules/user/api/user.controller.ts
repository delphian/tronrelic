import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { USER_FILTERS } from '@/types';
import type { ISystemLogService, UserFilterType, IUserGroupService } from '@/types';
import type { UserService, IUserStats, IDateRange } from '../services/index.js';
import type { GscService } from '../services/index.js';
import type { IUser, IUserPreferences } from '../database/index.js';
import { getClientIP, withAuthStatus } from '../services/index.js';
import { AnalyticsRangeValidationError } from '../services/user.errors.js';
import {
    setIdentityCookie,
    resolveIdentityFromCookies
} from './identity-cookie.js';

/** Maximum length for stored path values. */
const MAX_PATH_LENGTH = 500;

/**
 * Sanitize a URL path for storage.
 *
 * Ensures the value starts with '/', strips query strings and hash
 * fragments, and truncates to a safe length.
 *
 * @param raw - Raw path string from request body
 * @returns Sanitized path or undefined if invalid
 */
function sanitizePath(raw: unknown): string | undefined {
    if (typeof raw !== 'string') {
        return undefined;
    }
    let path = raw.trim();
    if (!path.startsWith('/')) {
        return undefined;
    }
    // Strip query string and hash fragment
    const qIdx = path.indexOf('?');
    if (qIdx !== -1) {
        path = path.slice(0, qIdx);
    }
    const hIdx = path.indexOf('#');
    if (hIdx !== -1) {
        path = path.slice(0, hIdx);
    }
    return path.slice(0, MAX_PATH_LENGTH) || undefined;
}

/**
 * Controller for user module REST API endpoints.
 *
 * Handles HTTP requests for user identity, wallet linking, preferences,
 * and activity tracking. Public endpoints require cookie validation;
 * admin endpoints require admin token.
 *
 * Routes are mounted at:
 * - /api/user (public routes with cookie validation)
 * - /api/admin/users (admin routes with token auth)
 */
export class UserController {
    /**
     * Create a user controller.
     *
     * @param userService - Service for user operations
     * @param gscService - Google Search Console service for keyword data
     * @param logger - System log service for error tracking
     */
    constructor(
        private readonly userService: UserService,
        private readonly gscService: GscService,
        private readonly userGroupService: IUserGroupService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Send an `IUser` payload to the client decorated with the
     * server-computed `authStatus` snapshot.
     *
     * Centralizing the decoration here is the controller-side half of the
     * DRY admin-predicate fix: every cookie-holder-facing endpoint that
     * returns the *current* user (bootstrap, identity reads, wallet
     * mutations, preferences, login/logout) routes through this helper so
     * `userData.authStatus` arrives populated and the frontend
     * `SystemAuthGate` reads booleans instead of re-deriving admin status
     * from raw fields. Admin endpoints that return *other* users
     * (`getAnyUser`, `listUsers`) intentionally bypass this — those views
     * manage memberships directly through the group editor and don't gate
     * on per-row `authStatus`.
     */
    private async respondWithUser(res: Response, user: IUser): Promise<void> {
        res.json(await withAuthStatus(user, this.userGroupService));
    }

    /**
     * Variant for endpoints that wrap `IUser` inside a result envelope
     * (e.g. `connectWallet` returns `{ success, user, loginRequired }`).
     * Decorates `result.user` in place when present; passes the envelope
     * through unchanged when the user field is absent (the `loginRequired`
     * branch of `connectWallet` and similar negative-result shapes).
     */
    private async respondWithUserResult<T extends { user?: IUser }>(
        res: Response,
        result: T
    ): Promise<void> {
        if (result.user) {
            const decorated = await withAuthStatus(result.user, this.userGroupService);
            res.json({ ...result, user: decorated });
            return;
        }
        res.json(result);
    }

    // ============================================================================
    // Middleware
    // ============================================================================

    /**
     * Cookie validation middleware.
     *
     * Ensures the request cookie matches the :id parameter. This prevents
     * UUID enumeration and ensures users can only access their own data.
     *
     * Identity resolution flows through the shared
     * `resolveIdentityFromCookies` helper, which applies the canonical
     * signed-first / unsigned-fallback policy documented in the User
     * Module README. Legacy unsigned holders are upgraded on the
     * response — mirroring `userContextMiddleware` — so that any HTTP
     * entry point a non-browser caller might use re-anchors the cookie
     * as signed on the first authenticated call. Without that the
     * unsigned fallback would be a permanent shadow path for clients
     * that bypass `/api/user/bootstrap`.
     *
     * @param req - Express request
     * @param res - Express response
     * @param next - Express next function
     */
    validateCookie(req: Request, res: Response, next: NextFunction): void {
        const resolved = resolveIdentityFromCookies(req);

        if (!resolved) {
            res.status(401).json({
                error: 'Unauthorized',
                message: 'Missing identity cookie'
            });
            return;
        }

        if (resolved.userId !== req.params.id) {
            res.status(403).json({
                error: 'Forbidden',
                message: 'Cookie does not match requested user ID'
            });
            return;
        }

        // Upgrade legacy unsigned cookies on every authenticated call so
        // the grace-window fallback is genuinely temporary. The signed
        // path is a no-op here. The info log gives operators a signal
        // they can use to (a) decide when the grace window has decayed
        // far enough to remove the fallback, and (b) flag anomalous
        // patterns — every legacy-fallback hit is also the shape of a
        // forged-UUID attempt, so volume spikes or repeated UUIDs from
        // one IP deserve attention.
        if (!resolved.signed) {
            setIdentityCookie(res, resolved.userId);
            this.logger.info(
                {
                    event: 'legacy_cookie_upgraded',
                    site: 'validateCookie',
                    userId: resolved.userId,
                    path: req.path,
                    ip: getClientIP(req)
                },
                'Legacy unsigned identity cookie accepted; re-anchored as signed'
            );
        }

        next();
    }

    // ============================================================================
    // Public User Endpoints (require cookie validation)
    // ============================================================================

    /**
     * GET /api/user/:id
     *
     * Get user by UUID. Creates user if not exists.
     *
     * Requires: Cookie must match :id
     * Response: IUser
     */
    async getUser(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            const user = await this.userService.getOrCreate(id);

            await this.respondWithUser(res, user);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to get user');
            res.status(400).json({
                error: 'Failed to get user',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/user/bootstrap
     *
     * Idempotent identity bootstrap. The server is the only writer of the
     * `tronrelic_uid` cookie. This endpoint is the canonical entry point
     * for first-time visitors and the safe no-op for returning visitors.
     *
     * Behavior:
     * - Cookie present and valid → resolve to canonical user (follows merge
     *   pointers), refresh the cookie's max-age, return the user.
     * - Cookie absent, malformed, or pointing to a never-created UUID →
     *   mint a fresh UUID v4, create the user record, set the HttpOnly
     *   cookie, return the new user.
     *
     * No `:id` parameter — the server resolves identity entirely from the
     * cookie or mints one. Clients that ran in this environment with the
     * legacy JS-minted cookie continue to work; the response refreshes the
     * cookie with HttpOnly so the upgrade is transparent on next visit.
     *
     * Response: IUser
     */
    async bootstrap(req: Request, res: Response): Promise<void> {
        try {
            // The shared resolver applies the signed-first / unsigned-
            // fallback policy and validates UUID v4 format in one step.
            // Forged signed cookies and malformed values both collapse to
            // null here, which we treat as "no existing identity" and
            // mint fresh. setIdentityCookie below re-anchors any unsigned
            // fallback as signed on the response.
            const resolved = resolveIdentityFromCookies(req);
            const isValidExisting = resolved !== null;
            const candidateId = resolved?.userId ?? randomUUID();

            // getOrCreate resolves merge pointers, so a stale cookie that
            // points at a tombstone returns the canonical user. The returned
            // id is what we re-anchor the cookie to.
            const user = await this.userService.getOrCreate(candidateId);

            // Always set the cookie on the response. For a returning visitor
            // this refreshes max-age and rewrites the legacy JS-minted cookie
            // to HttpOnly. For a new visitor it's the initial mint. For a
            // merged identity it points the cookie at the canonical user.
            setIdentityCookie(res, user.id);

            // Surface unsigned-cookie upgrades as info-level so operators
            // can track legacy-cookie decay and flag anomalous patterns.
            // See validateCookie's matching log for the security rationale.
            if (resolved && !resolved.signed) {
                this.logger.info(
                    {
                        event: 'legacy_cookie_upgraded',
                        site: 'bootstrap',
                        userId: user.id,
                        ip: getClientIP(req)
                    },
                    'Legacy unsigned identity cookie accepted; re-anchored as signed'
                );
            }

            this.logger.debug(
                { userId: user.id, minted: !isValidExisting, merged: user.id !== candidateId },
                'User identity bootstrapped'
            );
            await this.respondWithUser(res, user);
        } catch (error) {
            this.logger.error({ error }, 'Failed to bootstrap user identity');
            res.status(500).json({
                error: 'Failed to bootstrap user identity',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/user/:id/wallet/connect
     *
     * Register a wallet to a user identity (no signature required).
     *
     * Stage 1 of the two-stage wallet flow: stores the address with
     * `verified: false`, moving the user from *anonymous* to *registered*.
     * Use `linkWallet` (stage 2) to upgrade the wallet to *verified*.
     *
     * When the wallet is already linked to another user, returns:
     * `{ success: false, loginRequired: true, existingUserId: '...' }`.
     * Frontend should then prompt for signature verification to log in
     * as that existing owner.
     *
     * Requires: Cookie must match :id
     * Body: { address }
     * Response: IConnectWalletResult
     */
    async connectWallet(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const { address } = req.body;

            if (!address) {
                res.status(400).json({
                    error: 'Missing required field',
                    message: 'Request must include address'
                });
                return;
            }

            const result = await this.userService.connectWallet(id, address);

            if (result.loginRequired) {
                // Wallet belongs to another user - frontend should prompt for login
                this.logger.info({ userId: id, wallet: address }, 'Wallet requires login via API');
                await this.respondWithUserResult(res, result);
                return;
            }

            this.logger.info({ userId: id, wallet: address }, 'Wallet registered via API');
            await this.respondWithUserResult(res, result);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to connect wallet');
            res.status(400).json({
                error: 'Failed to connect wallet',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/user/:id/wallet
     *
     * Verify a wallet on a user identity (cryptographic signature required).
     *
     * Stage 2 of the two-stage wallet flow: verifies wallet ownership via
     * TronLink signature against a server-issued nonce. If the wallet was
     * previously registered (`verified: false`), upgrades it to
     * `verified: true`. Either way the user transitions into the *verified*
     * state.
     *
     * If the wallet belongs to another user, performs identity swap and
     * returns `{ user: IUser, identitySwapped: true, previousUserId: '...' }`.
     * In that case the server rewrites the HttpOnly identity cookie to the
     * new user ID via Set-Cookie. The client cannot write this cookie; it
     * should reload or re-bootstrap application state. This is the
     * cross-browser login path for *verified* users.
     *
     * Requires: Cookie must match :id, fresh nonce from
     *           POST /api/user/:id/wallet/challenge with action=link
     * Body: { address, message, signature, nonce }
     * Response: ILinkWalletResult
     */
    async linkWallet(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const { address, message, signature, nonce } = req.body;

            if (!address || !message || !signature || !nonce) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'Request must include address, message, signature, and nonce'
                });
                return;
            }

            const result = await this.userService.linkWallet(id, {
                address,
                message,
                signature,
                nonce
            });

            if (result.identitySwapped) {
                // Re-anchor the HttpOnly cookie to the winner's UUID. The
                // client can no longer write this cookie itself; without
                // this Set-Cookie the next request would still arrive under
                // the loser's stale id and the backend's merge-pointer
                // resolution would silently redirect each call.
                setIdentityCookie(res, result.user.id);
                this.logger.info(
                    { previousUserId: result.previousUserId, newUserId: result.user.id, wallet: address },
                    'Identity swapped via wallet login'
                );
            } else {
                this.logger.info({ userId: id, wallet: address }, 'Wallet verified via API');
            }

            await this.respondWithUserResult(res, result);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to link wallet');
            res.status(400).json({
                error: 'Failed to link wallet',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * DELETE /api/user/:id/wallet/:address
     *
     * Unlink a wallet from user identity.
     *
     * Requires: Cookie must match :id, fresh nonce from
     *           POST /api/user/:id/wallet/challenge with action=unlink
     * Body: { message, signature, nonce }
     * Response: IUser
     */
    async unlinkWallet(req: Request, res: Response): Promise<void> {
        try {
            const { id, address } = req.params;
            const { message, signature, nonce } = req.body;

            if (!message || !signature || !nonce) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'Request must include message, signature, and nonce'
                });
                return;
            }

            const user = await this.userService.unlinkWallet(id, address, message, signature, nonce);

            this.logger.info({ userId: id, wallet: address }, 'Wallet unlinked via API');
            await this.respondWithUser(res, user);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to unlink wallet');
            res.status(400).json({
                error: 'Failed to unlink wallet',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * PATCH /api/user/:id/wallet/:address/primary
     *
     * Set a wallet as primary. Step-up authentication: the cookie alone is
     * insufficient because it is XSS-stealable, and the primary wallet drives
     * downstream attribution (referrals, public profile, plugin reads).
     * Requires a fresh nonce from `POST /api/user/:id/wallet/challenge`
     * with `action: 'set-primary'` and a TronLink signature over the
     * canonical message bound to that nonce.
     *
     * Body: { message, signature, nonce }
     * Response: IUser
     */
    async setPrimaryWallet(req: Request, res: Response): Promise<void> {
        try {
            const { id, address } = req.params;
            const { message, signature, nonce } = req.body;

            if (!message || !signature || !nonce) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'Request must include message, signature, and nonce'
                });
                return;
            }

            const user = await this.userService.setPrimaryWallet(id, address, message, signature, nonce);

            this.logger.debug({ userId: id, wallet: address }, 'Primary wallet set via API');
            await this.respondWithUser(res, user);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to set primary wallet');
            res.status(400).json({
                error: 'Failed to set primary wallet',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/user/:id/wallet/:address/refresh-verification
     *
     * Refresh the freshness clock on an already-linked, already-verified
     * wallet. Used by the dual-track admin recovery flow when the
     * cookie-resolved user is in the admin group with a verified wallet
     * but every wallet's `verifiedAt` is older than the freshness window.
     *
     * Requires a fresh nonce from `POST /api/user/:id/wallet/challenge`
     * with `action: 'refresh-verification'` and a TronLink signature
     * over the canonical message bound to that nonce. The nonce scope
     * (action+address+userId) prevents a captured `link` or `set-primary`
     * signature from being replayed against this endpoint.
     *
     * Refuses to operate on registered (unverified) wallets — moving a
     * wallet from registered → verified is the link path's job. Stale
     * users with no verified wallets must complete a full link flow.
     *
     * Requires: Cookie must match :id
     * Body: { message, signature, nonce }
     * Response: IUser
     */
    async refreshWalletVerification(req: Request, res: Response): Promise<void> {
        try {
            const { id, address } = req.params;
            const { message, signature, nonce } = req.body;

            if (!message || !signature || !nonce) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'Request must include message, signature, and nonce'
                });
                return;
            }

            const user = await this.userService.refreshWalletVerification(id, address, message, signature, nonce);

            this.logger.info({ userId: id, wallet: address }, 'Wallet verification refreshed via API');
            await this.respondWithUser(res, user);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to refresh wallet verification');
            res.status(400).json({
                error: 'Failed to refresh wallet verification',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/user/:id/wallet/challenge
     *
     * Mint a server-issued single-use challenge for a wallet operation.
     *
     * The client sends `(action, address)` and receives a 60-second nonce
     * plus the canonical message to sign with TronLink. Submitting the
     * signature back to the matching wallet endpoint atomically consumes
     * the nonce. Replaces the legacy 5-minute client-timestamp window.
     *
     * Body: { action: 'link' | 'unlink' | 'set-primary' | 'refresh-verification', address }
     * Response: IWalletChallenge { nonce, message, expiresAt }
     */
    async issueWalletChallenge(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const { action, address } = req.body;

            if (!action || !address) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'Request must include action and address'
                });
                return;
            }

            if (action !== 'link' && action !== 'unlink' && action !== 'set-primary' && action !== 'refresh-verification') {
                res.status(400).json({
                    error: 'Invalid action',
                    message: 'action must be one of: link, unlink, set-primary, refresh-verification'
                });
                return;
            }

            const challenge = await this.userService.issueWalletChallenge(id, action, address);

            res.json(challenge);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to issue wallet challenge');
            res.status(400).json({
                error: 'Failed to issue wallet challenge',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * PATCH /api/user/:id/preferences
     *
     * Update user preferences.
     *
     * Requires: Cookie must match :id
     * Body: Partial<IUserPreferences>
     * Response: IUser
     */
    async updatePreferences(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const preferences = req.body as Partial<IUserPreferences>;

            if (!preferences || typeof preferences !== 'object') {
                res.status(400).json({
                    error: 'Invalid request body',
                    message: 'Body must be a preferences object'
                });
                return;
            }

            const user = await this.userService.updatePreferences(id, preferences);

            await this.respondWithUser(res, user);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to update preferences');
            res.status(400).json({
                error: 'Failed to update preferences',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/user/:id/activity
     *
     * Record user activity (page view).
     *
     * Requires: Cookie must match :id
     * Response: { success: true }
     *
     * @deprecated Use POST /api/user/:id/session/page for session-aware tracking
     */
    async recordActivity(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            await this.userService.recordActivity(id);

            res.json({ success: true });
        } catch (error) {
            // Don't fail on activity recording errors
            this.logger.warn({ error, userId: req.params.id }, 'Failed to record activity');
            res.json({ success: true });
        }
    }

    // ============================================================================
    // Session Tracking Endpoints (require cookie validation)
    // ============================================================================

    /**
     * POST /api/user/:id/session/start
     *
     * Start a new session or return the active session.
     * Device, country, and referrer are derived from request headers.
     *
     * Requires: Cookie must match :id
     * Response: { session: IUserSession }
     */
    async startSession(req: Request, res: Response): Promise<void> {
        try {
            // The controller's job is just HTTP shape: pull request fields,
            // hand them to the service, return the result. UTM truncation,
            // empty-UTM detection, and body-vs-header referrer priority
            // (with internal-domain filtering) all live in `UserService`
            // so any future caller gets identical behaviour.
            const session = await this.userService.startSession({
                userId: req.params.id,
                clientIP: getClientIP(req),
                userAgent: typeof req.headers['user-agent'] === 'string'
                    ? req.headers['user-agent']
                    : undefined,
                screenWidth: typeof req.body.screenWidth === 'number'
                    ? req.body.screenWidth
                    : undefined,
                landingPage: sanitizePath(req.body.landingPage),
                rawUtm: req.body.utm,
                bodyReferrer: typeof req.body.referrer === 'string'
                    ? req.body.referrer
                    : undefined,
                headerReferrer: typeof req.headers['referer'] === 'string'
                    ? req.headers['referer']
                    : undefined
            });

            res.json({ session });
        } catch (error) {
            this.logger.warn({ error, userId: req.params.id }, 'Failed to start session');
            res.status(400).json({
                error: 'Failed to start session',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/user/:id/session/page
     *
     * Record a page visit in the current session.
     *
     * Requires: Cookie must match :id
     * Body: { path: string }
     * Response: { success: true }
     */
    async recordPage(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const path = sanitizePath(req.body.path);

            if (!path) {
                res.status(400).json({
                    error: 'Invalid request',
                    message: 'Body must include a valid path starting with /'
                });
                return;
            }

            await this.userService.recordPage(id, path);

            res.json({ success: true });
        } catch (error) {
            // Non-critical - don't fail the request
            this.logger.warn({ error, userId: req.params.id }, 'Failed to record page');
            res.json({ success: true });
        }
    }

    /**
     * POST /api/user/:id/session/heartbeat
     *
     * Update session heartbeat to extend duration tracking.
     * Should be called periodically (e.g., every 30 seconds).
     *
     * Requires: Cookie must match :id
     * Response: { success: true }
     */
    async heartbeat(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            await this.userService.heartbeat(id);

            res.json({ success: true });
        } catch (error) {
            // Non-critical - don't fail the request
            this.logger.warn({ error, userId: req.params.id }, 'Failed to record heartbeat');
            res.json({ success: true });
        }
    }

    /**
     * POST /api/user/:id/session/end
     *
     * End the current session explicitly.
     * Called when user navigates away or closes the page.
     *
     * Requires: Cookie must match :id
     * Response: { success: true }
     */
    async endSession(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            await this.userService.endSession(id);

            res.json({ success: true });
        } catch (error) {
            // Non-critical - don't fail the request
            this.logger.warn({ error, userId: req.params.id }, 'Failed to end session');
            res.json({ success: true });
        }
    }

    // ============================================================================
    // Referral Endpoints (require cookie validation)
    // ============================================================================

    /**
     * GET /api/user/:id/referral
     *
     * Get referral code and stats for the authenticated user.
     * Returns `{ referral: null }` if the user has no referral code yet —
     * codes are issued at the moment of transition into the *verified*
     * identity state, so *anonymous* and *registered* users have none.
     *
     * Requires: Cookie must match :id
     * Response: { code, referredCount, convertedCount } or { referral: null }
     */
    async getReferralStats(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            const stats = await this.userService.getReferralStats(id);

            if (!stats) {
                res.json({ referral: null });
                return;
            }

            res.json(stats);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to get referral stats');
            res.status(500).json({
                error: 'Failed to get referral stats',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    // ============================================================================
    // Logout Endpoint (requires cookie validation)
    // ============================================================================

    /**
     * POST /api/user/:id/logout
     *
     * End the user's verified session. Downgrades `identityState` to
     * Registered (or Anonymous when no wallets remain) and clears
     * `identityVerifiedAt`. Wallets, preferences, and the cookie all
     * survive. To re-establish a session, sign with a wallet you
     * have previously verified.
     *
     * Requires: Cookie must match :id
     * Response: IUser
     */
    async logout(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            const user = await this.userService.logout(id);

            this.logger.info({ userId: id }, 'User logged out via API');
            await this.respondWithUser(res, user);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to log out user');
            res.status(400).json({
                error: 'Failed to log out',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    // ============================================================================
    // Public Profile Endpoints (no authentication required)
    // ============================================================================

    /**
     * GET /api/profile/:address
     *
     * Get public profile by wallet address. Profiles only resolve when the
     * address belongs to a user in the *verified* identity state — i.e. that
     * specific wallet has `verified: true`.
     *
     * Returns 404 if:
     * - No user has this wallet linked, OR
     * - The wallet is registered (unsigned) — owner is *registered*, not *verified*.
     *
     * The endpoint never returns the owning user's UUID. Ownership is computed
     * server-side from the visitor's `tronrelic_uid` cookie (populated onto
     * `req.userId` by `userContextMiddleware`) and exposed as `isOwner: boolean`.
     * This closes a wallet-address → UUID lookup oracle: previously knowing an
     * admin's wallet was enough to retrieve their UUID, which combined with the
     * unsigned identity cookie made admin impersonation possible.
     *
     * Response: { address: string, createdAt: Date, isVerified: true, isOwner: boolean }
     */
    async getProfile(req: Request, res: Response): Promise<void> {
        try {
            const { address } = req.params;

            if (!address) {
                res.status(400).json({
                    error: 'Missing required parameter',
                    message: 'Address is required'
                });
                return;
            }

            const profile = await this.userService.getPublicProfile(address, req.userId);

            if (!profile) {
                res.status(404).json({
                    error: 'Profile not found',
                    message: 'This wallet address is not verified or is not linked to any user.'
                });
                return;
            }

            res.json(profile);
        } catch (error) {
            this.logger.error({ error, address: req.params.address }, 'Failed to get profile');
            res.status(500).json({
                error: 'Failed to get profile',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    // ============================================================================
    // Admin Endpoints (require admin token)
    // ============================================================================

    /**
     * GET /api/admin/users
     *
     * List all users with pagination and optional filtering.
     *
     * Query parameters:
     * - limit: Maximum results (default: 50)
     * - skip: Skip results for pagination (default: 0)
     * - search: Search by UUID or wallet address
     * - filter: Filter by predefined criteria (e.g., 'power-users', 'anonymous', 'verified')
     *
     * Filter and search work additively (AND logic). Applying a filter
     * narrows the user set, then search refines within filtered results.
     *
     * Response: { users: IUser[], total: number, filteredTotal: number, stats: IUserStats }
     */
    async listUsers(req: Request, res: Response): Promise<void> {
        try {
            const { limit, skip, search, filter } = req.query;

            // Validate and clamp pagination parameters
            const parsedLimit = limit ? parseInt(limit as string, 10) : 50;
            const parsedSkip = skip ? parseInt(skip as string, 10) : 0;
            const limitNum = Number.isNaN(parsedLimit) ? 50 : Math.min(Math.max(1, parsedLimit), 100);
            const skipNum = Number.isNaN(parsedSkip) ? 0 : Math.max(0, parsedSkip);

            // Validate filter type (USER_FILTERS is the single source of truth)
            const filterType = (filter as string) || 'all';
            if (!USER_FILTERS.includes(filterType as UserFilterType)) {
                res.status(400).json({ error: 'Invalid filter type' });
                return;
            }

            // Use filterUsers which handles both filter and search with AND logic
            const { users, filteredTotal } = await this.userService.filterUsers(
                filterType as UserFilterType,
                limitNum,
                skipNum,
                search as string | undefined
            );

            const [total, stats] = await Promise.all([
                this.userService.countUsers(),
                this.userService.getStats()
            ]);

            res.json({ users, total, filteredTotal, stats });
        } catch (error) {
            this.logger.error({ error }, 'Failed to list users');
            res.status(500).json({
                error: 'Failed to list users',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * GET /api/admin/users/stats
     *
     * Get user statistics summary.
     *
     * Response: IUserStats
     */
    async getStats(req: Request, res: Response): Promise<void> {
        try {
            const stats = await this.userService.getStats();

            res.json(stats);
        } catch (error) {
            this.logger.error({ error }, 'Failed to get user stats');
            res.status(500).json({
                error: 'Failed to get user stats',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * GET /api/admin/users/analytics/daily-visitors
     *
     * Get daily unique visitor counts for charting.
     *
     * Query parameters:
     * - days: Number of days to look back (default: 90, max: 365)
     *
     * Response: { data: [{ date: string, count: number }] }
     */
    async getDailyVisitors(req: Request, res: Response): Promise<void> {
        try {
            const { days } = req.query;
            const parsedDays = days ? parseInt(days as string, 10) : 90;
            const daysNum = Number.isNaN(parsedDays) ? 90 : Math.min(Math.max(1, parsedDays), 365);

            const data = await this.userService.getDailyVisitorCounts(daysNum);

            res.json({ data });
        } catch (error) {
            this.logger.error({ error }, 'Failed to get daily visitor analytics');
            res.status(500).json({
                error: 'Failed to get daily visitor analytics',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * GET /api/admin/users/analytics/visitor-origins
     *
     * Get visitor traffic origins from first-ever sessions.
     *
     * Query parameters:
     * - period: Lookback period ('24h', '7d', '30d', '90d', default: '24h'), or omit with startDate/endDate
     * - startDate: Custom range start (ISO string, e.g. '2026-03-01T00:00:00.000Z')
     * - endDate: Custom range end (ISO string, e.g. '2026-03-07T23:59:59.999Z')
     * - limit: Maximum results (default: 50, max: 100)
     * - skip: Pagination offset (default: 0)
     *
     * Response: { visitors: IVisitorOrigin[], total: number }
     */
    async getVisitorOrigins(req: Request, res: Response): Promise<void> {
        try {
            const { limit, skip } = req.query;

            const range = this.parseDateRange(req.query, '24h');

            const parsedLimit = limit ? parseInt(limit as string, 10) : 50;
            const parsedSkip = skip ? parseInt(skip as string, 10) : 0;
            const limitNum = Number.isNaN(parsedLimit) ? 50 : Math.min(Math.max(1, parsedLimit), 100);
            const skipNum = Number.isNaN(parsedSkip) ? 0 : Math.max(0, parsedSkip);

            const result = await this.userService.getVisitorOrigins(range, limitNum, skipNum);

            res.json(result);
        } catch (error) {
            this.logger.error({ error }, 'Failed to get visitor origins');
            res.status(500).json({
                error: 'Failed to get visitor origins',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * GET /api/admin/users/analytics/new-users
     *
     * Get users first seen within the specified period, sorted by firstSeen
     * descending (most recent first). Unlike visitor-origins which filters by
     * lastSeen (recent activity), this filters by firstSeen (new arrivals).
     *
     * Query parameters:
     * - period: Lookback period ('24h', '7d', '30d', '90d', default: '24h'), or omit with startDate/endDate
     * - startDate: Custom range start (ISO string, e.g. '2026-03-01T00:00:00.000Z')
     * - endDate: Custom range end (ISO string, e.g. '2026-03-07T23:59:59.999Z')
     * - limit: Maximum results (default: 50, max: 100)
     * - skip: Pagination offset (default: 0)
     *
     * Response: { visitors: IVisitorOrigin[], total: number }
     */
    async getNewUsers(req: Request, res: Response): Promise<void> {
        try {
            const { limit, skip } = req.query;

            const range = this.parseDateRange(req.query, '24h');

            const parsedLimit = limit ? parseInt(limit as string, 10) : 50;
            const parsedSkip = skip ? parseInt(skip as string, 10) : 0;
            const limitNum = Number.isNaN(parsedLimit) ? 50 : Math.min(Math.max(1, parsedLimit), 100);
            const skipNum = Number.isNaN(parsedSkip) ? 0 : Math.max(0, parsedSkip);

            const result = await this.userService.getNewUsers(range, limitNum, skipNum);

            res.json(result);
        } catch (error) {
            this.logger.error({ error }, 'Failed to get new users');
            res.status(500).json({
                error: 'Failed to get new users',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    // ============================================================================
    // Aggregate Analytics Endpoints (require admin token)
    // ============================================================================

    /**
     * Resolve an analytics date range from Express query params.
     *
     * Pure HTTP-layer adapter: narrows `req.query` (whose values are
     * `string | string[] | undefined`) into the typed `IAnalyticsRangeQuery`
     * shape and delegates to `UserService.resolveAnalyticsRange`. The period
     * vocabulary, the `startDate >= endDate` validation, and the default
     * window all live in the service.
     */
    private parseDateRange(query: Record<string, any>, defaultPeriod: string = '30d'): IDateRange {
        return this.userService.resolveAnalyticsRange(
            {
                period:    typeof query.period    === 'string' ? query.period    : undefined,
                startDate: typeof query.startDate === 'string' ? query.startDate : undefined,
                endDate:   typeof query.endDate   === 'string' ? query.endDate   : undefined
            },
            defaultPeriod
        );
    }

    /**
     * Wrap an analytics request with standard error handling.
     *
     * Centralizes try/catch, error logging, and JSON error response
     * for all aggregate analytics endpoints.
     *
     * @param res - Express response
     * @param logic - Async function that produces the response data
     * @param errorMessage - Message for logging and error response
     */
    private async handleAnalyticsRequest<T>(
        res: Response,
        logic: () => Promise<T>,
        errorMessage: string
    ): Promise<void> {
        try {
            const result = await logic();
            res.json(result);
        } catch (error) {
            // Client supplied an invalid date range — surface as 400, not 500.
            if (error instanceof AnalyticsRangeValidationError) {
                res.status(400).json({ error: 'BadRequest', message: error.message });
                return;
            }
            this.logger.error({ error }, errorMessage);
            res.status(500).json({
                error: errorMessage,
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Parse a limit query parameter with bounds clamping.
     *
     * @param raw - Raw query string value
     * @param defaultVal - Default when not provided
     * @param max - Maximum allowed value
     * @returns Clamped integer
     */
    private parseLimit(raw: string | undefined, defaultVal: number, max: number): number {
        if (!raw) return defaultVal;
        const parsed = parseInt(raw, 10);
        return Number.isNaN(parsed) ? defaultVal : Math.min(Math.max(1, parsed), max);
    }

    /**
     * GET /api/admin/users/analytics/traffic-sources
     *
     * Get aggregate traffic source breakdown.
     *
     * Query parameters:
     * - period: '24h' | '7d' | '30d' | '90d' (default: '30d'), or omit with startDate/endDate
     * - startDate: Custom range start (ISO string)
     * - endDate: Custom range end (ISO string)
     *
     * Response: { sources: [...], total: number }
     */
    async getTrafficSources(req: Request, res: Response): Promise<void> {
        await this.handleAnalyticsRequest(res, () => {
            const range = this.parseDateRange(req.query);
            return this.userService.getTrafficSources(range);
        }, 'Failed to get traffic sources');
    }

    /**
     * GET /api/admin/users/analytics/traffic-source-details
     *
     * Get detailed breakdown for a specific traffic source.
     *
     * Query parameters:
     * - source: referrer domain (e.g. 'duckduckgo.com', 'direct') (required)
     * - period: '24h' | '7d' | '30d' | '90d' (default: '30d'), or omit with startDate/endDate
     * - startDate: Custom range start (ISO string)
     * - endDate: Custom range end (ISO string)
     *
     * Response: { source, visitors, landingPages, countries, devices, utmCampaigns, searchKeywords, engagement, conversion }
     */
    async getTrafficSourceDetails(req: Request, res: Response): Promise<void> {
        const source = req.query.source as string;
        if (!source) {
            res.status(400).json({ error: 'Missing required query parameter: source' });
            return;
        }
        await this.handleAnalyticsRequest(res, () => {
            const range = this.parseDateRange(req.query);
            return this.userService.getTrafficSourceDetails(source, range);
        }, 'Failed to get traffic source details');
    }

    /**
     * GET /api/admin/users/analytics/top-landing-pages
     *
     * Get top landing pages by visitor count.
     *
     * Query parameters:
     * - period: '24h' | '7d' | '30d' | '90d' (default: '30d'), or omit with startDate/endDate
     * - startDate: Custom range start (ISO string)
     * - endDate: Custom range end (ISO string)
     * - limit: max results (default: 20, max: 50)
     *
     * Response: { pages: [...], total: number }
     */
    async getTopLandingPages(req: Request, res: Response): Promise<void> {
        await this.handleAnalyticsRequest(res, () => {
            const range = this.parseDateRange(req.query);
            const limit = this.parseLimit(req.query.limit as string, 20, 50);
            return this.userService.getTopLandingPages(range, limit);
        }, 'Failed to get top landing pages');
    }

    /**
     * GET /api/admin/users/analytics/geo-distribution
     *
     * Get geographic distribution of visitors.
     *
     * Query parameters:
     * - period: '24h' | '7d' | '30d' | '90d' (default: '30d'), or omit with startDate/endDate
     * - startDate: Custom range start (ISO string)
     * - endDate: Custom range end (ISO string)
     * - limit: max countries (default: 30, max: 100)
     *
     * Response: { countries: [...], total: number }
     */
    async getGeoDistribution(req: Request, res: Response): Promise<void> {
        await this.handleAnalyticsRequest(res, () => {
            const range = this.parseDateRange(req.query);
            const limit = this.parseLimit(req.query.limit as string, 30, 100);
            return this.userService.getGeoDistribution(range, limit);
        }, 'Failed to get geo distribution');
    }

    /**
     * GET /api/admin/users/analytics/device-breakdown
     *
     * Get device and screen size breakdown.
     *
     * Query parameters:
     * - period: '24h' | '7d' | '30d' | '90d' (default: '30d'), or omit with startDate/endDate
     * - startDate: Custom range start (ISO string)
     * - endDate: Custom range end (ISO string)
     *
     * Response: { devices: [...], screenSizes: [...], total: number }
     */
    async getDeviceBreakdown(req: Request, res: Response): Promise<void> {
        await this.handleAnalyticsRequest(res, () => {
            const range = this.parseDateRange(req.query);
            return this.userService.getDeviceBreakdown(range);
        }, 'Failed to get device breakdown');
    }

    /**
     * GET /api/admin/users/analytics/campaign-performance
     *
     * Get UTM campaign performance with conversion rates.
     *
     * Query parameters:
     * - period: '24h' | '7d' | '30d' | '90d' (default: '30d'), or omit with startDate/endDate
     * - startDate: Custom range start (ISO string)
     * - endDate: Custom range end (ISO string)
     * - limit: max campaigns (default: 20, max: 50)
     *
     * Response: { campaigns: [...], total: number }
     */
    async getCampaignPerformance(req: Request, res: Response): Promise<void> {
        await this.handleAnalyticsRequest(res, () => {
            const range = this.parseDateRange(req.query);
            const limit = this.parseLimit(req.query.limit as string, 20, 50);
            return this.userService.getCampaignPerformance(range, limit);
        }, 'Failed to get campaign performance');
    }

    /**
     * GET /api/admin/users/analytics/engagement
     *
     * Get engagement metrics (avg duration, pages/session, bounce rate).
     *
     * Query parameters:
     * - period: '24h' | '7d' | '30d' | '90d' (default: '30d'), or omit with startDate/endDate
     * - startDate: Custom range start (ISO string)
     * - endDate: Custom range end (ISO string)
     *
     * Response: { avgSessionDuration, avgPagesPerSession, bounceRate, avgSessionsPerUser, totalUsers }
     */
    async getEngagementMetrics(req: Request, res: Response): Promise<void> {
        await this.handleAnalyticsRequest(res, () => {
            const range = this.parseDateRange(req.query);
            return this.userService.getEngagementMetrics(range);
        }, 'Failed to get engagement metrics');
    }

    /**
     * GET /api/admin/users/analytics/conversion-funnel
     *
     * Get conversion funnel (visitors → return → wallet → verified).
     *
     * Query parameters:
     * - period: '24h' | '7d' | '30d' | '90d' (default: '30d'), or omit with startDate/endDate
     * - startDate: Custom range start (ISO string)
     * - endDate: Custom range end (ISO string)
     *
     * Response: { stages: [...] }
     */
    async getConversionFunnel(req: Request, res: Response): Promise<void> {
        await this.handleAnalyticsRequest(res, () => {
            const range = this.parseDateRange(req.query);
            return this.userService.getConversionFunnel(range);
        }, 'Failed to get conversion funnel');
    }

    /**
     * GET /api/admin/users/analytics/retention
     *
     * Get new vs returning visitor breakdown over time.
     *
     * Query parameters:
     * - period: '24h' | '7d' | '30d' | '90d' (default: '30d'), or omit with startDate/endDate
     * - startDate: Custom range start (ISO string)
     * - endDate: Custom range end (ISO string)
     *
     * Response: { data: [{ date, newVisitors, returningVisitors }] }
     */
    async getRetention(req: Request, res: Response): Promise<void> {
        await this.handleAnalyticsRequest(res, () => {
            const range = this.parseDateRange(req.query);
            return this.userService.getRetention(range);
        }, 'Failed to get retention data');
    }

    /**
     * GET /api/admin/users/analytics/referral-overview
     *
     * Get aggregate referral program metrics.
     *
     * Query parameters:
     * - period: '24h' | '7d' | '30d' | '90d' (default: '30d'), or omit with startDate/endDate
     * - startDate: Custom range start (ISO string)
     * - endDate: Custom range end (ISO string)
     * - limit: max top referrers (default: 15, max: 50)
     *
     * Response: { totalReferrals, totalConverted, conversionRate, usersWithCodes, topReferrers, recentReferrals }
     */
    async getReferralOverview(req: Request, res: Response): Promise<void> {
        await this.handleAnalyticsRequest(res, () => {
            const range = this.parseDateRange(req.query);
            const limit = this.parseLimit(req.query.limit as string, 15, 50);
            return this.userService.getReferralOverview(range, limit);
        }, 'Failed to get referral overview');
    }

    /**
     * GET /api/admin/users/:id
     *
     * Get any user by UUID (admin bypass).
     *
     * Response: IUser or 404
     */
    async getAnyUser(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            const user = await this.userService.getById(id);

            if (!user) {
                res.status(404).json({ error: 'User not found' });
                return;
            }

            res.json(user);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to get user (admin)');
            res.status(500).json({
                error: 'Failed to get user',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    // ============================================================================
    // Google Search Console Endpoints
    // ============================================================================

    /**
     * GET /api/admin/users/analytics/gsc/status
     *
     * Get GSC configuration status (configured, site URL, last fetch).
     * Never exposes the raw service account key.
     */
    async getGscStatus(_req: Request, res: Response): Promise<void> {
        await this.handleAnalyticsRequest(res, () => {
            return this.gscService.getStatus();
        }, 'Failed to get GSC status');
    }

    /**
     * POST /api/admin/users/analytics/gsc/credentials
     *
     * Save GSC service account credentials and site URL.
     * Validates the JSON key and tests API access before saving.
     *
     * Body: { serviceAccountJson: string, siteUrl: string }
     */
    async saveGscCredentials(req: Request, res: Response): Promise<void> {
        const { serviceAccountJson, siteUrl } = req.body ?? {};

        if (!serviceAccountJson || typeof serviceAccountJson !== 'string') {
            res.status(400).json({ error: 'Missing required field: serviceAccountJson' });
            return;
        }
        if (!siteUrl || typeof siteUrl !== 'string') {
            res.status(400).json({ error: 'Missing required field: siteUrl' });
            return;
        }

        try {
            await this.gscService.saveCredentials(serviceAccountJson, siteUrl);
            const status = await this.gscService.getStatus();
            res.json(status);
        } catch (error) {
            this.logger.error({ error }, 'Failed to save GSC credentials');
            res.status(400).json({
                error: 'Failed to save GSC credentials',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * DELETE /api/admin/users/analytics/gsc/credentials
     *
     * Remove stored GSC credentials. Previously fetched data remains
     * until the TTL index cleans it up.
     */
    async removeGscCredentials(_req: Request, res: Response): Promise<void> {
        await this.handleAnalyticsRequest(res, async () => {
            await this.gscService.removeCredentials();
            return { success: true };
        }, 'Failed to remove GSC credentials');
    }

    /**
     * POST /api/admin/users/analytics/gsc/refresh
     *
     * Trigger an on-demand GSC data fetch. Returns the number of
     * rows fetched from the Search Console API.
     */
    async refreshGscData(_req: Request, res: Response): Promise<void> {
        await this.handleAnalyticsRequest(res, () => {
            return this.gscService.fetchAndStore();
        }, 'Failed to refresh GSC data');
    }
}
