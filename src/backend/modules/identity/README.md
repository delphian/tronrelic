# Identity Module

Owns Better Auth and everything keyed by the Better Auth user id: the auth instance, the authorization facade, group membership, the wallet store, group-definition registry, and the read-only account directory. Carved out of the former omnibus user module so account identity has a single owner.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `identity` |
| Module class | `src/backend/modules/identity/IdentityModule.ts` |
| Admin page | `/system/users` (menu item `Users`, order 25, registered in `run()`) |
| Service registry names | `'user-groups'`, `'wallets'`, `'accounts'`, `'user-settings'` |
| Mounted routes | `/api/auth/*`, `/.well-known/oauth-authorization-server`, `/api/user/wallets/*`, `/api/user/settings`, `/api/user/connected-apps`, `/api/user/oauth/authorize-context`, `/api/admin/users/groups/*`, `/api/admin/users` (accounts), `/api/admin/accounts/search` |
| Types package | `@delphian/tronrelic-types` → `IWalletService`, `IAccountDirectoryService`, `IUserGroupService`, `IUserSettingsService`, `IConnectedAppsService`, `IConnectedApp`, `IConnectedAppAdminRow`, `IOAuthConsentContext`, `IMcpAccessTokenVerifier` |
| Auth collections | `module_user_auth_users` / `_sessions` / `_accounts` / `_verifications` / `_passkeys` / `_jwks` / `_oauth_clients` / `_oauth_resources` / `_oauth_client_resources` / `_oauth_refresh_tokens` / `_oauth_access_tokens` / `_oauth_consents` / `_oauth_client_assertions` |
| OAuth authorization server | Issuer = site origin; access tokens are JWTs bound to the MCP resource URL; consent page `/oauth/authorize`. See [OAuth Authorization Server](#oauth-authorization-server) |
| Bootstrap getters | `getAccessTokenVerifier()`, `getConnectedAppsService()`, `getOAuthServerConfig()`, `getUserGroupService()`, `getAccountDirectoryService()` — consumed by the MCP module |
| Owned collections | `module_user_wallets`, `module_user_groups`, `module_user_settings`, `module_user_connected_app_usage` |
| Bootstrap order | Inits/runs after `TrafficModule` so traffic's `/api/admin/users/{traffic,analytics}` routers mount before the accounts `/api/admin/users` catch-all |

## Why This Module Exists Separately

Better Auth is the sole identity layer — the legacy UUID identity system was removed in the Phase 6 cutover. Keeping BA-keyed concerns in their own module enforces a single-responsibility boundary: **no code outside this module reads `module_user_auth_users` directly** — not even via `IDatabaseService`. The only sanctioned path is `services.get<IAccountDirectoryService>('accounts')`. Wallet and group data follow the same rule through `'wallets'` and `'user-groups'`.

**User id type.** Better Auth's `mongodbAdapter` stores the user `_id` as a native MongoDB `ObjectId` and exposes it as its 24-character hex string (`user.id`). That hex string is the canonical, *opaque* user id everywhere outside this module: store it verbatim, compare it verbatim, never cast it to an `ObjectId`, and never `$lookup` against the user collection's `_id`. The string↔ObjectId conversion lives only in `services/user-id.ts`, used by the services that own the BA collection (`GroupService`, `WalletService`, `AccountDirectoryService`).

## Source Map

| Path | Responsibility |
|------|----------------|
| `IdentityModule.ts` | Two-phase lifecycle; constructs services + auth, mounts routers, registers services |
| `auth.ts` | Better Auth factory (`createAuth`), `Auth` type; takes a raw Mongo `Db` (documented `IDatabaseService` exception) |
| `services/auth-facade.ts` | Session resolution + `isLoggedIn`/`isAdmin`/`isInGroup` predicates over `req.authSession`; `setAuthInstance` |
| `services/auth-constants.ts` | Physical BA collection names (`AUTH_USERS_COLLECTION`, `AUTH_COLLECTIONS`) |
| `services/consumeRedisWindow.ts` | Atomic fixed-window counter in Redis (one Lua step for increment + expiry); shared by both limiters below |
| `services/createRedisRateLimitStorage.ts` | Better Auth `rateLimit.customStorage` — moves BA's per-IP counters from process memory to Redis |
| `services/createEmailOtpThrottle.ts` | `hooks.before` middleware adding per-email limits to the OTP send and check endpoints (`EMAIL_OTP_THROTTLE`) |
| `services/createMcpConsentGate.ts` | Better Auth plugin refusing `/oauth2/consent` approvals from users outside `mcp-users` (`enforceMcpConsentMembership`) |
| `services/userGroups.ts` | `userGroups` — reads the loosely typed `groups` field off a Better Auth user; shared by the OAuth callbacks and the consent gate |
| `services/IAuthRateLimitRedis.ts` | The one Redis command the limiters use (`eval`); the bootstrap ioredis client satisfies it |
| `services/IIdentitySocketDisconnector.ts` | `disconnectUser(userId, sessionId?)` — the one WebSocket operation identity needs; `WebSocketService` implements it |
| `services/user-id.ts` | `toUserKey` / `userIdFromKey` — BA user-id hex ↔ `_id` ObjectId conversion at the collection boundary; the opaque-hex-string contract |
| `services/group.service.ts` | Membership primitive over the BA `groups` field; `ADMIN_GROUP_ID` |
| `services/user-group.service.ts` | Group-definition registry + the `'user-groups'` contract; composes `GroupService` |
| `services/wallet.service.ts` | BA-keyed wallet store (`module_user_wallets`); the `'wallets'` contract |
| `services/wallet-challenge.service.ts` | Single-use nonce mint/consume for wallet mutations (utility, not a singleton) |
| `services/account-directory.service.ts` | Read-only directory over BA accounts; the `'accounts'` contract |
| `services/user-settings.service.ts` | Central per-user settings store (`module_user_settings`); the `'user-settings'` contract + definition registry |
| `api/user-settings.{controller,routes}.ts` | `/api/user/settings` self-service surface (BA-session-resolved, registered-definition allow-list) |
| `database/IUserSettingDocument.ts` | `module_user_settings` document (`(userId, namespace, key)` → opaque value) |
| `api/wallet.{controller,routes}.ts` | `/api/user/wallets/*` (BA-session-resolved, no `:id` on the wire) |
| `api/user-group.{controller,routes}.ts` | `/api/admin/users/groups/*` admin CRUD + membership |
| `api/accounts.{controller,routes}.ts` | `/api/admin/users` admin account directory (list + per-account group assignment) over the `'accounts'` service |
| `database/IWalletDocument.ts` | `module_user_wallets` document + `ILinkedWallet` public shape |
| `database/IUserGroupDocument.ts` | `module_user_groups` document |
| `services/oauth-server-config.ts` | `resolveOAuthServerConfig` — issuer, MCP resource URL, metadata URL, and consent page path from one base URL |
| `services/connected-apps.service.ts` | `IConnectedAppsService` singleton over Better Auth's adapter: list, full revoke (one app or all of a user's), cached `hasGrant`, throttled `recordUse` |
| `services/revokeGrantsOnGroupExit.ts` | Run by the membership listener: revokes all of a user's connected apps when they are no longer in `mcp-users` |
| `database/IConnectedAppUsageDocument.ts` | `module_user_connected_app_usage` document (`(userId, clientId)` → `lastUsedAt`) |
| `services/hostOf.ts` | `hostOf` / `isLoopbackHost` — redirect-URI host parsing and the loopback list shared by the consent context and the connected-apps list |
| `services/oauth-access-token.verifier.ts` | `IMcpAccessTokenVerifier`: local JWT verification (issuer, audience, `at+jwt`), DPoP refusal, live-grant check; signing keys read from the store at most once per 30 seconds (`JWKS_REFETCH_COOLDOWN_MS`) |
| `api/connected-apps.{controller,routes}.ts` | `/api/user/connected-apps` (list, revoke) and `/api/user/oauth/authorize-context` (consent screen details) |

