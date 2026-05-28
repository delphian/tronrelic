/**
 * @fileoverview Authorization facade — the only sanctioned surface for
 * "is this caller logged in / a member / an admin" checks across the
 * codebase.
 *
 * Plugins, modules, controllers, and middleware import the predicate
 * helpers exported here and never reach for `req.user`, Better Auth's
 * client API, or the GroupService directly. The single-surface rule
 * lets later phases swap the underlying mechanism — different session
 * backend, role/permission overlays, multi-tier admin — without
 * touching every call site.
 *
 * **Phase 2 wiring.** A new middleware (`auth-session.ts`) pre-resolves
 * the augmented session at the top of the request lifecycle and stores
 * it on `req.authSession` plus the per-request cache slot below. Once
 * the middleware lands, predicate calls inside route handlers are a
 * pure object read with no extra round-trip. The facade still falls
 * back to a direct resolve when no middleware ran — keeps unit tests,
 * test harnesses, and non-Express call sites working.
 */

import type { Request } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import { fromNodeHeaders } from 'better-auth/node';
import { logger } from '../../../lib/logger.js';
import { GroupService, ADMIN_GROUP_ID } from './group.service.js';
import type { Auth } from '../auth.js';

const facadeLogger = logger.child({ component: 'auth-facade' });

/**
 * Per-request cache key for the resolved augmented session.
 *
 * Symbol-typed so it never collides with a legitimate property on the
 * Express request object and remains invisible to callers that
 * enumerate request fields.
 */
const SESSION_CACHE_KEY: unique symbol = Symbol('auth-facade.session');

/**
 * Shape of a successful Better Auth session resolution.
 *
 * Derived from {@link Auth}'s `api.getSession` return type rather than
 * imported from BA's internals so a library version bump that tweaks
 * intermediate types won't break consumers.
 */
type ResolvedSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

/**
 * Augmented session shape consumed by the facade and the middleware.
 *
 * Wraps BA's session payload with the extra fields downstream
 * authorization needs — group membership and the user's primary
 * wallet. Augmentation happens once per request inside
 * {@link resolveSession}; both the middleware and any direct facade
 * call use the same cache slot, so the augmentation cost is one
 * round-trip per request, not per check.
 *
 * The `primaryWallet` field is reserved for Phase 4 wiring — until
 * the wallet store is in place it stays `undefined`.
 */
export interface IAugmentedSession {
    /**
     * Better Auth user record for this session, including the standard
     * `id` / `email` / `emailVerified` / `name` / `image` fields and
     * any `additionalFields` configured on the BA instance.
     */
    user: ResolvedSession['user'];

    /**
     * BA session metadata — token, expiresAt, ipAddress, userAgent.
     * Forwarded as-is.
     */
    session: ResolvedSession['session'];

    /**
     * Group ids this user belongs to, sourced from the BA user
     * record's `groups` additional field at resolve time.
     */
    groups: string[];

    /**
     * Primary TRON wallet address linked to the user, when one is set.
     * Sourced from the Better Auth user record's `primaryWallet`
     * additional field (Phase 4), which {@link WalletService} maintains
     * on every link / unlink / set-primary. `undefined` when the account
     * has no linked wallet.
     */
    primaryWallet?: string;
}

/**
 * Module-private auth instance reference.
 *
 * Set once at bootstrap by {@link setAuthInstance}; consumed by every
 * facade call that has to resolve a session directly. `null` until
 * configured — accessing the facade before bootstrap surfaces a clear
 * error rather than a silent false.
 */
let configuredAuth: Auth | null = null;

/**
 * Configure the facade with the application's auth instance.
 *
 * Called from `UserModule.init()` once the Better Auth instance has
 * been constructed. Subsequent calls overwrite the reference — useful
 * in test setup where the instance is rebuilt per suite.
 *
 * @param auth - Better Auth instance to use for session resolution.
 */
export function setAuthInstance(auth: Auth): void {
    configuredAuth = auth;
}

/**
 * Test-only escape hatch that clears the configured auth reference.
 *
 * @internal
 */
