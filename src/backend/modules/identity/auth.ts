/**
 * @fileoverview Better Auth instance factory for the user module.
 *
 * Constructs the single Better Auth instance the application exposes at
 * `/api/auth/*`. The factory accepts injected dependencies (a native
 * MongoDB `Db` handle and the {@link GroupService} used for ADMIN_EMAILS
 * auto-promotion) so the instance can be built without reaching for
 * module-level singletons, and so tests can supply mocks for both.
 *
 * **OAuth authorization server.** The same instance also acts as the OAuth
 * 2.1 authorization server for connected apps (MCP clients such as Claude):
 * the `jwt`, `oauthProvider`, consent-gate, and `cimd` plugins built by `buildOAuthPlugins`
 * serve sign-in, consent, and token issuance under `/api/auth/oauth2/*`.
 *
 * **Collection naming.** Better Auth's model names are remapped to the
 * `module_user_auth_*` convention so the BA-owned tables sit alongside the
 * user module's other collections in the database. The legacy unprefixed
 * `users` collection (UUID-based) is unrelated and decommissioned by the
 * cutover migration in Phase 6.
 *
 * **Native Db boundary.** `mongodbAdapter` requires the native MongoDB
 * driver's `Db` instance. This is the one documented exception to the
 * "no direct Mongoose / native collection access outside of
 * IDatabaseService" rule — Better Auth is a third-party adapter that
 * cannot consume our database abstraction. The boundary stays at the
 * module-init layer; nothing else in the codebase should reach for a
 * raw Db handle.
 */

import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { APIError } from 'better-auth/api';
import { emailOTP, jwt } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { oauthProvider } from '@better-auth/oauth-provider';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { Resend } from 'resend';
import type { Db } from 'mongodb';
import type { ISystemLogService } from '@/types';
import { MCP_OAUTH_SCOPES, MCP_USERS_GROUP_ID, assertPublicHttpUrl } from '@/types';
import { env } from '../../config/env.js';
import type { GroupService } from './services/group.service.js';
import type { IAuthRateLimitRedis } from './services/IAuthRateLimitRedis.js';
import type { IIdentitySocketDisconnector } from './services/IIdentitySocketDisconnector.js';
import type { IOAuthServerConfig } from './services/oauth-server-config.js';
import { createRedisRateLimitStorage } from './services/createRedisRateLimitStorage.js';
import { createEmailOtpThrottle } from './services/createEmailOtpThrottle.js';
import { createMcpConsentGate } from './services/createMcpConsentGate.js';
import { userGroups } from './services/userGroups.js';

/**
 * Group id used for the seeded administrators tag.
 *
 * Hardcoded here so the after-create hook and tests share one constant.
 * Later phases that allow dynamic group definitions still reserve `admin`.
 */
const ADMIN_GROUP_ID = 'admin';

export { AUTH_USERS_COLLECTION, AUTH_COLLECTIONS } from './services/auth-constants.js';
import { AUTH_COLLECTIONS } from './services/auth-constants.js';

/**
 * Dependencies the auth factory needs at construction time.
 *
 * The `Db` handle is passed explicitly (rather than imported from
 * mongoose) so tests can inject an in-memory or mocked database without
 * monkey-patching the mongoose singleton. See the file header for the
 * documented exception that justifies a raw `Db` at this boundary.
 */
export interface ICreateAuthDependencies {
    /**
     * Native MongoDB `Db` instance for the Better Auth adapter.
     * In production, sourced from `mongoose.connection.db` after
     * `connectDatabase()` resolves.
     */
    db: Db;

    /**
     * GroupService used by the after-create database hook to
     * auto-promote allowlisted email addresses into the `admin` group.
     */
    groupService: GroupService;

    /**
     * Pino logger for hook-side diagnostics. The factory derives a
     * `component: 'auth'` child so log lines are filterable from other
     * user-module diagnostics.
     */
    logger: ISystemLogService;

    /**
     * Redis client holding the sign-in rate-limit counters. Better Auth's
     * default in-memory counters reset on every restart, so an attacker who
     * can crash the backend also resets their own limit. Storing them in
     * Redis makes the per-IP limits and the per-email OTP limits hold across
     * restarts and instances.
     */
    rateLimitRedis: IAuthRateLimitRedis;