## Sign-in Rate Limiting

Email sign-in sends a six-digit one-time code (OTP). Two layers of limits protect it, and both keep their counters in Redis under `<REDIS_NAMESPACE>:auth:*` so a backend restart does not reset them. Better Auth's default is process memory, and an attacker able to crash the backend could reset their own limit that way.

| Layer | Keyed by | Limits | Source |
|-------|----------|--------|--------|
| Better Auth built-in | IP address + path | BA defaults: 3 requests / 60 s on each email-OTP endpoint, 100 / 10 s elsewhere. Enabled in production only | `createRedisRateLimitStorage` |
| Per-email throttle | Lowercased email | 5 codes sent / hour; 10 code checks / hour across `/sign-in/email-otp`, `/email-otp/check-verification-otp`, `/email-otp/verify-email` | `createEmailOtpThrottle` |

The per-email layer exists because the per-IP layer alone lets anyone who rotates IP addresses keep guessing a victim's code, about three guesses a minute per extra address, or flood an inbox with codes. Refusals return `429` and log a warning with the email domain only.

Both layers let a request through and log an error when Redis is unreachable, because refusing would stop every sign-in for the length of the outage. Codes are stored hashed (`storeOTP: 'hashed'`), so reading `module_user_auth_verifications` does not reveal a pending code. A recipient Resend refuses as invalid (`validation_error`) is logged as a warning; any other send failure is an error, because it stops all email sign-in.