export function resetAuthInstanceForTests(): void {
    configuredAuth = null;
}

/**
 * Resolve the augmented session for a request.
 *
 * Public entry point exported for the auth-session middleware (which
 * calls it once at the top of every request to pre-populate the
 * cache) and for any tooling that needs the raw session object
 * outside the predicate functions. Predicate consumers
 * ({@link isLoggedIn}, {@link isInGroup}, etc.) call this internally.
 *
 * Returns `null` when no Better Auth session cookie is present, the
 * cookie is invalid, or the session has expired.
 *
 * @param req - Express request whose Better Auth cookies will be read.
 * @returns Promise resolving to the augmented session or null.
 */
export async function getSessionForRequest(req: Request): Promise<IAugmentedSession | null> {
    const result = await resolveSession(req);
    return result;
}

/**
 * Predicate: is the caller authenticated?
 *
 * Returns `true` when the request carries a Better Auth session
 * cookie that resolves to a live, non-expired session. Returns
 * `false` for anonymous callers — no cookie, expired cookie, or
 * tampered cookie. The complementary {@link isAnonymous} is provided
 * for readability so call sites don't pepper `!isLoggedIn` everywhere.
 *
 * @param req - Express request.
 * @returns Promise resolving to the logged-in predicate.
 */
export async function isLoggedIn(req: Request): Promise<boolean> {
    const session = await resolveSession(req);
    return session !== null;
}

/**
 * Predicate: is the caller anonymous?
 *
 * Inverse of {@link isLoggedIn}. Provided as its own export so call
 * sites read naturally — `if (await isAnonymous(req)) { ... }` is
 * clearer than `if (!await isLoggedIn(req))` at a glance.
 *
 * @param req - Express request.
 * @returns Promise resolving to the anonymous predicate.
 */
export async function isAnonymous(req: Request): Promise<boolean> {
    const loggedIn = await isLoggedIn(req);
    return !loggedIn;
}

/**
 * Predicate: is the caller a member of a given group?
 *
 * Anonymous callers always return `false` — group membership requires
 * a resolved Better Auth user id. Reads from the pre-augmented
 * `session.groups` array, so the underlying GroupService is only
 * consulted once per request (during augmentation in
 * {@link resolveSession}). Group ids are case-sensitive.
 *
 * @param req - Express request.
 * @param groupId - Group id to test.
 * @returns Promise resolving to the membership predicate.
 */
export async function isInGroup(req: Request, groupId: string): Promise<boolean> {
    const session = await resolveSession(req);
    const result = session !== null && session.groups.includes(groupId);
    return result;
}

/**
 * Predicate: is the caller an administrator?
 *
 * Sugar for {@link isInGroup} with the `admin` group id. Use this in
 * preference to `isInGroup(req, 'admin')` so a future rename or
 * compound check (e.g. layered admin tiers) needs to update only one
 * code path. Future tiers like `super-admin` are expected to remain
 * truthy under `isAdmin` — admin gates are inclusive of escalations.
 *
 * @param req - Express request.
 * @returns Promise resolving to the admin predicate.
 */
export async function isAdmin(req: Request): Promise<boolean> {
    const result = await isInGroup(req, ADMIN_GROUP_ID);
    return result;
}

/**
 * Resolve the augmented session for a request, with per-request caching.
 *
 * Caches the *in-flight Promise* on the request object under a private
 * Symbol, not the resolved object, so concurrent callers — e.g.
 * `Promise.all([isLoggedIn(req), isAdmin(req)])` — share a single
 * `auth.api.getSession` round-trip rather than racing through the
 * "undefined cache, fetch fresh" branch in parallel. Once the Promise
 * resolves it remains in the cache slot, so later sequential calls in
 * the same request also reuse the result.
 *
 * Augmentation runs inside the cached Promise: when BA returns a
 * session, we resolve the user's groups via {@link GroupService}
 * before returning. Anonymous resolutions skip the augmentation step.
 *
 * @param req - Express request whose Better Auth cookies will be read.
 * @returns The augmented session, or `null` when no valid session exists.
 */