    /**
     * Drops the WebSocket connections opened with a session once that session
     * is deleted (sign-out, revocation). Without it a socket keeps its
     * `user:<id>` and group rooms, and so keeps receiving that user's events,
     * until it happens to reconnect.
     */
    socketDisconnector: IIdentitySocketDisconnector;

    /**
     * Public URLs of the OAuth authorization server: the base URL Better Auth
     * runs under, the issuer written into access tokens, the MCP resource URL
     * tokens are bound to, and the page that signs users in and asks for
     * consent.
     */
    oauth: IOAuthServerConfig;
}

/**
 * Access token lifetime for connected apps. A signed access token cannot be
 * recalled, so it is kept short; the MCP endpoint also re-checks the grant and
 * group membership on every request.
 */
const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Refresh token lifetime for connected apps. Every refresh rotates the token. */
const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * How long a just-rotated refresh token is still honoured. Claude retries a
 * refresh whose response it did not receive, and without this window the
 * retry would look like token theft and revoke the whole grant.
 */
const OAUTH_REFRESH_REUSE_SECONDS = 30;

/**
 * Scopes the authorization server offers, shared with the MCP endpoint that
 * advertises them. `offline_access` is what makes the server issue a refresh
 * token. `openid` is deliberately absent: it would add a second audience to
 * every access token and serve an OpenID Connect document nobody here needs.
 */
const OAUTH_SCOPES = [...MCP_OAUTH_SCOPES];

/**
 * Concrete Better Auth instance type for this codebase.
 *
 * Derived from `ReturnType<typeof createAuth>` so the factory remains
 * the single source of truth — consumers import this for typing their
 * stored references without hand-maintaining a parallel definition.
 */
export type Auth = ReturnType<typeof createAuth>;

/**
 * Build the Better Auth instance configured for TronRelic.
 *
 * Provider toggling is env-driven: each social provider loads only when
 * both its client id and secret are present, and the email-OTP plugin
 * loads only when Resend credentials are configured (or in non-prod,
 * where a console fallback is acceptable). The after-create database
 * hook reads the new user's verified email against the parsed
 * `ADMIN_EMAILS` allowlist and on match calls
 * `groupService.addMember(user.id, 'admin')`; unverified emails are
 * ignored so a forged signup cannot inherit privilege.
 *
 * @param deps - {@link ICreateAuthDependencies} for the instance.
 * @returns Configured Better Auth instance ready to mount at /api/auth/*.
 */
export function createAuth(deps: ICreateAuthDependencies) {
    const log = deps.logger.child({ component: 'auth' });
    const adminEmails = parseAdminEmails();
    const auth = betterAuth({
        database: mongodbAdapter(deps.db),
        secret: env.BETTER_AUTH_SECRET,
        // Resolved once in IdentityModule, alongside the OAuth issuer, so the
        // two cannot drift apart.
        baseURL: deps.oauth.baseUrl,
        emailAndPassword: { enabled: false },
        socialProviders: buildSocialProviders(),
        plugins: buildPlugins(log, deps.oauth),
        // Only the storage changes here; Better Auth still decides the limits
        // and still enables limiting in production only.
        rateLimit: {
            customStorage: createRedisRateLimitStorage(deps.rateLimitRedis, env.REDIS_NAMESPACE, log)
        },
        hooks: {
            before: createEmailOtpThrottle(deps.rateLimitRedis, env.REDIS_NAMESPACE, log)
        },
        user: {
            modelName: AUTH_COLLECTIONS.users,
            additionalFields: {
                groups: {
                    type: 'string[]',
                    required: false,
                    defaultValue: [],
                    input: false
                },
                primaryWallet: {
                    type: 'string',
                    required: false,
                    input: false
                }
            }
        },
        session: { modelName: AUTH_COLLECTIONS.sessions },
        account: { modelName: AUTH_COLLECTIONS.accounts },
        verification: { modelName: AUTH_COLLECTIONS.verifications },
        databaseHooks: {
            user: {
                create: {
                    after: async (user): Promise<void> => {
                        await maybePromoteToAdmin({
                            user,
                            adminEmails,
                            groupService: deps.groupService,
                            log
                        });
                    }
                }
            },
            session: {
                delete: {
                    after: async (session): Promise<void> => {
                        await disconnectSessionSockets({
                            session,
                            socketDisconnector: deps.socketDisconnector,
                            log
                        });
                    }
                }
            }
        }
    });
    return auth;
}