## OAuth Authorization Server

The Better Auth instance is also an OAuth 2.1 authorization server, so connected apps (MCP clients such as Claude) can act for a user after that user signs in and approves them. `buildOAuthPlugins` in `auth.ts` adds four plugins:

| Plugin | Configuration that matters |
|---|---|
| `jwt` | `issuer` set to the site origin (unset it would be `<origin>/api/auth`); session JWT header disabled; keys in `module_user_auth_jwks` |
| `oauthProvider` | Scopes `mcp:tools` and `offline_access` (no `openid`); grants `authorization_code` and `refresh_token` only; one resource, the MCP URL, linked to every client by default; access tokens 15 minutes, refresh tokens 30 days with rotation and a 30-second reuse window; dynamic client registration off; only admins may create clients (`clientPrivileges`); login and consent page `/oauth/authorize` |
| `mcp-consent-gate` | A `hooks.before` on `/oauth2/consent` that answers `403 access_denied` when a user outside `mcp-users` approves. Denials pass through |
| `cimd` | Clients identify themselves with a metadata document URL, fetched through `@better-auth/cimd/node` (resolve-once, public addresses only, no redirects) after `assertPublicHttpUrl`; `metadataProfile: 'mcp-2026-07-28'` |

**Who may hold a token.** `customAccessTokenClaims` runs on every issue and every refresh of a JWT access token (a request that names the MCP resource) and throws `invalid_grant` unless the user is in `mcp-users`. Better Auth does not call it when it issues an opaque token for a request without `resource`, so a user with a lingering consent can still obtain an opaque token; the MCP endpoint refuses those, which is what keeps them harmless. The consent gate refuses the approval itself for non-members, because Better Auth's consent endpoint needs only a session and would otherwise store a consent row that shows as a connected app and counts as a live grant, even though no token is ever issued for it. The MCP module re-checks membership per request as well.

**Access tokens are JWTs only when the client sends `resource`.** Without it Better Auth issues an opaque token with no audience, which the MCP endpoint refuses. MCP clients are required to send it.

