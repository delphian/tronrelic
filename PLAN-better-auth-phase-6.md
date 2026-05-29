# Better Auth Phase 6 — Module Restructure + Full Legacy Cutover

Canonical plan for finishing the Better Auth migration. Captures the architectural decisions reached in conversation and the committed state of the cutover branch. **Resume from this document.** Do not relitigate locked decisions. Do not subdivide phases beyond what is here.

Branch: `feat/auth-phase-6-cutover` (in the `tronrelic/` clone, not the ops repo).

End state: Better Auth as the sole identity layer; focused modules (`identity`, `traffic`, slim `user`) replacing the omnibus user module; legacy `users` collection dropped; `@delphian/tronrelic-types` 3.0.0 published.

## Why This Document Exists

Phase 6 spans multiple working sessions and context clears. Without one durable plan, every resumption costs re-discovery of decisions and re-debate of scope. This file is the single source of truth for "what is the next action, what is already decided." It supersedes any in-memory task list once context is cleared. Read it, locate the next phase from `git log`, execute through.

## Committed State on the Branch

Six phases committed, each `npm run typecheck:backend` (or full) green, with unit tests where applicable:

```
274d385 Phase 6e — drop legacy menu UI gating, refresh useUser JSDoc
ea10305 Phase 6d.2 — delete orphan userContextMiddleware
9eaa809 Phase 6d.1 — remove /api/profile and legacy /api/user/:id/wallet/*
6743dc9 Phase 6c — re-platform menu gating onto Better Auth session
5e62de0 Phase 6b — admin + request identity onto req.authSession
3736a48 Phase 6a — consolidate group/admin authority onto Better Auth
```

