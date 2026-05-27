/**
 * @fileoverview Authorization facade — the only sanctioned surface for
 * "is this caller logged in / a member / an admin" checks across the
 * codebase.
 *
 * Plugins, modules, controllers, and middleware import the four free
 * functions exported here and never reach for `req.user`, Better Auth's
 * client API, or the GroupService directly. The single-surface rule
 * means later phases can swap the underlying mechanism — caching, a new
 * session backend, role/permission overlays — without touching every
 * call site.
 *
 * **Phase 1 wiring.** The facade calls `auth.api.getSession({ headers })`
 * on every check. A per-request cache (stored on the request object
 * under a Symbol) elides repeat queries within a single request when
 * multiple facade calls run. Phase 2 will introduce middleware that
 * pre-populates the cache before route handlers execute; until then
 * the first call within a request pays one Mongo round-trip.
 */

import type { Request } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { GroupService, ADMIN_GROUP_ID } from './group.service.js';
import type { Auth } from '../auth.js';

/**
 * Per-request cache key for the resolved Better Auth session.
 *
 * Symbol-typed so it never collides with a legitimate property on the
 * Express request object and remains invisible to callers that
 * enumerate request fields.
 */
const SESSION_CACHE_KEY: unique symbol = Symbol('auth-facade.session');

/**
 * Shape of a successful session resolution.
 *
 * Derived from {@link Auth}'s `api.getSession` return type rather than
 * imported from Better Auth's internals so a library version bump that
 * tweaks intermediate types won't break consumers.
 */
type ResolvedSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

/**
 * Module-private auth instance reference.
 *
 * Set once at bootstrap by {@link setAuthInstance}; consumed by every
 * facade function. `null` until configured — accessing the facade
 * before bootstrap surfaces a clear error rather than a silent false.
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
 * a resolved Better Auth user id. Group ids are case-sensitive.
 *
 * @param req - Express request.
 * @param groupId - Group id to test.
 * @returns Promise resolving to the membership predicate.
 */
export async function isInGroup(req: Request, groupId: string): Promise<boolean> {
    const session = await resolveSession(req);
    let result = false;
    if (session) {
        const groups = GroupService.getInstance();
        result = await groups.isMember(session.user.id, groupId);
    }
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
 * Resolve the Better Auth session for a request, with per-request caching.
 *
 * Caches the *in-flight Promise* on the request object under a private
 * Symbol, not the resolved session, so concurrent callers — e.g.
 * `Promise.all([isLoggedIn(req), isAdmin(req)])` — share a single
 * `auth.api.getSession` round-trip rather than racing through the
 * "undefined cache, fetch fresh" branch in parallel. Once the Promise
 * resolves it remains in the cache slot, so later sequential calls in
 * the same request also reuse the result.
 *
 * @param req - Express request whose Better Auth cookies will be read.
 * @returns The resolved session, or `null` when no valid session exists.
 */
async function resolveSession(req: Request): Promise<ResolvedSession | null> {
    const slot = req as unknown as { [SESSION_CACHE_KEY]?: Promise<ResolvedSession | null> };
    let pending = slot[SESSION_CACHE_KEY];
    if (pending === undefined) {
        const auth = requireAuth();
        const headers = fromNodeHeaders(req.headers);
        pending = auth.api.getSession({ headers }).then((resolved) => resolved ?? null);
        slot[SESSION_CACHE_KEY] = pending;
    }
    return pending;
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