**Revocation.** Better Auth's own consent deletion leaves refresh tokens working, and sign-out does not revoke refresh tokens carrying `offline_access`. `ConnectedAppsService.revoke` therefore deletes the consent, the refresh tokens, and any stored access tokens for the `(user, client)` pair. JWT access tokens cannot be recalled, so the verifier's `hasGrant` check (cached 30 seconds) is what cuts them off before they expire. The verifier passes the token's `iat`, and a token issued before the current consent was created is refused, so a user who revokes an app and reconnects it within 15 minutes does not bring back the tokens from before the revocation. Many users share one client id (every Claude user connects with the same metadata URL), which is why the grant alone cannot tell the two apart.

**Leaving `mcp-users`.** After every membership write, the membership listener checks whether the user is still in `mcp-users` and, if not, calls `revokeAllForUser`, which runs `revoke` for every app the user holds a consent or token for. Without this the consents and refresh tokens would stay stored while the Connected apps tab is hidden from the user, so they could not revoke them, and an admin adding them back would revive the apps without new consent. A failure is logged at `error` and does not fail the membership write.

**Last used.** Better Auth's tables do not record when an app last made a call, so the module keeps that in its own `module_user_connected_app_usage` collection, one row per `(userId, clientId)` under a unique index. The MCP endpoint calls `recordUse` for every request it accepts. The service writes at most once per grant every five minutes (an in-memory throttle per instance, with `$max` so two instances cannot move the time backwards), and a failed write is logged at `warn` and retried on the next call without failing the request. The connected-apps lists read every row for a page in one query, and `listAll` labels rows with emails through one `getAccountsByIds` call. `revoke` deletes the row, so a reconnected app starts with no last-use time.

**Signing key reads.** Better Auth reads the signing keys again whenever an access token names a key id (`kid`) it has not cached. That header is read before the signature is checked, so a forged token with a random key id would otherwise cost a `module_user_auth_jwks` read on every request to `/mcp`. The verifier reads the store at most once every 30 seconds, and requests arriving during a read share it. Between reads it reuses the last key set, so a forged key id is refused with `401` without reaching the database. A read that fails is not cached, so the next request tries again, and a request that needed the read gets `503` rather than `401`. The same cooldown means a key added by rotation can take up to 30 seconds to be accepted; no automatic rotation is configured.

**Discovery.** `/.well-known/oauth-authorization-server` is mounted at the site root with `oauthProviderAuthServerMetadata(auth)`. It advertises `client_id_metadata_document_supported` and the `none` token-endpoint auth method, which Claude requires before it will use client metadata documents.

**Consent page.** `/oauth/authorize` (frontend `OAuthConsent`) is both the login page and the consent page. Signed out, it opens the sign-in dialog; the browser client's `oauthProviderClient` plugin copies the signed authorization query into the sign-in request, and Better Auth resumes the authorization afterwards. Signed in, it shows the app's self-declared name, the redirect host (flagging loopback-only clients), and the requested scopes, and posts the decision to `/api/auth/oauth2/consent`. Users outside `mcp-users` see only Deny, and the consent gate refuses an approval they post directly. The page is served with `frame-ancestors 'none'`. The signed query expires after 10 minutes, so a sign-in that takes longer must restart from the app.

## Keeping WebSocket Identity Current

A WebSocket joins its `user:<id>` and `group:<id>` rooms once, at the handshake. A socket that outlived the session or group membership it was opened with would otherwise keep receiving that user's notifications and admin events until it happened to reconnect, which a hostile client never has to do. The module therefore drops the affected sockets through the injected `socketDisconnector` (`IIdentitySocketDisconnector`, implemented by `WebSocketService`):

| Trigger | Where | Sockets dropped |
|---------|-------|-----------------|
| Session deleted (sign-out, revocation) | `databaseHooks.session.delete.after` in `auth.ts` | Only those opened with that session, so the user's other devices stay connected |
| Any group membership write (`addMember`, `removeMember`, `setUserGroups`, group deletion) | The listener passed to `GroupService.setDependencies` | All of the user's sockets |

