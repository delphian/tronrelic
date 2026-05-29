# Identity Module

Owns Better Auth and everything keyed by the Better Auth user id: the auth instance, the authorization facade, group membership, the wallet store, group-definition registry, and the read-only account directory. Carved out of the former omnibus user module so account identity has a single owner.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `identity` |
| Module class | `src/backend/modules/identity/IdentityModule.ts` |
| Service registry names | `'user-groups'`, `'wallets'`, `'accounts'` |
| Mounted routes | `/api/auth/*`, `/api/user/wallets/*`, `/api/admin/users/groups/*` |
| Types package | `@delphian/tronrelic-types` → `IWalletService`, `IAccountDirectoryService`, `IUserGroupService` |
| Auth collections | `module_user_auth_users` / `_sessions` / `_accounts` / `_verifications` / `_passkeys` |
| Owned collections | `module_user_wallets`, `module_user_groups` |
| Bootstrap order | Inits and runs **before** `UserModule` (legacy code resolves these singletons during transition) |

## Why This Module Exists Separately

The legacy UUID identity system and Better Auth coexist until the Phase 6 cutover. Splitting BA-keyed concerns into their own module enforces a single-responsibility boundary: **no code outside this module reads `module_user_auth_users` directly** — not even via `IDatabaseService`. The only sanctioned path is `services.get<IAccountDirectoryService>('accounts')`. Wallet and group data follow the same rule through `'wallets'` and `'user-groups'`.

## Source Map

| Path | Responsibility |
|------|----------------|
| `IdentityModule.ts` | Two-phase lifecycle; constructs services + auth, mounts routers, registers services |
| `auth.ts` | Better Auth factory (`createAuth`), `Auth` type; takes a raw Mongo `Db` (documented `IDatabaseService` exception) |
| `services/auth-facade.ts` | Session resolution + `isLoggedIn`/`isAdmin`/`isInGroup` predicates over `req.authSession`; `setAuthInstance` |
| `services/auth-constants.ts` | Physical BA collection names (`AUTH_USERS_COLLECTION`, `AUTH_COLLECTIONS`) |
| `services/group.service.ts` | Membership primitive over the BA `groups` field; `ADMIN_GROUP_ID` |
| `services/user-group.service.ts` | Group-definition registry + the `'user-groups'` contract; composes `GroupService` |
| `services/wallet.service.ts` | BA-keyed wallet store (`module_user_wallets`); the `'wallets'` contract |
| `services/wallet-challenge.service.ts` | Single-use nonce mint/consume for wallet mutations (utility, not a singleton) |
| `services/account-directory.service.ts` | Read-only directory over BA accounts; the `'accounts'` contract |
| `api/wallet.{controller,routes}.ts` | `/api/user/wallets/*` (BA-session-resolved, no `:id` on the wire) |
| `api/user-group.{controller,routes}.ts` | `/api/admin/users/groups/*` admin CRUD + membership |
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

Every method takes the resolved Better Auth user id first — the service never reads cookies/sessions. Mutations denormalize the primary address onto the BA user record so the session surfaces it without a second query.

### `'accounts'` → `IAccountDirectoryService`

| Method | Purpose |
|--------|---------|
| `countAccounts()` | Total BA account count |
| `getAccount(baUserId)` | One account summary, or null |
| `listAccounts(options?)` | Paginated/searched summaries + unpaginated total |

### `'user-groups'` → `IUserGroupService`

Group definitions and membership. See `@/types` `IUserGroupService` for the full method surface; `isAdmin(userId)` is the canonical per-user admin check.

## REST Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| ALL | `/api/auth/*` | Better Auth | BA HTTP handler (email-OTP, OAuth, passkey, sign-out) |
| GET | `/api/user/wallets` | BA session | List the account's wallets |
| POST | `/api/user/wallets/challenge` | BA session | Mint a challenge |
| POST | `/api/user/wallets` | BA session | Link a wallet |
| DELETE | `/api/user/wallets/:address` | BA session | Unlink a wallet |
| PATCH | `/api/user/wallets/:address/primary` | BA session | Set primary |
| GET/POST | `/api/admin/users/groups` | `requireAdmin` | List / create group definitions |
| GET/PATCH/DELETE | `/api/admin/users/groups/:id` | `requireAdmin` | Read / update / delete a definition |
| GET | `/api/admin/users/groups/:id/members` | `requireAdmin` | Paginated member ids |

The wallet and group routers mount **before** the legacy `/api/user` and `/api/admin/users` routers (UserModule runs after this module) so their literal segments win over the legacy `/:id` matchers.

## Lifecycle

**`init()`** constructs (in order) `GroupService`, `WalletService`, `UserGroupService` (seeds the `admin` group), `AccountDirectoryService`, and the Better Auth instance, then wires the auth facade and builds the wallet + group controllers. **`run()`** mounts `/api/auth/*`, the wallet router, and the admin group router, then registers `'user-groups'`, `'wallets'`, `'accounts'`.

## Related

- [system-auth.md](../../../../docs/system/system-auth.md) — Better Auth authorization model and predicates
- [User Module README](../user/README.md) — legacy UUID identity surface (removed in Phase 6)
- [Module Architecture](../../../../docs/system/modules/modules-architecture.md) — IModule contract, bootstrap order, service registry
