# Identity Module

Owns Better Auth and everything keyed by the Better Auth user id: the auth instance, the authorization facade, group membership, the wallet store, group-definition registry, and the read-only account directory. Carved out of the former omnibus user module so account identity has a single owner.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `identity` |
| Module class | `src/backend/modules/identity/IdentityModule.ts` |
| Admin page | `/system/users` (menu item `Users`, order 25, registered in `run()`); tabs Users, Groups, Sign-ups, Database, Logs, registered as nodes in the `identity` menu namespace |
| Log service name | `tronrelic:identity`, which the Logs tab is scoped to |
| Service registry names | `'user-groups'`, `'wallets'`, `'accounts'`, `'user-settings'` |
| Mounted routes | `/api/auth/*`, `/.well-known/oauth-authorization-server`, `/api/user/wallets/*`, `/api/user/settings`, `/api/user/connected-apps`, `/api/user/oauth/authorize-context`, `/api/admin/users/groups/*`, `/api/admin/users/sign-ups/*`, `/api/admin/users` (accounts, details, sign-in events, note), `/api/admin/accounts/search` |
| Types package | `@delphian/tronrelic-types` → `IWalletService`, `IAccountDirectoryService`, `IAccountDetails`, `IAccountAdminNote`, `IAccountSession`, `IAccountSignInEvent`, `AccountSortField`, `ACCOUNT_SORT_FIELDS`, `ACCOUNT_NOTE_MAX_LENGTH`, `IUserGroupService`, `IUserSettingsService`, `IConnectedAppsService`, `IConnectedApp`, `IConnectedAppAdminRow`, `IOAuthConsentContext`, `IMcpAccessTokenVerifier`, `ISignupProtectionConfig`, `ISignupProtectionReport`, `IEmailDomainRule`, `DomainBudgetWindow`, `DOMAIN_BUDGET_WINDOW_SECONDS`, `SIGNUP_PROTECTION_LIMITS`, `SIGNUP_REFUSAL_REASONS`, `normalizeEmailDomain` |
| Sign-up protections | Site-wide cap on new accounts per hour and email domain rules, stored in `_kv` under `identity:sign-up-protection`. See [Sign-up Protections](#sign-up-protections) |
| Auth collections | `module_user_auth_users` / `_sessions` / `_accounts` / `_verifications` / `_passkeys` / `_jwks` / `_oauth_clients` / `_oauth_resources` / `_oauth_client_resources` / `_oauth_refresh_tokens` / `_oauth_access_tokens` / `_oauth_consents` / `_oauth_client_assertions` |
| OAuth authorization server | Issuer = site origin; access tokens are JWTs bound to the MCP resource URL; consent page `/oauth/authorize`. See [OAuth Authorization Server](#oauth-authorization-server) |
| Bootstrap getters | `getAccessTokenVerifier()`, `getConnectedAppsService()`, `getOAuthServerConfig()`, `getUserGroupService()`, `getAccountDirectoryService()` — consumed by the MCP module |
| Owned collections | `module_user_wallets`, `module_user_groups`, `module_user_settings`, `module_user_connected_app_usage`, `module_user_sign_in_events` (90-day expiry), `module_user_admin_notes` |
| Fields written onto the Better Auth user record | `deletedAt` (soft delete) and `lastSeenAt` (last signed-in request or MCP call). Neither is a Better Auth additional field |
| User detail panel | Opened from the Users tab of `/system/users`, or directly by `/system/users?tab=users&user=<id>`, which other admin pages (MCP call detail, MCP usage callers, connected apps) link to; reads `GET /api/admin/users/:id/details`. See [User Detail Panel](#user-detail-panel) |
| Migrations | `001_backfill_last_seen_at` — operator-run starting value for `lastSeenAt` |
| AI tools | `identity-list-accounts`, `identity-get-account`, `identity-list-sign-in-events` — read-only, `secret`, admin-only. See [AI Tools](#ai-tools) |
| Bootstrap order | Inits/runs after `TrafficModule` so traffic's `/api/admin/users/{traffic,analytics}` routers mount before the accounts `/api/admin/users` catch-all |

## Why This Module Exists Separately

Better Auth is the sole identity layer — the legacy UUID identity system was removed in the Phase 6 cutover. Keeping BA-keyed concerns in their own module enforces a single-responsibility boundary: **no code outside this module reads `module_user_auth_users` directly** — not even via `IDatabaseService`. The only sanctioned path is `services.get<IAccountDirectoryService>('accounts')`. Wallet and group data follow the same rule through `'wallets'` and `'user-groups'`.

**User id type.** Better Auth's `mongodbAdapter` stores the user `_id` as a native MongoDB `ObjectId` and exposes it as its 24-character hex string (`user.id`). That hex string is the canonical, *opaque* user id everywhere outside this module: store it verbatim, compare it verbatim, never cast it to an `ObjectId`, and never `$lookup` against the user collection's `_id`. The string↔ObjectId conversion lives only in `services/user-id.ts`, used by the services that own the BA collection (`GroupService`, `WalletService`, `AccountDirectoryService`).

## Source Map

| Path | Responsibility |
|------|----------------|
| `IdentityModule.ts` | Two-phase lifecycle; constructs services + auth, mounts routers, registers services |
| `auth.ts` | Better Auth factory (`createAuth`), `Auth` type; takes a raw Mongo `Db` (documented `IDatabaseService` exception) |
| `services/auth-facade.ts` | Session resolution + `isLoggedIn`/`isAdmin`/`isInGroup` predicates over `req.authSession`; `setAuthInstance`; `setActivityRecorder`, which reports every resolved session to the activity tracker |
| `services/auth-constants.ts` | Physical BA collection names (`AUTH_USERS_COLLECTION`, `AUTH_COLLECTIONS`) |
| `services/consumeRedisWindow.ts` | Atomic fixed-window counter in Redis (one Lua step for increment + expiry); shared by both limiters below |
| `services/createRedisRateLimitStorage.ts` | Better Auth `rateLimit.customStorage` — moves BA's per-IP counters from process memory to Redis |
| `services/createAuthBeforeHook.ts` | The Better Auth `hooks.before` middleware: the sign-up protections, then the per-email code limits |
| `services/enforceEmailOtpLimit.ts` | Per-email limits on the OTP send and check endpoints (`EMAIL_OTP_THROTTLE`) |
| `services/createSignInAuditLog.ts` | `hooks.after` middleware logging every sign-in code request and sign-in attempt (`logAuthAttempt`); exports `describeCaller` |
| `services/SignupGuard.ts` | Applies the domain rules and the cap to code requests (before-hook) and to account creation (`databaseHooks.user.create.before`); alerts after creation |
| `services/SignupProtectionConfigStore.ts` | The sign-up protection settings in `_kv`: load, validate, set the cap, add or remove domain rules |
| `services/SignupCapAlerter.ts` | The once-an-hour cap alert (`warn` plus notification), held by a Redis `SET NX EX` key |
| `services/SignupProtectionReportService.ts` | Builds `ISignupProtectionReport` for the Sign-ups tab |
| `services/findEmailDomainRule.ts` | Picks the rule for an address: subdomains match, the longest domain wins |
| `services/ISignupAccountReader.ts` | The two account reads the guard needs (`hasAccount`, `countCreatedSince`) |
| `api/sign-up-protection.{controller,routes}.ts` | `/api/admin/users/sign-ups/*`: the report, the cap, and domain rules |
| `services/SignInEventStore.ts` | `module_user_sign_in_events`: writes from the audit hook, filtered reads for the AI tools, and the indexes including the 90-day expiry |
| `services/ISignInEventRecorder.ts` | The one storage operation the audit hook needs (`record`) |
| `database/ISignInEventDocument.ts` | Sign-in event document, its kinds, the collection name, and the retention period |
| `ai-tools.ts` | The three read-only identity AI tools and their registration on the core `'ai-tools'` registry |
| `services/AccountDetailsService.ts` | Assembles one account's full admin view (`IAccountDetails`) for the detail panel and `identity-get-account` |
| `services/AccountNoteStore.ts` | `module_user_admin_notes`: validate, read, save, and clear the admin note on an account |
| `database/IAccountNoteDocument.ts` | Admin note document and its collection name |
| `services/AccountActivityTracker.ts` | Throttled `$max` writer of `lastSeenAt` on the user record (`LAST_SEEN_WRITE_INTERVAL_MS`, five minutes) |
| `services/IAccountActivityRecorder.ts` | The one operation the facade and the connected-apps service call (`recordSeen`) |
| `services/toSignInEventView.ts` | Stored sign-in event → `IAccountSignInEvent`, shared by the detail panel and the AI tools |
| `migrations/001_backfill_last_seen_at.ts` | Starting `lastSeenAt` from each account's newest session activity and successful sign-in |
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
| `services/AccountDeletionService.ts` | Soft-deletes an account for `/system/users`: the refusal rules, the `deletedAt` mark, and the revocation of sessions, groups, connected apps, and sockets |
| `services/user-settings.service.ts` | Central per-user settings store (`module_user_settings`); the `'user-settings'` contract + definition registry |
| `api/user-settings.{controller,routes}.ts` | `/api/user/settings` self-service surface (BA-session-resolved, registered-definition allow-list) |
| `database/IUserSettingDocument.ts` | `module_user_settings` document (`(userId, namespace, key)` → opaque value) |
| `api/wallet.{controller,routes}.ts` | `/api/user/wallets/*` (BA-session-resolved, no `:id` on the wire) |
| `api/user-group.{controller,routes}.ts` | `/api/admin/users/groups/*` admin CRUD + membership |
| `api/accounts.{controller,routes}.ts` | `/api/admin/users` admin account directory (sorted list, details, sign-in events, admin note, per-account group assignment, and soft delete) over the `'accounts'` service, `AccountDetailsService`, `AccountNoteStore`, and `AccountDeletionService` |
| `database/IWalletDocument.ts` | `module_user_wallets` document + `ILinkedWallet` public shape |
| `database/IUserGroupDocument.ts` | `module_user_groups` document |
| `services/oauth-server-config.ts` | `resolveOAuthServerConfig` — issuer, MCP resource URL, metadata URL, public endpoint, Server Card (and its earlier alias) and AI Catalog URLs, and consent page path from one base URL |
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
| Per-email throttle | Lowercased email | 5 codes sent / hour; 10 code checks / hour across `/sign-in/email-otp`, `/email-otp/check-verification-otp`, `/email-otp/verify-email` | `enforceEmailOtpLimit` |
| Sign-up protections | Email domain, and the whole site | Admin-set; new addresses only. See [Sign-up Protections](#sign-up-protections) | `SignupGuard` |

The per-email layer exists because the per-IP layer alone lets anyone who rotates IP addresses keep guessing a victim's code, about three guesses a minute per extra address, or flood an inbox with codes. Refusals return `429` and log a warning with the email domain only.

Both layers let a request through and log an error when Redis is unreachable, because refusing would stop every sign-in for the length of the outage. Codes are stored hashed (`storeOTP: 'hashed'`), so reading `module_user_auth_verifications` does not reveal a pending code. A recipient Resend refuses as invalid (`validation_error`) is logged as a warning; any other send failure is an error, because it stops all email sign-in.

## Sign-in Audit Log

Every sign-in code request and sign-in attempt writes a log entry under `tronrelic:identity`, so an operator who receives a code they did not ask for can see who requested it and whether a sign-in followed. Read the entries on the Logs tab of `/system/users`.

| Message | Level | Written by | Fields |
|---------|-------|------------|--------|
| `Sign-in code sent` | info | `createSignInAuditLog` | `email`, `ip`, `forwardedFor`, `country`, `userAgent` |
| `Sign-in code request failed` | warn | `createSignInAuditLog` | the same, plus `status`, `reason` |
| `Sign-in succeeded` | info | `createSignInAuditLog` | `method` (`email-otp`, `passkey`, `oauth:<provider>`), `email`, `userId`, `sessionId`, caller fields |
| `Sign-in failed` | warn | `createSignInAuditLog` | `method`, `email` when the request named one, `status`, `reason`, caller fields |
| `Account created` | info | `databaseHooks.user.create.after` | `userId`, `email`, `emailVerified` |
| `Session ended` | info | `databaseHooks.session.delete.after` | `userId`, `sessionId`; covers sign-out, revocation, and expiry cleanup |
| `Auth rate limit reached; request refused` | warn | `createRedisRateLimitStorage` | `key` (caller address and path), `retryAfter`; once per key per window |
| `Per-email OTP limit reached; request refused` | warn | `enforceEmailOtpLimit` | `emailDomain`, `bucket`, `retryAfter` |
| `Sign-in code request refused by a sign-up protection` | warn | `SignupGuard` | `emailDomain`, `reason`, `ip`, `country` |
| `Account creation refused: …` | warn | `SignupGuard` | `emailDomain`, and for the cap `createdLastHour`, `maxPerHour` |
| `New accounts reached the sign-up cap: …` | warn | `SignupCapAlerter` | `createdLastHour`, `maxPerHour`, `mode`; at most once an hour |
| `Sign-up cap changed`, `Email domain rule saved: …`, `Email domain rule removed: …` | info | `SignupProtectionConfigStore` | the change and the acting admin |

`ip` is `CF-Connecting-IP`, which Cloudflare sets, falling back to the first `X-Forwarded-For` entry. The full email address is logged, so anyone who can read these logs, including a user group granted the system-log AI tools on `/system/mcp`, can see which addresses signed in. The one-time code and the session token are never logged, and every value copied from the request is cut to a fixed length.

A request refused by either limiter never reaches the audit hook, which is why the two limiters log their own refusals. A code request refused by a sign-up protection never reaches it either, so `SignupGuard` stores that refusal as a `code-request-failed` event itself, with the reason code from `SIGNUP_REFUSAL_REASONS`.

A request whose body fails Better Auth's schema, such as a code request with no email, is logged as a failure with reason `VALIDATION_ERROR`. Better Auth reports these with better-call's `ValidationError`, which is not a subclass of its `APIError`, so the hook tests a result with Better Auth's `isAPIError` rather than `instanceof APIError`. An `instanceof` test records these refusals as codes sent.

### Stored sign-in events

The four `createSignInAuditLog` rows above are also stored in `module_user_sign_in_events`, one document per event, because a log entry keeps its details in an unindexed context payload and cannot be searched by address or caller. A failure to store an event is logged at `error` and does not fail the sign-in.

| Field | Contents |
|-------|----------|
| `kind` | `code-sent`, `code-request-failed`, `sign-in-succeeded`, or `sign-in-failed` |
| `method`, `path` | Sign-in method and the Better Auth endpoint |
| `email`, `userId`, `sessionId` | Who the event concerns; `userId` and `sessionId` only on a success |
| `ip`, `forwardedFor`, `country`, `userAgent` | The caller |
| `status`, `reason` | Why a request failed; null on a success |
| `occurredAt` | A Date, so the expiry index can act on it |

Indexes: `{ occurredAt }` with a 90-day time-to-live (`SIGN_IN_EVENT_RETENTION_DAYS`), and `{ email, occurredAt }`, `{ userId, occurredAt }`, `{ ip, occurredAt }` for lookups. MongoDB deletes expired documents itself, so the module needs no scheduler job. `Account created`, `Session ended`, and the limiter refusals are log entries only.

## Sign-up Protections

The per-IP and per-email limits cannot see an account farm that uses a new random address and a new network address for every account, which is what a prober did on 15 Nov 2026: eight accounts on a disposable domain in 45 minutes. Two admin-set protections cover that case, edited on the Sign-ups tab of `/system/users`. **Neither ever applies to an address that already has an account**, so no setting can lock out an existing user.

| Protection | Settings | Effect |
|------------|----------|--------|
| Site-wide cap | `mode` (`off`, `alert`, `enforce`) and `maxPerHour` (1–10,000) | Counts accounts created in the last 60 minutes, by every sign-in method. At or above the maximum: `alert` notifies admins and refuses nobody; `enforce` notifies admins and refuses new accounts with `429 SIGN_UPS_PAUSED`. Starts at `alert`, 10 per hour (`SIGNUP_PROTECTION_LIMITS.defaultCap`) |
| Domain rule, `block` | `domain`, optional `note` | Refuses new addresses on the domain and its subdomains with `403 EMAIL_DOMAIN_BLOCKED`, by every sign-in method |
| Domain rule, `slow` | `domain`, `maxCodes` (1–1,000), `budgetWindow` (`hour` or `day`, default `hour`), optional `note` | Every new address on the domain shares one budget of sign-in codes per window, counted in Redis under `<REDIS_NAMESPACE>:auth:signup-domain:<window>:<rule domain>`. The window is fixed, not rolling: it starts with the first code and resets an hour or 24 hours later (`DOMAIN_BUDGET_WINDOW_SECONDS`). The window is part of the key, so switching a rule between hourly and daily starts a fresh count. Over budget: `429 EMAIL_DOMAIN_SLOWED` |

**Where they run.** `SignupGuard.checkCodeRequest` runs first in the before-hook (`createAuthBeforeHook`), on `/email-otp/send-verification-otp`, so a refused visitor learns before waiting for an email and no Resend quota is spent. It checks block, then the enforced cap, then the domain budget, so a request refused for another reason does not spend the budget. `SignupGuard.checkAccountCreation` runs in `databaseHooks.user.create.before`, which every account creation passes through, including Google and GitHub sign-in, which never request a code; only `block` and the enforced cap apply there. `noteAccountCreated` runs in `user.create.after` and alerts when the new account brought the count up to the cap.

**Matching.** A rule matches its domain and every subdomain (`example.com` covers `mail.example.com`, not `badexample.com`), and the longest matching domain wins, so a subdomain can be slowed under a blocked parent. Domains are normalized by `normalizeEmailDomain` in `@/types`, which the admin form uses too: lowercase, no leading `@` or trailing dot, two or more labels, internationalised domains in their `xn--` form. At most 500 rules.

**The alert.** `SignupCapAlerter` writes a `warn` entry and sends a notification in category `identity.signup-cap-reached` (content type `identity:signup-cap-reached`, default audience the `admin` group, toast channel), at most once an hour. The hour is held by a Redis key set with `SET NX EX 3600` under `<REDIS_NAMESPACE>:auth:signup-cap-alert`, so concurrent sign-ups, a restart, and a second process all send one alert; the key's value is the alert time the report shows. The category is registered when the `'notifications'` service appears, because the notifications module runs after this one.

**Rules stored before the budget window.** A `slow` rule saved before `budgetWindow` existed holds `maxCodesPerHour` and no window. `SignupProtectionConfigStore.normalize` reads it as that many codes per hour, which is what it meant, and the next save writes it in the new form. No migration is needed.

**Limits of the design.**
- The count is read, then compared, so a burst of simultaneous sign-ups can pass the cap by a few accounts. It is a brake, not a quota.
- Deleted accounts are counted, because deleting a farm's accounts does not slow the farm.
- A Redis failure lets a slowed domain through and logs an error, like the other limiters. A failure claiming the alert skips the alert and logs an error.
- The settings are cached in memory at startup and replaced on every save, so a second backend process would serve its own copy until it restarts.

**The report.** `GET /api/admin/users/sign-ups` answers `ISignupProtectionReport`: the settings; accounts created in the last hour and 24 hours, whether the cap is reached, and the last alert time; refusals per reason code over 24 hours and 7 days, read from the stored sign-in events; and the 25 busiest email domains over 7 days, merging new accounts (from the account collection, grouped by domain) with refusals, each with the rule that matches it today. The tab offers a one-click Block on each domain without a block rule. Every write endpoint answers with the same report.

## Deleting an Account

An admin deletes an account from the Users tab of `/system/users`. The deletion is a soft delete: the row in `module_user_auth_users` is kept and marked, because audit logs, sign-in events, and content records name the user id and must still resolve to a person. The kept row also keeps the email address reserved, so nobody can register it again and be mistaken for the original owner. There is no restore action and no hard delete.

`AccountDeletionService.softDelete` does the work, in this order:

| Step | Effect |
|------|--------|
| Leave the admin group | `GroupService.removeAdminKeepingOne`; the deletion is refused here when the target is the only live admin |
| Mark the row | Sets `deletedAt`, `deletedBy` (the admin's user id), and `groupsAtDeletion` |
| Delete sessions | Through Better Auth's `deleteUserSessions`, so every device is signed out |
| Clear groups | `setUserGroups(userId, [])`, so the account no longer counts as an admin or an `mcp-users` member |
| Revoke connected apps | `ConnectedAppsService.revokeAllForUser` |
| Disconnect sockets | Through `IIdentitySocketDisconnector` |

A deleted account cannot sign in again. `databaseHooks.session.create.before` in `auth.ts` asks `isAccountDeleted` before every new session and answers `403` for a marked account, whichever sign-in method was used. Repeating the request for an already deleted account runs the revocations again and leaves the original mark, so a request that failed partway can be retried.

`DELETE /api/admin/users/:id` is protected by four checks:

| Check | Where | Result when it fails |
|-------|-------|----------------------|
| Signed-in admin only | `requireAdminUser` on the route; the `ADMIN_API_TOKEN` service path is refused, so every deletion has a named admin | `403` |
| Rate limit | 20 deletions per 10 minutes per caller IP address (`ACCOUNT_DELETE_RATE_LIMIT` in `IdentityModule.ts`) | `429` |
| Typed email | The body's `confirmEmail` must equal the account's email, compared case-insensitively by the service | `400 EmailMismatch` |
| Guards | The service refuses the caller's own account and the only member of the `admin` group | `409 CannotDeleteSelf`, `409 LastAdmin` |

**At least one live admin always remains.** `GroupService.removeAdminKeepingOne` is the one place an admin is removed, and account deletion, `removeMember`, and `setUserGroups` (the group editor on the Users tab) all go through it. It removes `admin` from the user in one atomic update, then counts the live admins left, and puts `admin` back and refuses when there are none. The count comes after the removal so that two requests running together cannot both succeed; the database has no multi-document transactions to do it another way. A deleted account is not counted as live. The group editor answers `409 LastAdmin` when refused.

`IAccountSummary.deletedAt` is null for a live account. The Users tab shows a deleted account with a `Deleted` badge and one action, `Revoke again`, which opens the same confirmation modal and repeats the request. That action is there because a deletion that failed at the session, group, or connected-app step leaves the account marked while its existing sessions and connected apps still work; `deletedAt` is enforced only when a new session is created. Sign-in events for the account stay in `module_user_sign_in_events` until their normal 90-day expiry.

## User Detail Panel

The Users tab of `/system/users` lists accounts in a table that sorts on every column (`ACCOUNT_SORT_FIELDS`: email, name, status, primary wallet, groups, created, last seen). The Wallet column shows only a tick when a primary wallet is set; the address is in the detail panel. Clicking an email or **Details** opens the panel, a slide-over (`UserDetailPanel` in `src/frontend/modules/user/components/admin/`) showing the account, the admin note editor, wallets, live sessions, connected apps, and the sign-in events naming the account's email, with older events paged on request.

| Piece | How it works |
|-------|--------------|
| Details | `GET /api/admin/users/:id/details` answers `IAccountDetails`, built by `AccountDetailsService`. `identity-get-account` reads through the same service, so the panel and the tool cannot disagree. At most 25 sessions and 20 events; session tokens never leave `IdentityModule.listAccountSessions` |
| Older sign-in events | `GET /api/admin/users/:id/sign-in-events?limit=&offset=` (limit at most 100) |
| Admin note | `PUT /api/admin/users/:id/note` with `{ note }`, at most `ACCOUNT_NOTE_MAX_LENGTH` (5,000) characters; an empty string clears it. Stored in `module_user_admin_notes` with `updatedAt` and `updatedBy` (null for the admin API token). The response names the editor by email |
| Last seen | `lastSeenAt` on the user record. The auth facade calls `recordSeen` for every session it resolves, which covers every signed-in HTTP request and socket handshake, and `ConnectedAppsService.recordUse` calls it for every MCP request |
| Sort | `GET /api/admin/users?sortBy=&sortDirection=`; an unknown value is answered with `400 InvalidSort`. Default `createdAt` `desc` |

**Why notes are not on the user record.** Fields on the Better Auth user record can travel with the user's own session, and a note written about a person must never reach them. The note text is also kept out of the log; `Account admin note saved` records the account, the admin, and the length only.

**Last seen accuracy.** `AccountActivityTracker` writes at most once per account every five minutes per process, with `$max` so a slower process cannot move the time backwards, and never makes a request wait for the write. A failed write is logged at `warn` and retried on the next request. An account shows as never seen until its first request after deployment, or until an operator runs the `001_backfill_last_seen_at` migration from `/system/database`, which takes the newest of each account's stored session `updatedAt` and its newest successful sign-in event.

**How the sort works.** `AccountDirectoryService.listAccounts` computes each column's sort value in an aggregation (`SORT_KEYS`): status orders deleted, then unverified, then verified; the wallet column orders accounts without a primary wallet first; groups sorts by how many; a never-seen account sorts as the oldest. Text compares without regard to case, and the account id breaks ties so paging is stable. No index serves a computed value, so every matching account is read to order a page. That is fine for thousands of accounts; a much larger directory would need the computed columns stored and indexed.

## AI Tools

Three read-only tools let an AI agent review accounts and sign-in activity. They register on the core `'ai-tools'` registry through `watch()` under provider id `identity`.

| Tool | Input | Returns |
|------|-------|---------|
| `identity-list-accounts` | `search` (substring of email or name), `sortBy` (one of `ACCOUNT_SORT_FIELDS`, default `createdAt`), `sortDirection` (`asc` or `desc`, default `desc`), `limit` (default 25, at most 100), `offset` | `total`, `offset`, `returned`, `nextOffset`, the sort as applied, and `accounts[]` of `{ id, email, name, emailVerified, createdAt, groups, primaryWallet, deletedAt, lastSeenAt }`; `deletedAt` is null unless an admin deleted the account, and `lastSeenAt` is null for an account not seen since recording began |
| `identity-get-account` | Exactly one of `userId` and `email` (exact address) | `found`; when true, the `IAccountDetails` of the detail panel: `account` (with `lastSeenAt`), `adminNote` (`{ note, updatedAt, updatedBy, updatedByEmail }` or null), `sessions[]` (at most 25: `id`, `createdAt`, `updatedAt`, `expiresAt`, `ipAddress`, `userAgent`), `sessionsTruncated`, `wallets[]`, `connectedApps[]`, `recentSignInEvents[]` (at most 20, matched by the account's email), `signInEventsTotal` |
| `identity-list-sign-in-events` | All optional: `email`, `userId`, `ip`, `method`, `kind`, `since`, `until` (ISO 8601), `limit` (default 50, at most 200), `offset` | `filters` as applied, `total`, `offset`, `returned`, `nextOffset`, and `events[]` newest first with every stored field except `path` |

**Classification.** All three declare `read` / reversible / `secret` / `surfacesUntrustedContent`. `secret` because every result holds other users' email addresses and network addresses. As a result they fail the MCP safety floor, so an admin must clear a user group for restricted tools on `/system/mcp` before granting one, and they count as a private-data leg of the trifecta banner while enabled. Like every read tool they ship enabled; disable them on the Registry tab of `/system/ai-tools` if the deployment does not need them. `surfacesUntrustedContent` because names, addresses, and `userAgent` values are written by the people the records describe.

**Admin check.** Each handler refuses a signed-in caller who is not in the `admin` group, using the principal the governor supplies, and logs the refusal at `warn`. A call with no principal comes from the server itself and is allowed. This is on top of the MCP grant, so a group granted a tool by mistake still cannot read other users' data.

**What is never returned.** Session tokens (sessions are copied field by field in `IdentityModule.listAccountSessions`), one-time codes and their hashes, OAuth tokens, and passkey credentials. The tools change nothing: ending a session, changing a group, or editing the admin note stays on `/system/users`.

## OAuth Authorization Server

The Better Auth instance is also an OAuth 2.1 authorization server, so connected apps (MCP clients such as Claude) can act for a user after that user signs in and approves them. `buildOAuthPlugins` in `auth.ts` adds four plugins:

| Plugin | Configuration that matters |
|---|---|
| `jwt` | `issuer` set to the site origin (unset it would be `<origin>/api/auth`); session JWT header disabled; keys in `module_user_auth_jwks` |
| `oauthProvider` | Scopes `mcp:tools` and `offline_access` (no `openid`); grants `authorization_code` and `refresh_token` only; one resource, the MCP URL, linked to every client by default; access tokens 15 minutes, refresh tokens 30 days with rotation and a 30-second reuse window; dynamic client registration off; only admins may create clients (`clientPrivileges`); login and consent page `/oauth/authorize` |
| `mcp-consent-gate` | A `hooks.before` on `/oauth2/consent` that answers `403 access_denied` when a user outside `mcp-users` approves. Denials pass through |
| `cimd` | Clients identify themselves with a metadata document URL, fetched through `@better-auth/cimd/node` (resolve-once, public addresses only, no redirects) after `assertPublicHttpUrl` and the MCP module's admission rule both accept it; `onClientRefreshed` hands that rule the app's details before and after a re-read; `metadataProfile: 'mcp-2026-07-28'` |

**Which apps may register.** The rule is the MCP module's, not this module's. `IdentityModule.init()` receives it as `oauthClientAdmission` (`IMcpClientAdmissionPolicy`) and `auth.ts` calls `isAllowed` before any metadata document is fetched, so an app on a host outside the MCP module's allowed list is never fetched and never stored. Refusals are logged by that rule under `tronrelic:mcp`, and so appear on the Logs tab of `/system/mcp` and not on this module's. See [App Admission](../mcp/README.md#app-admission) for the allowed hosts and how to add one.

**Every account joins `mcp-users`.** `databaseHooks.user.create.after` calls `joinMcpUsers` after the admin auto-promotion, so a person who signs up from an MCP client's Connect prompt can finish the authorization instead of being refused at consent. A failure is logged at `error` and does not stop the account being created. Accounts created before this rule are added by an admin on `/system/users`. Removing someone from `mcp-users` still revokes their connected apps (see below), so it doubles as an MCP ban.

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

**What a caller is told.** The wallet service throws `WalletUserError` (`services/WalletUserError.ts`) for failures the caller caused, with a logged `message` and a `userMessage` for the response. The two differ only for a wallet another account owns: the log says so, and the caller reads "This wallet can't be added to this account. If you linked it before, sign in with that account." `WalletController.sendFailure` answers a `WalletUserError` or a `ValidationError` with 400 and that text, and anything else with 500 and a generic message per operation, so an internal error's text never reaches the browser. Every failure is logged in full at `error`.

Every method takes the resolved Better Auth user id first — the service never reads cookies/sessions. Mutations denormalize the primary address onto the BA user record so the session surfaces it without a second query. After a successful `linkWallet`, the service fires the `http.walletLinked` observer hook (`{ userId, address }`) so feature modules react to new verified ownership without identity depending on them — account-history enrolls the address into its backfill. See [system-hooks.md](../../../../docs/system/system-hooks.md).

### `'accounts'` → `IAccountDirectoryService`

| Method | Purpose |
|--------|---------|
| `countAccounts()` | Total BA account count |
| `getAccount(baUserId)` | One account summary, or null |
| `getAccountByEmail(email)` | One account summary matched on the whole address, case-insensitively, or null. Use instead of searching `listAccounts` for an address, whose substring match plus page limit can hide the account |
| `getAccountsByIds(baUserIds)` | Summaries for a page of ids in one `$in` query; ids with no account are left out, order not guaranteed |
| `listAccounts(options?)` | Paginated/searched summaries + unpaginated total, sorted by `sortBy`/`sortDirection` (default newest first). See [User Detail Panel](#user-detail-panel) for how each column sorts |

Every summary carries `lastSeenAt`, the last signed-in request or MCP call, accurate to about five minutes and null for an account not yet seen.

### `'user-groups'` → `IUserGroupService`

Group definitions and membership. See `@/types` `IUserGroupService` for the full method surface; `isAdmin(userId)` is the canonical per-user admin check.

The id `anonymous` is reserved and `createGroup` refuses it: the MCP module uses it for a virtual group standing for callers of its public endpoint, and stores that group's grants and limits under the id, so a real group with it would inherit them. Group ids are otherwise reusable: after a group is deleted, a new one can be created under the same id. So after a successful `deleteGroup`, the service fires the `http.groupDeleted` observer hook (`{ groupId }`), and components that stored something against the id remove it. The MCP module uses it to delete the group's tool grants and group policy. See [system-hooks.md](../../../../docs/system/system-hooks.md).

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
| GET | `/api/admin/users/sign-ups` | `requireAdmin` | `ISignupProtectionReport`: the sign-up protection settings and the sign-up report |
| PUT | `/api/admin/users/sign-ups/cap` | `requireAdmin` | Replace the cap; body `{ mode, maxPerHour }`. 400 names the field to fix |
| PUT | `/api/admin/users/sign-ups/domains/:domain` | `requireAdmin` | Add or replace a domain rule; body `{ action, maxCodes?, budgetWindow?, note? }`. 400 for a bad field, 409 at 500 rules |
| DELETE | `/api/admin/users/sign-ups/domains/:domain` | `requireAdmin` | Remove a domain rule; 404 when none exists |
| GET | `/api/admin/users` | `requireAdmin` | Paginated / searched / sorted account summaries (`IAccountSummary[]` + total); `sortBy`, `sortDirection` |
| GET | `/api/admin/users/:id/details` | `requireAdmin` | `IAccountDetails` for the user detail panel; 400 bad id, 404 unknown account |
| GET | `/api/admin/users/:id/sign-in-events` | `requireAdmin` | `{ events, total }`, a page of the sign-in events naming the account's email; `limit` (at most 100), `offset` |
| PUT | `/api/admin/users/:id/note` | `requireAdmin` | Save or clear the admin note; body `{ note }`. Answers `{ adminNote }` |
| GET | `/api/admin/users/:id` | `requireAdmin` | One account summary, or 404 |
| PUT | `/api/admin/users/:id/groups` | `requireAdmin` | Set an account's group membership |
| DELETE | `/api/admin/users/:id` | `requireAdmin` + `requireAdminUser`, rate-limited | Soft-delete an account; body `{ confirmEmail }`. See [Deleting an Account](#deleting-an-account) |
| GET | `/api/admin/accounts/search?q=` | `requireAdmin` | Typeahead account search → `{ accounts: IAccountMatch[] }`; backs `context.ui.AccountPicker` |

`/api/admin/users` is a `/:id` catch-all, so it mounts **last**. The literal-segment routers must mount ahead of it: the groups and sign-ups routers here, and the traffic module's `/api/admin/users/{traffic,analytics}` routers (TrafficModule runs before this module). Without that order the catch-all would shadow `traffic`, `analytics`, and `groups`.

## Lifecycle

**`init()`** constructs (in order) `GroupService` (with a membership listener that disconnects the user's sockets), `WalletService`, `UserGroupService` (seeds the `admin` group), `AccountDirectoryService`, `UserSettingsService`, the OAuth server config (from `BETTER_AUTH_URL`, falling back to `SITE_URL`, then to `http://localhost:3000` outside production; the same resolved URL becomes Better Auth's `baseURL`, so the auth server and the OAuth issuer cannot disagree), and the Better Auth instance (handed the injected `redis` client for its rate-limit counters, `socketDisconnector` for its session-delete hook, the OAuth config, and the injected `oauthClientAdmission` rule for which apps may register), then wires the auth facade, builds `ConnectedAppsService` (creating its last-use index), `OAuthAccessTokenVerifier`, and `AccountDeletionService`, and builds the wallet + group + user-settings + connected-apps controllers. **`run()`** registers the `Users` menu item under the System container, the `/system/users` tab row (the `identity` namespace, every node `requiresAdmin`), and the profile tab row (the `Connected apps` tab carries `requiresGroups: ['mcp-users']`), mounts `/api/auth/*`, `/.well-known/oauth-authorization-server`, the connected-apps and consent-context routers, the wallet router, the user-settings router, the admin group router, the admin accounts router (`/api/admin/users`, the `/:id` catch-all, last), and the admin account-search router (`/api/admin/accounts`, a dedicated literal prefix), then registers `'user-groups'`, `'wallets'`, `'accounts'`, `'user-settings'`, and watches `'ai-tools'` to register the three identity AI tools. `init()` also builds `AccountActivityTracker` (handed to the facade with `setActivityRecorder` and to `ConnectedAppsService`) and `AccountNoteStore` with its unique index right after the account directory, and builds `AccountDetailsService` after the connected-apps service, for the accounts controller and the AI tools. It builds `SignInEventStore` and creates its indexes before the Better Auth instance, which receives it as the audit hook's recorder. It creates the `createdAt` index on the account collection the cap counts against, loads `SignupProtectionConfigStore`, and builds `SignupCapAlerter` and `SignupGuard` before the auth instance, which receives the guard. `run()` mounts `/api/admin/users/sign-ups` before the accounts catch-all and watches `'notifications'` to register the cap alert's category.

## Related

- [system-auth.md](../../../../docs/system/system-auth.md) — Better Auth authorization model and predicates
- [Traffic Module README](../traffic/README.md) — the sibling analytics module that mounts the other `/api/admin/users/*` routers
- [Module Architecture](../../../../docs/system/modules/modules-architecture.md) — IModule contract, bootstrap order, service registry