The official client reconnects straight away and rejoins with its current identity. A failure to disconnect is logged at `warn` and never fails the sign-out or the membership write that caused it. The same membership listener also revokes the user's connected apps when they are no longer in `mcp-users`; see [Leaving `mcp-users`](#oauth-authorization-server).

## Published Service Contracts

Registered on the service registry during `run()`. Consume via `services.get<T>(name)` (one-shot) or `services.watch(...)` (continuous).

### `'wallets'` → `IWalletService`

| Method | Purpose |
|--------|---------|
| `listWallets(userId)` | Linked wallets for the account, oldest first |
| `issueChallenge(userId, action, address)` | Mint a single-use nonce (`'link' \| 'unlink' \| 'set-primary'`) |
| `linkWallet(userId, input)` | Attach a wallet after signature proof |
| `unlinkWallet(userId, input)` | Detach a wallet |
| `setPrimaryWallet(userId, input)` | Promote an existing wallet to primary (step-up) |

Every method takes the resolved Better Auth user id first — the service never reads cookies/sessions. Mutations denormalize the primary address onto the BA user record so the session surfaces it without a second query. After a successful `linkWallet`, the service fires the `http.walletLinked` observer hook (`{ userId, address }`) so feature modules react to new verified ownership without identity depending on them — account-history enrolls the address into its backfill. See [system-hooks.md](../../../../docs/system/system-hooks.md).

### `'accounts'` → `IAccountDirectoryService`

| Method | Purpose |
|--------|---------|
| `countAccounts()` | Total BA account count |
| `getAccount(baUserId)` | One account summary, or null |
| `getAccountsByIds(baUserIds)` | Summaries for a page of ids in one `$in` query; ids with no account are left out, order not guaranteed |
| `listAccounts(options?)` | Paginated/searched summaries + unpaginated total |

### `'user-groups'` → `IUserGroupService`

Group definitions and membership. See `@/types` `IUserGroupService` for the full method surface; `isAdmin(userId)` is the canonical per-user admin check.

Group ids are reusable: after a group is deleted, a new one can be created under the same id. So after a successful `deleteGroup`, the service fires the `http.groupDeleted` observer hook (`{ groupId }`), and components that stored something against the id remove it. The MCP module uses it to delete the group's tool grants and group policy. See [system-hooks.md](../../../../docs/system/system-hooks.md).

### `'user-settings'` → `IUserSettingsService`

The single home for user-centric settings and preferences, keyed by Better Auth user id and addressed by `(namespace, key)`. The store owns the envelope; each provider owns the opaque JSON value under its namespace — a new setting needs no schema change. Two trust levels: the programmatic methods (`get`/`getNamespace`/`getForUsers`/`set`/`delete`) serve trusted server callers and skip validation; the `/api/user/settings` self-service surface writes only settings a provider registered as `userWritable` via `registerDefinition`, after the definition's validator accepts the value — the allow-list that prevents arbitrary-key storage exhaustion.

| Method | Purpose |
|--------|---------|
| `get(userId, namespace, key)` | One value, or the registered default, or null |
| `getNamespace(userId, namespace)` | All keys a user stored under one namespace |
| `getForUsers(userIds, namespace, key)` | Batch read one setting across users (one round-trip) |
| `set(userId, namespace, key, value)` | Upsert a value (trusted; no validation) |
| `delete(userId, namespace, key)` | Clear a value, reverting to the default |
| `registerDefinition(def)` / `listDefinitions()` | Declare/enumerate self-service-writable settings |

First consumer: the notifications module persists per-user opt-outs here under the `'notifications'` namespace (see [Notifications Module README](../notifications/README.md)).

