/**
 * @fileoverview Physical collection names for the Better Auth-managed
 * tables.
 *
 * Extracted into a standalone module so consumers that only need the
 * name strings — {@link GroupService}, future admin tooling, tests —
 * can import them without pulling Better Auth's heavy dependency tree
 * into their module graph. `auth.ts` re-exports these constants for
 * back-compatibility with any external code that imported them from
 * the auth module before the split.
 *
 * Renaming any value here is a breaking change for every persisted
 * record. Coordinate with a migration if the application is past Phase 1.
 */

/**
 * Physical collection name for Better Auth's user table.
 *
 * Mapped via `user.modelName` on the BA options so BA's adapter writes
 * here instead of the default `user` collection. Group membership
 * reads/writes route through this name from {@link GroupService}.
 */
export const AUTH_USERS_COLLECTION = 'module_user_auth_users';

/**
 * Physical collection names for Better Auth's remaining tables.
 *
 * Exported as a frozen const object so dynamic-introspection callers
 * (admin UI, migrations, debug tooling) can enumerate them without
 * hardcoding string literals across the codebase.
 */
export const AUTH_COLLECTIONS = {
    users: AUTH_USERS_COLLECTION,
    sessions: 'module_user_auth_sessions',
    accounts: 'module_user_auth_accounts',
    verifications: 'module_user_auth_verifications',
    passkeys: 'module_user_auth_passkeys',
    // Signing keys for OAuth access tokens (the jwt plugin).
    jwks: 'module_user_auth_jwks',
    // OAuth authorization server tables (the oauth-provider plugin), which
    // back sign-in for connected apps such as MCP clients.
    oauthClients: 'module_user_auth_oauth_clients',
    oauthResources: 'module_user_auth_oauth_resources',
    oauthClientResources: 'module_user_auth_oauth_client_resources',
    oauthRefreshTokens: 'module_user_auth_oauth_refresh_tokens',
    oauthAccessTokens: 'module_user_auth_oauth_access_tokens',
    oauthConsents: 'module_user_auth_oauth_consents',
    oauthClientAssertions: 'module_user_auth_oauth_client_assertions'
} as const;
