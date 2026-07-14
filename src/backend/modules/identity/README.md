# Identity Module

Owns Better Auth and everything keyed by the Better Auth user id: the auth instance, the authorization facade, group membership, the wallet store, group-definition registry, and the read-only account directory. Carved out of the former omnibus user module so account identity has a single owner.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `identity` |
| Module class | `src/backend/modules/identity/IdentityModule.ts` |
| Admin page | `/system/users` (menu item `Users`, order 25, registered in `run()`) |
| Service registry names | `'user-groups'`, `'wallets'`, `'accounts'`, `'user-settings'` |
| Mounted routes | `/api/auth/*`, `/api/user/wallets/*`, `/api/user/settings`, `/api/admin/users/groups/*`, `/api/admin/users` (accounts), `/api/admin/accounts/search` |
| Types package | `@delphian/tronrelic-types` → `IWalletService`, `IAccountDirectoryService`, `IUserGroupService`, `IUserSettingsService` |
| Auth collections | `module_user_auth_users` / `_sessions` / `_accounts` / `_verifications` / `_passkeys` |
| Owned collections | `module_user_wallets`, `module_user_groups`, `module_user_settings` |
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
| `listAccounts(options?)` | Paginated/searched summaries + unpaginated total |

### `'user-groups'` → `IUserGroupService`

Group definitions and membership. See `@/types` `IUserGroupService` for the full method surface; `isAdmin(userId)` is the canonical per-user admin check.

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
| GET/POST | `/api/admin/users/groups` | `requireAdmin` | List / create group definitions |
| GET/PATCH/DELETE | `/api/admin/users/groups/:id` | `requireAdmin` | Read / update / delete a definition |
| GET | `/api/admin/users/groups/:id/members` | `requireAdmin` | Paginated member ids |
| GET | `/api/admin/users` | `requireAdmin` | Paginated / searched account summaries (`IAccountSummary[]` + total) |
| GET | `/api/admin/users/:id` | `requireAdmin` | One account summary, or 404 |
| PUT | `/api/admin/users/:id/groups` | `requireAdmin` | Set an account's group membership |
| GET | `/api/admin/accounts/search?q=` | `requireAdmin` | Typeahead account search → `{ accounts: IAccountMatch[] }`; backs `context.ui.AccountPicker` |

`/api/admin/users` is a `/:id` catch-all, so it mounts **last**. The literal-segment routers must mount ahead of it: the groups router here, and the traffic module's `/api/admin/users/{traffic,analytics}` routers (TrafficModule runs before this module). Without that order the catch-all would shadow `traffic`, `analytics`, and `groups`.

## Lifecycle

**`init()`** constructs (in order) `GroupService`, `WalletService`, `UserGroupService` (seeds the `admin` group), `AccountDirectoryService`, `UserSettingsService`, and the Better Auth instance, then wires the auth facade and builds the wallet + group + user-settings controllers. **`run()`** registers the `Users` menu item under the System container, mounts `/api/auth/*`, the wallet router, the user-settings router, the admin group router, the admin accounts router (`/api/admin/users`, the `/:id` catch-all, last), and the admin account-search router (`/api/admin/accounts`, a dedicated literal prefix), then registers `'user-groups'`, `'wallets'`, `'accounts'`, `'user-settings'`.

## Related

- [system-auth.md](../../../../docs/system/system-auth.md) — Better Auth authorization model and predicates
- [Traffic Module README](../traffic/README.md) — the sibling analytics module that mounts the other `/api/admin/users/*` routers
- [Module Architecture](../../../../docs/system/modules/modules-architecture.md) — IModule contract, bootstrap order, service registry