/**
 * Disconnect the sockets that were opened with a session Better Auth has
 * just deleted.
 *
 * Sign-out and session revocation both delete the session row, and this runs
 * afterwards. Only sockets opened with that same session are dropped, so the
 * user's other signed-in devices stay connected. A dropped official client
 * reconnects straight away and re-handshakes, now without the deleted
 * session's identity rooms. Failures are logged and swallowed, because the
 * sign-out itself has already succeeded and must not be reported as failed.
 *
 * @param params.session - The deleted session row; supplies the user and session ids.
 * @param params.socketDisconnector - WebSocket operation that drops the sockets.
 * @param params.log - Logger scoped to the auth component.
 */
async function disconnectSessionSockets(params: {
    session: { id?: string; userId?: string };
    socketDisconnector: IIdentitySocketDisconnector;
    log: ISystemLogService;
}): Promise<void> {
    const { session, socketDisconnector, log } = params;
    if (session.userId && session.id) {
        try {
            await socketDisconnector.disconnectUser(session.userId, session.id);
        } catch (error) {
            log.warn({ error, userId: session.userId }, 'Failed to disconnect sockets for a deleted session');
        }
    }
}

/**
 * Parse the comma-separated ADMIN_EMAILS env into a normalized set.
 *
 * Trims whitespace and lowercases each entry so comparison against
 * `user.email` (BA stores lowercased emails) is consistent regardless
 * of operator typography. An unset or empty value resolves to an empty
 * set — no auto-promotion happens.
 *
 * @returns Set of lowercase email addresses authorised for admin promotion.
 */
function parseAdminEmails(): Set<string> {
    const raw = env.ADMIN_EMAILS;
    const entries = raw
        ? raw
              .split(',')
              .map((value) => value.trim().toLowerCase())
              .filter((value) => value.length > 0)
        : [];
    return new Set(entries);
}

/**
 * Build the socialProviders config object, omitting providers whose
 * credentials are not configured.
 *
 * Better Auth treats an absent provider key as "do not load this
 * provider," so unset env vars naturally hide the corresponding
 * sign-in route. The frontend will inspect Better Auth's client
 * introspection to decide which provider buttons to render.
 *
 * @returns Partial provider config — keys present only when both id and secret are set.
 */
function buildSocialProviders(): {
    google?: { clientId: string; clientSecret: string };
    github?: { clientId: string; clientSecret: string };
} {
    const providers: {
        google?: { clientId: string; clientSecret: string };
        github?: { clientId: string; clientSecret: string };
    } = {};
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
        providers.google = {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET
        };
    }
    if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
        providers.github = {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET
        };
    }
    return providers;
}

/**
 * Every plugin type the auth instance can carry. Kept as a union so Better
 * Auth still infers each plugin's server API (`auth.api.getJwks`, the OAuth
 * consent endpoints) on the resulting instance type.
 */
type AuthPlugin = ReturnType<
    typeof passkey | typeof emailOTP | typeof jwt | typeof oauthProvider | typeof createMcpConsentGate | typeof cimd
>;

/**
 * Build the plugin list for the auth instance.
 *
 * Passkey is always loaded — it has no env-var dependency. Email-OTP
 * loads when Resend credentials are present (real send path) or when
 * the process is not running in production (dev console fallback).
 * Production without Resend credentials drops email-OTP entirely so
 * sign-in codes cannot leak to operator logs.
 *
 * The OAuth authorization server plugins always load, in the order the
 * client-metadata plugin requires (it extends the OAuth provider during its
 * own init, so the provider must come first). See {@link buildOAuthPlugins}.
 *
 * @param log - Logger passed into the OTP sender for fallback diagnostics.
 * @param oauth - Public URLs of the OAuth server and the MCP resource.
 * @returns Ordered list of Better Auth plugins for the instance.
 */