`main` already carries Phases 1-5, the plugin-types enabler (#275), the authorization docs (#276), the frontend `useUser` redesign (#277), and five merged plugin sweeps (trp-{bazi-fortune,files,memo-tracker,forum,dust-tracker}).

## Locked Decisions

Do not re-debate any of these mid-execution. If something genuinely new comes up, append it here as a new locked decision and continue.

- **Full drop** of the legacy `users` collection. Historical data is not preserved.
- **Admin model:** one literal `admin` group. No reserved-slug regex, no admin tiers. `isAdmin === isInGroup(req, 'admin')`.
- **Theme** stays in a standalone `theme` cookie (already implemented by `ThemeToggle`). The vestigial `users.preferences` field is dropped with the collection.
- **Per-account settings store** going forward is a future `module_user_settings` MongoDB collection keyed by BA user id, exposed as `ISettingsService` registered `'user-settings'`. **Not built now** — no live consumer exists.
- **Referral** feature is dropped. Raw first-touch capture (`tronrelic_ref` cookie + `traffic_events.referral_code` column) stays for a future rebuild on ClickHouse.
- **Identity-bound analytics** rebuild on ClickHouse via `candidate_uid` + nullable `user_id`. The legacy Anonymous→Registered→Verified funnel collapses to a binary "distinct tid → tid that ever carries a non-null user_id" conversion. Engagement panel is kept via new `session_end`/`page` event logging.
- **Account-level reads** go through published services. No code outside the `identity` module touches `module_user_auth_users` directly — not even with `IDatabaseService`. The only legitimate path is `services.get<IAccountDirectoryService>('accounts')` (and equivalent for wallets/groups). This is the SRP guarantee the restructure exists to enforce.
- **Module restructure:** split the user module into focused modules. Better Auth + BA-keyed services move to a new `identity` module; traffic/GSC/bot-classifier/geo move to a new `traffic` module. The user module shrinks to the legacy bits going away in Phase D, then is deleted entirely.

## Plan by Phase

Phases execute in order. Each ends with `npm run typecheck` green, vitest passing for the touched areas, and one commit on the branch (split allowed only at a clean logical seam). **Stop only at the destructive-migration flag in Phase D** — every other transition flows automatically.

### Phase R — Module Restructure

Split `modules/user/` into focused modules. This is the structural fix that justifies all the published-service-registry guidance above.

**New `modules/identity/`** — owns Better Auth and everything BA-keyed.

- Move: `auth.ts`, `services/auth-facade.ts`, `services/auth-constants.ts`.
- Move: `services/group.service.ts` — sole owner of BA `groups` field data access.
- Move: `services/wallet.service.ts`, `services/wallet-challenge.service.ts`.
- Move: `services/user-group.service.ts` — owns `module_user_groups` definitions and the published `'user-groups'` plugin contract.
- Move: `database/IWalletDocument.ts`, `database/IUserGroupDocument.ts`.
- Move: `api/wallet.{controller,routes}.ts`, `api/user-group.{controller,routes}.ts`.
- New: `services/account-directory.service.ts` implementing `IAccountDirectoryService` (`countAccounts`, `getAccount(baUserId)`, `listAccounts(opts)`). Sole code path reading `module_user_auth_users` via `IDatabaseService`.
- New: `IdentityModule.ts` implementing `IModule`. `init()` constructs BA, GroupService, WalletService, UserGroupService, AccountDirectoryService. `run()` mounts `/api/auth/*`, `/api/user/wallets/*`, `/api/admin/users/groups/*`, and registers `'user-groups'`, `'wallets'`, `'accounts'` on the service registry.
- New: `README.md` per the documentation skill standards.

**New `modules/traffic/`** — owns cookieless behavioral analytics.

- Move: `services/traffic.service.ts`, `services/gsc.service.ts`, `services/bot-classifier.ts`, `services/geo.service.ts`.
- Move: `api/traffic.{controller,routes}.ts`.
- Move: `migrations/010_create_traffic_events_table.ts`, `migrations/012_traffic_events_user_referral_columns.ts`.
- New: `TrafficModule.ts`, `README.md`.

**`modules/user/`** — shrinks to the legacy bits scheduled for removal in Phase D. Contents kept here only: legacy `UserService`, `identity-cookie.ts`, the surviving legacy `/api/user/:id/*` routes + their controller methods, legacy migrations `004-009` and `011`. Deletes entirely in Phase D.

**Types** — add `IWalletService` and `IAccountDirectoryService` to `packages/types/src/`. Re-export from the top-level barrel. (These are not the breaking types change of Phase T; they are additions.)

**Bootstrap** (`src/backend/index.ts`) — `IdentityModule` runs before `UserModule` (legacy still calls into the facade until Phase D). `TrafficModule` independent.

**Mechanical steps:**

1. Create the directories. `git mv` files to preserve history.
2. Update every import path. Search-and-replace `modules/user/services/<x>` → `modules/identity/services/<x>` (and equivalents for traffic).
3. Create the new `IdentityModule.ts` and `TrafficModule.ts`. Move the relevant init/run blocks out of `UserModule.ts`.
4. Add `AccountDirectoryService` and its interface. Register `'accounts'` and `'wallets'` on the registry.
5. Update `src/backend/index.ts` bootstrap with the new modules.
6. Move tests with their services. Re-anchor relative import paths.
7. Write the two new READMEs per the documentation skill. Include a "Source map" table per the AI-agent reference shape used in `src/plugins/trp-ai-assistant/README.md`.
8. Update `CLAUDE.md` references at both repo levels if any path moved.

**Acceptance:** backend + frontend typecheck green; all vitest suites green; the backend boots locally. Commit as single Phase-R or split into R.1 (identity move) and R.2 (traffic move) if size warrants.

### Phase A — Analytics Re-platform onto ClickHouse

After Phase R the work lives in `modules/traffic/`.

**Migration 013** (ClickHouse target): add `duration_ms Nullable(UInt32)` to `traffic_events`. Document the extended `event_type` enum: `'bootstrap' | 'session_start' | 'session_end' | 'page'`.

**`ITrafficEvent` + `buildTrafficEvent`** — add `duration_ms` to the optional inputs (populated for `session_end`). Page events use the existing `path` column for the URL.

**New `TrafficService` methods** (all query `traffic_events`):

- `getDailyVisitors(range)` — distinct `candidate_uid` per day.
- `getVisitorOrigins(range, limit, skip)` — first-touch path/referer/utm per tid.
- `getTrafficSources(range)` — referrer-domain breakdown.
- `getTopLandingPages(range, limit)`.
- `getGeoDistribution(range, limit)`.
- `getDeviceBreakdown(range)`.
- `getRetention(range)` — new vs returning by tid first-seen.
- `getBinaryConversionFunnel(range)` — distinct tids → tids ever carrying non-null `user_id`.
- `getCampaignPerformance(range, limit)` — utm aggregates joined to the binary conversion.
- `getEngagementMetrics(range)` — average duration, pages/session, bounce rate, computed from `session_end` and `page` events.

**Admin controller** — re-point `/api/admin/users/analytics/*` handlers from `UserService.*` Mongo aggregations to `TrafficService.*`. Add new reads for `services.get<IAccountDirectoryService>('accounts').countAccounts()` and BA-derived wallet adoption (`distinct userId` in `module_user_wallets` over account count).

**Drop these endpoints/panels entirely:** preferences distribution, referral overview, conversion funnel (three-stage shape), retention summary (legacy shape), wallet summary (legacy shape), activity summary (legacy shape). They keyed on `users.preferences` / `users.referral` / `users.identityState` / `wallets[].verified` — all going away.

**Session-event emission is deferred to Phase D.** The legacy `/api/user/:id/session/*` routes that would emit are being deleted there; emitting from soon-to-delete routes is throwaway work. Engagement panels return empty until session events accumulate post-Phase-D cutover. Document this in the panel.

**`UsersMonitor` frontend** — drop obsolete panels, point kept panels at the new TrafficService-backed routes, add BA-derived account-count and wallet-adoption panels.

**Acceptance:** typecheck + tests green; manual smoke of `/system/users` analytics panels showing data from `traffic_events`.

### Phase T — Types Breaking Change + Frontend Cascade

Remove the legacy types from `@delphian/tronrelic-types`. The resulting type errors *drive* the frontend cleanup — no separate "frontend rewrite" phase is needed.

**Remove from types:**

- `UserIdentityState` enum (delete `packages/types/src/user/IUserIdentityState.ts`).
- Legacy `IUser` (the UUID-keyed shape with `identityState` / `wallets[verified]` / `preferences` / `activity` / `groups` / `referral` / `mergedInto`).
- Legacy `IUserPreferences`, `IUserActivity`, `IUserSession`, `IWalletLink` (with `verified` flag), `IPluginWalletLink`.
- Legacy `IUserService` interface entirely. The replacements are `IAccountDirectoryService`, `IWalletService`, `IUserGroupService` — already published.
- Legacy summary types: `IUserStats`, `IUserActivitySummary`, `IUserWalletSummary`, `IUserRetentionSummary`, `IUserPreferencesSummary`, `IVisitorOrigin`.

**Finalize additions** (if not done in Phase R): `IWalletService`, `IAccountDirectoryService` in `packages/types`.

**Frontend cascade** (executed as type errors point at each consumer):

- Delete `src/frontend/modules/user/components/UserIdentityProvider.tsx`.
- Delete `src/frontend/modules/user/slice.ts` (legacy Redux user slice).
- Delete `src/frontend/modules/user/lib/server.ts` (`getServerUser`, `getServerUserId`, `buildSSRUserState`).
- Delete `src/frontend/modules/user/lib/identity.ts` (`USER_ID_COOKIE_NAME`, `isValidUUID`).
- Delete `src/frontend/modules/user/api/client.ts` (legacy API client functions).
- `src/frontend/middleware.ts` — remove `tronrelic_uid` forwarding; keep `tronrelic_tid` and `tronrelic_ref`.
- `src/frontend/features/system/contexts/SystemAuthContext.tsx` — re-point to BA `useAuthSession()` (replace `authStatus.isVerified && isAdmin` with BA `isLoggedIn` + the admin-group check).
- `src/frontend/modules/user/components/WalletCard.tsx` — delete. The BA-keyed wallet management UI replacement is **out of scope** for the cutover; document as follow-up.
- `src/frontend/components/socket/SocketBridge.tsx` — remove `socket.emit('subscribe', { user: true })`.
- `src/frontend/app/providers.tsx` — drop the `UserIdentityProvider` composition.
- `src/frontend/app/layout.tsx` — drop the SSR user-state injection.

**Plugin grep** — verify no swept plugin (`src/plugins/trp-*/src/**`) still imports a removed symbol. Surface any hit as a follow-up plugin PR in that plugin's own repo; do not chase as part of this branch.

**Version bump** — `packages/types/package.json` → **3.0.0** (major; removes exports). `publish-types.yml` workflow auto-publishes on merge to main.

**Acceptance:** full typecheck green; the SystemAuthContext-driven admin gate works against BA; the app boots without the deleted providers.

### Phase D — Drop Users Collection (DESTRUCTIVE — FLAG BEFORE RUNNING)

**Surface this to the operator before running migration 014. This is the one interactive flag in the plan.** Expected confirmation: "yes, run migration 014" (or equivalent explicit acknowledgment).

**Migration 014** — `dropCollection('users')`.

**Backend:**

- Delete `UserService` entirely.
- Delete `IUserDocument.ts` and the remaining internal legacy types.
- Delete the legacy `/api/user/:id/*` routes: `getUser`, `updatePreferences`, `recordActivity`, `startSession`, `recordPage`, `heartbeat`, `endSession`, `getReferralStats`, `logout`. The frontend logout call points at `/api/auth/sign-out` (Better Auth).
- Delete the controller methods backing those routes.
- Delete the `validateCookie` middleware on UserController.
- Slim `POST /api/user/bootstrap` to: read tid / ref cookies, emit one `bootstrap` ClickHouse row, return `{ success: true }`. No uid mint. No Mongo write or read. No users-collection touch.
- Delete `src/backend/modules/user/api/identity-cookie.ts` (`USER_ID_COOKIE_NAME`, `UUID_V4_REGEX`, `setIdentityCookie`, `resolveIdentityFromCookies`, signature helpers).
- Delete the UserController file once empty.
- WebSocket service — remove `readUserIdFromHandshake`, `socket.data.userId`, the `user:<uid>` room join in the subscribe handler, and the dead `emitToUser` method.
- **Add the deferred session-event emission**: the new session tracking surface (kept on `/api/user/session/*` keyed by BA session, or written by the Next middleware — pick the simpler) emits `session_end` and `page` rows to `traffic_events` with `duration_ms` populated for session_end. This activates the engagement panel built in Phase A.

**Frontend:** delete `src/frontend/modules/user/` entirely (anything not removed by the Phase T cascade).

**`modules/user/`** — delete the directory. Update `src/backend/index.ts` bootstrap, `CLAUDE.md` references at both repo levels, and any doc that still pointed there.

**Acceptance:** migration 014 runs cleanly against a dev environment; backend boots; admin dashboard loads; no 404s on `/system/users` panels.

### Phase F — Docs + Tests + Memory Sweep

Final pass to bring everything in line with the end state.

**Docs:**

- New `docs/system/modules/identity.md`, `docs/system/modules/traffic.md` (or fold the identity content into `modules.md` plus the module README — pick whichever matches existing convention better).
- Delete or drastically slim the User Module README. If the module is empty post-Phase-D, delete it.
- `docs/system/system-auth.md` — delete the "Coexistence and cutover" section; refresh the predicate surface to reference `IAccountDirectoryService` / `IWalletService` published services.
- `docs/environment.md` — `SESSION_SECRET` no longer signs an identity cookie; remove that note. Document any new env vars added by the restructure.
- `docs/frontend/frontend.md`, `docs/plugins/plugins.md`, `docs/plugins/plugins-api-registration.md` — sweep for legacy references.
- `PLAN-traffic-events.md` — note completion or delete if its work is fully captured.
- Update `src/backend/modules/menu/README.md` if its gating section still needs final touch-ups (the coexistence note that referenced `req.user` should already be gone in Phase 6c work).

**Tests:**

- Sweep `__tests__` directories for tests targeting deleted surfaces (`bootstrap.controller.test.ts` for the legacy bootstrap shape, `auth-status.test.ts` if that concept is gone, `websocket-cookie-parser.test.ts`).
- Most module tests moved with their services in Phase R; this is the final check.

**Memory cleanup:**

- Delete the auto-memory `project_better_auth_refactor_2026_05.md` (the migration completes here).
- Delete `project_traffic_events_split_2026_04.md` if its Phase 6 (the prune migration 011) is captured by this cutover.

**Delete this plan file** (`PLAN-better-auth-phase-6.md`) before the merge commit. It belongs to the branch, not to `main`.

**Acceptance:** full repo typecheck + full vitest suite green. Branch is merge-ready.

## Merge + Deploy

1. Final `npm run typecheck` + `npm test` sweep on the branch.
2. Merge `feat/auth-phase-6-cutover` → `main`. `publish-types.yml` auto-fires on push to main and publishes `@delphian/tronrelic-types@3.0.0`.
3. Production deploy. Follow the `operations` skill for the canonical command.
4. **Operator action:** trigger migrations 013 (ClickHouse `duration_ms`) and 014 (drop `users` collection) from `/system/database`. They are NOT auto-run.
5. Verify: admin dashboard loads, BA login works, wallet link works, a sample plugin's gated routes work.

## Resumption Rules

When picking this plan up in a fresh context:

1. `git log --oneline -10` on the branch — identify the latest committed phase.
2. Read this document. Re-read "Locked Decisions" before doing anything else.
3. Pick up at the next unfinished phase. **Do not relitigate locked decisions. Do not subdivide phases beyond what is written here.**
4. Stop only at Phase D's destructive-migration flag. Every other transition flows automatically.
5. If something genuinely new requires the operator (not captured here), ask once, append the answer to "Locked Decisions," and continue.

## Out of Scope

These are deliberately deferred:

- **A BA-keyed wallet management UI** to replace `WalletCard`. Feature work, not cutover.
- **BA admin plugin / additional OAuth providers.** Unrelated.
- **`module_user_settings` collection** — reserved as a future addition when a real per-account setting beyond theme emerges.
- **Re-introduction of referral analytics on ClickHouse** — raw capture stays; the rebuild waits.
- **Plugin-side updates triggered by Phase T** — each plugin gets its own PR in its own repo if any swept plugin still references a removed symbol.

---

End of plan. Execute by phase, in order, against the committed branch. Do not subdivide further.