async function resolveSession(req: Request): Promise<IAugmentedSession | null> {
    const slot = req as unknown as { [SESSION_CACHE_KEY]?: Promise<IAugmentedSession | null> };
    let pending = slot[SESSION_CACHE_KEY];
    if (pending === undefined) {
        pending = computeAugmentedSession(req);
        slot[SESSION_CACHE_KEY] = pending;
    }
    return pending;
}

/**
 * Build the augmented session for a request from scratch.
 *
 * Extracted so {@link resolveSession} can store the Promise this
 * function returns directly into the per-request cache, ensuring
 * concurrent callers share a single in-flight computation.
 *
 * Catches and swallows resolution errors so the cached Promise
 * always resolves successfully (to `null` on failure). Without this,
 * a single BA / Mongo hiccup would leave a rejected Promise in the
 * cache slot, and every downstream facade call (`isLoggedIn`,
 * `isAdmin`, `isInGroup`) within the same request would re-await
 * the rejection and throw — turning an anonymous-allowed route into
 * a 500. Returning `null` here lets the documented graceful-
 * degradation contract apply uniformly to direct and middleware-
 * primed call sites.
 *
 * @param req - Express request whose headers carry the BA session cookie.
 * @returns Augmented session when a valid BA session resolves, `null`
 *          on missing-session and on any resolution failure.
 */
async function computeAugmentedSession(req: Request): Promise<IAugmentedSession | null> {
    let result: IAugmentedSession | null;
    try {
        result = await getSessionFromHeaders(req.headers);
    } catch (error) {
        facadeLogger.error(
            { error, path: req.path },
            'Auth facade session resolution failed; degrading to anonymous'
        );
        result = null;
    }
    return result;
}

/**
 * Resolve an augmented session directly from raw Node headers.
 *
 * Exposed for the Socket.IO handshake, which has access to
 * `socket.handshake.headers` but no Express `Request` object on
 * which to attach the per-request cache. Callers cache the result
 * themselves on whatever scope makes sense (e.g. `socket.data`).
 *
 * Does not cache. Each call performs at most one BA session lookup
 * and, on hit, one GroupService read. Use {@link getSessionForRequest}
 * inside HTTP handlers — it shares the in-flight Promise via the
 * Symbol-keyed cache slot.
 *
 * @param headers - Raw Node HTTP headers carrying the BA session cookie.
 * @returns Augmented session when a valid BA session resolves, else null.
 */
export async function getSessionFromHeaders(
    headers: IncomingHttpHeaders
): Promise<IAugmentedSession | null> {
    const auth = requireAuth();
    const fetchHeaders = fromNodeHeaders(headers);
    const resolved = await auth.api.getSession({ headers: fetchHeaders });
    let augmented: IAugmentedSession | null = null;
    if (resolved) {
        const groups = await GroupService.getInstance().getUserGroups(resolved.user.id);
        // `primaryWallet` is a Better Auth additional field (declared in
        // auth.ts, maintained by WalletService) so it rides along on the
        // resolved user record — no extra round-trip. Read defensively
        // because BA's inferred user type does not surface custom fields.
        const primaryWallet =
            (resolved.user as { primaryWallet?: string | null }).primaryWallet ?? undefined;
        augmented = {
            user: resolved.user,
            session: resolved.session,
            groups,
            primaryWallet
        };
    }
    return augmented;
}

/**
 * Resolve the configured auth instance, throwing on missing config.
 *
 * Internal helper — every facade call funnels through here so the
 * "facade used before bootstrap" failure surfaces as one clear error
 * message at the actual call site rather than as a confusing `null`
 * deref further down.
 *
 * @returns The configured Better Auth instance.
 * @throws {Error} When the facade has not been configured.
 */
function requireAuth(): Auth {
    if (!configuredAuth) {
        throw new Error(
            'Auth facade not configured — UserModule.init() must call setAuthInstance() before any facade function runs.'
        );
    }
    return configuredAuth;
}