function buildPlugins(log: ISystemLogService, oauth: IOAuthServerConfig): AuthPlugin[] {
    const plugins: AuthPlugin[] = [
        passkey({
            // Remap the plugin's owned `passkey` table to the project's
            // `module_user_auth_*` convention so it sits alongside the
            // other BA-managed collections.
            schema: { passkey: { modelName: AUTH_COLLECTIONS.passkeys } }
        }),
        ...buildOAuthPlugins(log, oauth)
    ];
    const isProduction = env.NODE_ENV === 'production' || env.ENV === 'production';
    const hasResend = Boolean(env.RESEND_API_KEY && env.RESEND_FROM_ADDRESS);
    if (hasResend || !isProduction) {
        plugins.push(
            emailOTP({
                sendVerificationOTP: buildOtpSender(log),
                otpLength: 6,
                // Five minutes balances inbox-delivery latency against the
                // exposure window of a code sitting in an inbox.
                expiresIn: 300,
                // Store only a hash of each code. The default keeps codes in
                // plain text in module_user_auth_verifications, so anyone able
                // to read that collection could sign in as any user with a
                // code still pending.
                storeOTP: 'hashed'
            })
        );
    } else {
        log.warn(
            'Email-OTP plugin DISABLED in production: RESEND_API_KEY and/or RESEND_FROM_ADDRESS unset. Sign-in via email code is not available until these are configured.'
        );
    }
    return plugins;
}

/**
 * Build the plugins that make Better Auth an OAuth 2.1 authorization server
 * for connected apps, currently MCP clients such as Claude.
 *
 * - `jwt` signs access tokens and publishes the signing keys. Its issuer is
 *   set explicitly to the site origin; left unset it would be
 *   `<origin>/api/auth`, which moves the discovery document to an awkward
 *   path and breaks the resource-server helpers.
 * - `oauthProvider` runs the authorize, token, and consent endpoints. Access
 *   tokens are JWTs bound to the MCP resource URL when the client names that
 *   resource, which MCP clients must do. Dynamic client registration stays
 *   off, refresh tokens rotate, only the authorization-code and refresh
 *   grants exist, and only admins may create clients by hand. The
 *   `customAccessTokenClaims` hook is the hard gate on who may hold a JWT
 *   access token: it runs on every JWT issue and refresh and refuses anyone
 *   outside the MCP group, so a removed user cannot refresh one. Better Auth
 *   skips it for opaque tokens (no `resource`), which the MCP endpoint refuses.
 * - `mcp-consent-gate` refuses a consent approval from anyone outside the
 *   MCP group. Better Auth's consent endpoint only requires a session, so
 *   without it a non-member posting to `/oauth2/consent` directly would leave
 *   a stored grant behind even though no token is ever issued.
 * - `cimd` lets a client identify itself with the HTTPS URL of a metadata
 *   document, which is how Claude connects without registering first. The
 *   document is fetched through the plugin's Node transport, which resolves
 *   the host once, refuses private addresses, and pins the connection; the
 *   platform's own URL guard runs first as a cheap pre-check.
 *
 * @param log - Logger for client-creation audit lines and refusals.
 * @param oauth - Public URLs of the OAuth server and the MCP resource.
 * @returns The four plugins, in the order they must load.
 */