## REST Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| ALL | `/api/auth/*` | Better Auth | BA HTTP handler (email-OTP, OAuth, passkey, sign-out) |
| GET | `/api/user/wallets` | BA session | List the account's wallets |
| POST | `/api/user/wallets/challenge` | BA session | Mint a challenge |
| POST | `/api/user/wallets` | BA session | Link a wallet |
| DELETE | `/api/user/wallets/:address` | BA session | Unlink a wallet |
| PATCH | `/api/user/wallets/:address/primary` | BA session | Set primary |
| GET | `/api/user/settings` | BA session | Caller's values + user-writable catalog |
| PUT | `/api/user/settings` | BA session | Write one registered setting (`{namespace,key,value}`) |
| DELETE | `/api/user/settings` | BA session | Clear one setting (`?namespace=&key=`) |
| GET | `/api/user/connected-apps` | BA session | The caller's connected apps (`IConnectedApp[]`) |
| DELETE | `/api/user/connected-apps?clientId=` | BA session | Revoke one of the caller's apps (consent and tokens) |
| GET | `/api/user/oauth/authorize-context?client_id=&redirect_uri=&scope=` | BA session | `IOAuthConsentContext` for the consent screen |
| GET | `/.well-known/oauth-authorization-server` | Public | OAuth authorization server metadata (RFC 8414) |
| GET/POST | `/api/admin/users/groups` | `requireAdmin` | List / create group definitions |
| GET/PATCH/DELETE | `/api/admin/users/groups/:id` | `requireAdmin` | Read / update / delete a definition |
| GET | `/api/admin/users/groups/:id/members` | `requireAdmin` | Paginated member ids |
| GET | `/api/admin/users` | `requireAdmin` | Paginated / searched account summaries (`IAccountSummary[]` + total) |
| GET | `/api/admin/users/:id` | `requireAdmin` | One account summary, or 404 |
| PUT | `/api/admin/users/:id/groups` | `requireAdmin` | Set an account's group membership |
| GET | `/api/admin/accounts/search?q=` | `requireAdmin` | Typeahead account search → `{ accounts: IAccountMatch[] }`; backs `context.ui.AccountPicker` |

`/api/admin/users` is a `/:id` catch-all, so it mounts **last**. The literal-segment routers must mount ahead of it: the groups router here, and the traffic module's `/api/admin/users/{traffic,analytics}` routers (TrafficModule runs before this module). Without that order the catch-all would shadow `traffic`, `analytics`, and `groups`.

## Lifecycle

**`init()`** constructs (in order) `GroupService` (with a membership listener that disconnects the user's sockets), `WalletService`, `UserGroupService` (seeds the `admin` group), `AccountDirectoryService`, `UserSettingsService`, the OAuth server config (from `BETTER_AUTH_URL`, falling back to `SITE_URL`, then to `http://localhost:3000` outside production; the same resolved URL becomes Better Auth's `baseURL`, so the auth server and the OAuth issuer cannot disagree), and the Better Auth instance (handed the injected `redis` client for its rate-limit counters, `socketDisconnector` for its session-delete hook, and the OAuth config), then wires the auth facade, builds `ConnectedAppsService` (creating its last-use index) and `OAuthAccessTokenVerifier`, and builds the wallet + group + user-settings + connected-apps controllers. **`run()`** registers the `Users` menu item under the System container and the profile tab row (the `Connected apps` tab carries `requiresGroups: ['mcp-users']`), mounts `/api/auth/*`, `/.well-known/oauth-authorization-server`, the connected-apps and consent-context routers, the wallet router, the user-settings router, the admin group router, the admin accounts router (`/api/admin/users`, the `/:id` catch-all, last), and the admin account-search router (`/api/admin/accounts`, a dedicated literal prefix), then registers `'user-groups'`, `'wallets'`, `'accounts'`, `'user-settings'`.

## Related

- [system-auth.md](../../../../docs/system/system-auth.md) — Better Auth authorization model and predicates
- [Traffic Module README](../traffic/README.md) — the sibling analytics module that mounts the other `/api/admin/users/*` routers
- [Module Architecture](../../../../docs/system/modules/modules-architecture.md) — IModule contract, bootstrap order, service registry
