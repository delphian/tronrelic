/**
 * @fileoverview Better Auth instance factory for the user module.
 *
 * Constructs the single Better Auth instance the application exposes at
 * `/api/auth/*`. The factory accepts injected dependencies (a native
 * MongoDB `Db` handle and the {@link GroupService} used for ADMIN_EMAILS
 * auto-promotion) so the instance can be built without reaching for
 * module-level singletons, and so tests can supply mocks for both.
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
import { magicLink } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { Resend } from 'resend';
import type { Db } from 'mongodb';
import type { ISystemLogService } from '@/types';
import { env } from '../../config/env.js';
import type { GroupService } from './services/group.service.js';

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
}

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
 * both its client id and secret are present, and the magic-link plugin
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
        baseURL: env.BETTER_AUTH_URL || env.SITE_URL,
        emailAndPassword: { enabled: false },
        socialProviders: buildSocialProviders(),
        plugins: buildPlugins(log),
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
            }
        }
    });
    return auth;
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
 * Build the plugin list for the auth instance.
 *
 * Passkey is always loaded — it has no env-var dependency. Magic-link
 * loads when Resend credentials are present (real send path) or when
 * the process is not running in production (dev console fallback).
 * Production without Resend credentials drops magic-link entirely so
 * plaintext sign-in URLs cannot leak to operator logs.
 *
 * @param log - Logger passed into the magic-link sender for fallback diagnostics.
 * @returns Ordered list of Better Auth plugins for the instance.
 */
function buildPlugins(log: ISystemLogService): Array<ReturnType<typeof passkey | typeof magicLink>> {
    const plugins: Array<ReturnType<typeof passkey | typeof magicLink>> = [
        passkey({
            // Remap the plugin's owned `passkey` table to the project's
            // `module_user_auth_*` convention so it sits alongside the
            // other BA-managed collections.
            schema: { passkey: { modelName: AUTH_COLLECTIONS.passkeys } }
        })
    ];
    const isProduction = env.NODE_ENV === 'production' || env.ENV === 'production';
    const hasResend = Boolean(env.RESEND_API_KEY && env.RESEND_FROM_ADDRESS);
    if (hasResend || !isProduction) {
        plugins.push(magicLink({ sendMagicLink: buildMagicLinkSender(log) }));
    } else {
        log.warn(
            'Magic-link plugin DISABLED in production: RESEND_API_KEY and/or RESEND_FROM_ADDRESS unset. Sign-in via magic-link is not available until these are configured.'
        );
    }
    return plugins;
}

/**
 * Build the `sendMagicLink` callback used by the magic-link plugin.
 *
 * Returns a Resend-backed sender when both RESEND_API_KEY and
 * RESEND_FROM_ADDRESS are set; otherwise returns a dev fallback that
 * logs the sign-in URL at warn level so contributors can copy-paste
 * the link locally. The fallback is gated out of production by
 * {@link buildPlugins} so it can never leak credentials in deployed logs.
 *
 * @param log - Logger used for both Resend failures and the dev fallback.
 * @returns Async function the magic-link plugin calls with `({ email, url })`.
 */
function buildMagicLinkSender(
    log: ISystemLogService
): (data: { email: string; url: string }) => Promise<void> {
    let sender: (data: { email: string; url: string }) => Promise<void>;
    if (env.RESEND_API_KEY && env.RESEND_FROM_ADDRESS) {
        const resend = new Resend(env.RESEND_API_KEY);
        const from = env.RESEND_FROM_ADDRESS;
        sender = async ({ email, url }): Promise<void> => {
            try {
                // The Resend SDK does not throw on API-level failures
                // (invalid key, unverified domain, quota exceeded). It
                // resolves with `{ data, error }`, so failures are
                // silent unless we explicitly inspect the `error` field
                // and throw.
                const { error: resendError } = await resend.emails.send({
                    from,
                    to: email,
                    subject: 'Sign in to TronRelic',
                    html: renderMagicLinkEmail(url)
                });
                if (resendError) {
                    throw new Error(resendError.message || 'Unknown Resend error');
                }
            } catch (error) {
                log.error({ error, email }, 'Resend magic-link send failed');
                throw error;
            }
        };
    } else {
        sender = async ({ email, url }): Promise<void> => {
            log.warn(
                { email, url },
                'Magic-link rendered to logs (RESEND_API_KEY/RESEND_FROM_ADDRESS unset, dev fallback only)'
            );
        };
    }
    return sender;
}

/**
 * Render the HTML body for a magic-link email.
 *
 * Kept intentionally minimal to avoid Resend template-rendering
 * surprises; the layout passes spam filters and clearly shows the call
 * to action. The URL is interpolated raw because Better Auth
 * guarantees it is a same-origin verified link.
 *
 * @param url - The signed magic-link URL produced by Better Auth.
 * @returns HTML string suitable for the Resend `html` field.
 */
function renderMagicLinkEmail(url: string): string {
    const body = [
        '<p>Click the link below to sign in to TronRelic:</p>',
        `<p><a href="${url}">${url}</a></p>`,
        '<p>This link expires shortly. If you didn\'t request it, you can safely ignore this email.</p>'
    ].join('');
    return body;
}

/**
 * Promote a newly-created user into the admin group when their verified
 * email matches the ADMIN_EMAILS allowlist.
 *
 * Verification is non-negotiable — without it an attacker could sign up
 * with `admin@example.com` they don't control and inherit privilege.
 * Magic-link guarantees verification by construction; OAuth providers
 * report verification status on the BA user record and we respect what
 * they say. Hook errors are caught and logged so a transient group-write
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