function buildOAuthPlugins(log: ISystemLogService, oauth: IOAuthServerConfig): AuthPlugin[] {
    return [
        jwt({
            jwt: { issuer: oauth.issuer },
            // The session endpoint would otherwise hand a JWT to every
            // browser session. Nothing here uses one, so do not mint them.
            disableSettingJwtHeader: true,
            schema: { jwks: { modelName: AUTH_COLLECTIONS.jwks } }
        }),
        oauthProvider({
            loginPage: oauth.authorizePage,
            consentPage: oauth.authorizePage,
            scopes: OAUTH_SCOPES,
            grantTypes: ['authorization_code', 'refresh_token'],
            // No `allowedScopes` on the resource: the effective scopes are the
            // intersection with it, and leaving out `offline_access` would stop
            // refresh-token rotation after the first refresh.
            resources: [{ identifier: oauth.mcpResourceUrl, name: 'TronRelic MCP' }],
            // Links every client that registers by metadata URL to the MCP
            // resource, which it must be linked to before it may request it.
            clientRegistrationDefaultResources: [oauth.mcpResourceUrl],
            clientRegistrationDefaultScopes: OAUTH_SCOPES,
            allowDynamicClientRegistration: false,
            accessTokenExpiresIn: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
            refreshTokenExpiresIn: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
            refreshTokenReuseInterval: OAUTH_REFRESH_REUSE_SECONDS,
            /**
             * Restrict creating, updating, and deleting OAuth clients to
             * admins. Without this, any signed-in user could manage OAuth
             * clients through `/api/auth/oauth2/*`.
             *
             * @param ctx - Better Auth's privilege context; only the acting
             *   user is read, because group membership is the whole rule.
             * @returns True when the acting user is in the admin group.
             */
            clientPrivileges: ({ user }) => userGroups(user).includes(ADMIN_GROUP_ID),
            /**
             * Refuse to mint an access token for anyone outside the MCP
             * group. Better Auth calls this on every issue and every refresh
             * of a JWT access token, so it is the hard gate on who may hold
             * one, and a user removed from the group cannot refresh one.
             *
             * @param ctx - Better Auth's claims context; only the user whose
             *   token is being minted is read.
             * @returns No extra claims; the function exists for its refusal.
             * @throws {APIError} `invalid_grant` when the user is not in the MCP group.
             */
            customAccessTokenClaims: ({ user }) => {
                if (!user || !userGroups(user).includes(MCP_USERS_GROUP_ID)) {
                    log.info({ userId: user?.id }, 'OAuth token refused: user is not in the MCP group');
                    throw new APIError('BAD_REQUEST', {
                        error: 'invalid_grant',
                        error_description: 'This account is not permitted to connect apps to TronRelic.'
                    });
                }
                return {};
            },
            schema: {
                oauthClient: { modelName: AUTH_COLLECTIONS.oauthClients },
                oauthResource: { modelName: AUTH_COLLECTIONS.oauthResources },
                oauthClientResource: { modelName: AUTH_COLLECTIONS.oauthClientResources },
                oauthRefreshToken: { modelName: AUTH_COLLECTIONS.oauthRefreshTokens },
                oauthAccessToken: { modelName: AUTH_COLLECTIONS.oauthAccessTokens },
                oauthConsent: { modelName: AUTH_COLLECTIONS.oauthConsents },
                oauthClientAssertion: { modelName: AUTH_COLLECTIONS.oauthClientAssertions }
            }
        }),
        createMcpConsentGate(log),
        cimd({
            fetchClientMetadataResource,
            metadataProfile: 'mcp-2026-07-28',
            /**
             * Cheap pre-check that refuses a metadata URL pointing at a
             * private or non-HTTPS target before the plugin's pinned fetch
             * runs, so an obviously internal address never reaches the network.
             *
             * @param clientIdUrl - The client id URL an app presented.
             * @returns True when the URL is an HTTPS URL on a public host.
             */
            isMetadataDocumentUrlAllowed: (clientIdUrl: string) => assertPublicHttpUrl(clientIdUrl).ok,
            /**
             * Record every client created from a metadata document, so an
             * operator can see which apps have registered themselves.
             *
             * Only the client's public identifiers are logged. The event also
             * carries Better Auth's endpoint context, which holds the auth
             * secret, social provider credentials, and the request's cookies,
             * and logging it would copy those into the persisted system logs.
             *
             * @param event - The plugin's description of the new client; only
             *   its `client` fields are read.
             */
            onClientCreated: (event) => {
                const { clientId, name, uri, redirectUris } = event.client;
                log.info({ clientId, name, uri, redirectUris }, 'OAuth client registered from a client metadata document');
            }
        })
    ];
}

/**
 * Build the `sendVerificationOTP` callback used by the email-OTP plugin.
 *
 * Returns a Resend-backed sender when both RESEND_API_KEY and
 * RESEND_FROM_ADDRESS are set; otherwise returns a dev fallback that
 * logs the code at warn level so contributors can read it from the
 * console locally. The fallback is gated out of production by
 * {@link buildPlugins} so a sign-in code can never leak in deployed logs.
 *
 * A code (not a link) is used so sign-in completes in the browser tab
 * where the user started: email clients open links in in-app webviews,
 * which would set the session in a sandbox separate from the user's
 * real browser, and email link-scanners can pre-consume single-use
 * verify URLs. Typing a code back into the original tab avoids both.
 *
 * @param log - Logger used for both Resend failures and the dev fallback.
 * @returns Async function the plugin calls with `({ email, otp, type })`.
 */
function buildOtpSender(
    log: ISystemLogService
): (data: { email: string; otp: string; type: string }) => Promise<void> {
    let sender: (data: { email: string; otp: string; type: string }) => Promise<void>;
    if (env.RESEND_API_KEY && env.RESEND_FROM_ADDRESS) {
        const resend = new Resend(env.RESEND_API_KEY);
        const from = env.RESEND_FROM_ADDRESS;
        sender = async ({ email, otp }): Promise<void> => {
            try {
                // The Resend SDK does not throw on API-level failures
                // (invalid key, unverified domain, quota exceeded). It
                // resolves with `{ data, error }`, so failures are
                // silent unless we explicitly inspect the `error` field
                // and throw.
                const { error: resendError } = await resend.emails.send({
                    from,
                    to: email,
                    subject: 'Your TronRelic sign-in code',
                    html: renderOtpEmail(otp)
                });
                if (resendError) {
                    throw new ResendSendError(resendError.message || 'Unknown Resend error', resendError.name);
                }
            } catch (error) {
                // Resend refusing the recipient address (a `validation_error`,
                // such as a reserved domain like example.com) is a problem with
                // what the visitor typed, not with our email setup, and probing
                // tools trigger it constantly. Log it as a warning with only the
                // domain. Anything else — a bad key, an exhausted quota, an
                // outage — stops every sign-in and stays an error.
                const domain = email.split('@').pop();
                if (error instanceof ResendSendError && error.code === 'validation_error') {
                    log.warn({ emailDomain: domain, reason: error.message }, 'Resend refused the OTP recipient address');
                } else {
                    log.error({ error, emailDomain: domain }, 'Resend OTP send failed');
                }
                throw error;
            }
        };
    } else {
        sender = async ({ email, otp }): Promise<void> => {
            log.warn(
                { email, otp },
                'Sign-in OTP rendered to logs (RESEND_API_KEY/RESEND_FROM_ADDRESS unset, dev fallback only)'
            );
        };
    }
    return sender;
}

/**
 * Error carrying the error code Resend reported, so the sender can tell a
 * rejected recipient address apart from a failure of our own configuration.
 *
 * The Resend SDK returns failures as `{ error: { name, message } }` rather
 * than throwing, and a plain `Error` built from the message loses `name`.
 */
class ResendSendError extends Error {
    /**
     * @param message - Resend's human-readable explanation, kept for the log.
     * @param code - Resend's error code (for example `validation_error`), which
     *   decides whether the failure is logged as a warning or an error.
     */
    constructor(message: string, readonly code: string) {
        super(message);
        this.name = 'ResendSendError';
    }
}

/**
 * Render the HTML body for a sign-in OTP email.
 *
 * Kept intentionally minimal to avoid Resend template-rendering
 * surprises; the layout passes spam filters and shows the code
 * prominently. The code is plugin-generated digits, safe to interpolate.
 *
 * @param otp - The one-time code produced by Better Auth.
 * @returns HTML string suitable for the Resend `html` field.
 */
function renderOtpEmail(otp: string): string {
    const body = [
        '<p>Your TronRelic sign-in code is:</p>',
        `<p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${otp}</p>`,
        '<p>Enter it in the tab where you started signing in. This code expires in 5 minutes. If you didn\'t request it, you can safely ignore this email.</p>'
    ].join('');
    return body;
}

/**
 * Promote a newly-created user into the admin group when their verified
 * email matches the ADMIN_EMAILS allowlist.
 *
 * Verification is non-negotiable — without it an attacker could sign up
 * with `admin@example.com` they don't control and inherit privilege.
 * Email-OTP guarantees verification by construction (the user proved
 * inbox control by entering the emailed code); OAuth providers report
 * verification status on the BA user record and we respect what they
 * say. Hook errors are caught and logged so a transient group-write
 * failure cannot block legitimate signup completion.
 *
 * @param params.user - New user object as supplied by the BA after-create hook.
 * @param params.adminEmails - Parsed ADMIN_EMAILS allowlist.
 * @param params.groupService - GroupService owning admin group membership writes.
 * @param params.log - Logger scoped to the auth component.
 */
async function maybePromoteToAdmin(params: {
    user: { id: string; email?: string | null; emailVerified?: boolean };
    adminEmails: Set<string>;
    groupService: GroupService;
    log: ISystemLogService;
}): Promise<void> {
    const { user, adminEmails, groupService, log } = params;
    try {
        const email = user.email?.toLowerCase();
        const eligible = Boolean(user.emailVerified) && Boolean(email) && adminEmails.has(email!);
        if (eligible) {
            await groupService.addMember(user.id, ADMIN_GROUP_ID);
            log.info(
                { userId: user.id, email, group: ADMIN_GROUP_ID },
                'New signup auto-promoted to admin via ADMIN_EMAILS allowlist'
            );
        }
    } catch (error) {
        log.error(
            { error, userId: user.id },
            'admin auto-promotion hook failed; user created without admin group'
        );
    }
}
