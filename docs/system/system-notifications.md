# Notifications System

**Status: implemented.** A core module (`src/backend/modules/notifications/`) that lets any source fire a notification at any audience, lets users opt out of specific notifications, lets admins disable whole channels or categories, and records every blast for audit. This document is the rationale and pipeline overview; the [Notifications Module README](../../src/backend/modules/notifications/README.md) is the agent-facing contract reference.

## Why This Matters

Today notifications are wallet-keyed and either global-blast (`WebSocketService.emit`) or threshold-filtered per wallet (`NotificationService.notifyWallets`). That model cannot express "tell every admin a cron prompt ran" or "tell this group, except the users who silenced it." There is no category concept, no per-user opt-out for admins (admins are users, not wallets), no admin kill switch, and no audit trail.

The need is broader than one feature: many sources (the AI scheduler, future plugins, core modules) will fire many notification types at many users and groups. Building each as a bespoke emit recreates the same gaps and rots into a pile of one-off `emit()` cases — which the `emit()` switch silently drops when unregistered (see [reference: emit switch]). The answer is one governed pipeline: sources **declare categories** and **fire**, the platform resolves recipients, enforces preferences and policy, delivers across pluggable channels, and audits the result.

Backwards compatibility with the wallet-keyed `NotificationService` is explicitly **not** a priority; this module supersedes it.

## How It Works

A **source** registers a **category** (a named notification type it owns) on the notifications service, then calls `notify()` whenever the event occurs. The service resolves the category's **audience** to a recipient set, intersects the category's supported **channels** with each recipient's **preferences** and the admin **policy**, delivers through each surviving channel's transport, and writes one **audit** record describing what was sent and what was suppressed.

The deciding split: a category's *existence and supported channels* are code (registered at boot, like the `HOOKS` registry); its *enabled state, per-user opt-outs, and audit history* are data (persisted). A category vanishing because a plugin is disabled must not corrupt history — so audit records snapshot the category label and audience at send time rather than referencing live state.

### Module, not plugin

Notifications are essential cross-cutting infrastructure that other components depend on, own persisted storage and an admin surface, and are not runtime-toggleable. By the [module-vs-plugin matrix](./modules/modules.md#module-vs-plugin-decision-matrix), that makes this a backend **module** under `src/backend/modules/notifications/`.

It still publishes its produce-and-fire service on the **service registry** (`IServiceRegistry`) during `run()`, because the consumers are late-bound: plugins reach it through `context.services`, other modules through their injected registry. Constructor DI cannot reach a plugin that is enabled an hour after boot; the registry can. Consumers use `services.watch('notifications', ...)` so a plugin enabled later still registers its categories.

### Core concepts

| Concept | Owner | Persisted? | Purpose |
|---------|-------|-----------|---------|
| Category | Source (plugin/module) | No (code) | A named notification type: id, label, audience, supported channels, defaults |
| Channel | Channel provider | No (code) | A delivery transport: `toast` now; `email`, `push` later |
| Audience | Category / call site | Snapshot in audit | Who to reach: groups, user ids, wallets |
| Preference | User | Yes | Per-user opt-out of a (category, channel) pair, plus a global mute |
| Policy | Admin | Yes | Global enable/disable of a channel or a category |
| Audit record | Platform | Yes | One row per blast: what fired, to whom, delivered vs suppressed |

### The service surface

One service goes on the registry as `'notifications'`. Its public verbs are small on purpose — sources only ever declare and fire:

```typescript
interface INotificationService {
    // Source declares a category it owns. Disposer unregisters on plugin disable.
    registerCategory(category: INotificationCategory): Disposer;
    // Channel provider declares a transport. Toast is registered by this module; plugins add more.
    registerChannel(channel: INotificationChannel): Disposer;
    // Fire a notification. Returns a receipt carrying the audit id and delivered/suppressed counts.
    notify(request: INotificationRequest): Promise<INotificationReceipt>;
}
```

Everything else is internal to the module and reached only through its own admin controllers, never the registry: `CategoryRegistry` and `ChannelRegistry` (in-memory, process-lifetime), `PreferenceService` (userId-keyed store), `PolicyService` (admin switches), `DispatchService` (the orchestrator below), and `AuditService` (history). Splitting these keeps each on a single responsibility; the registry exposes only the seam sources need.

### The resolution pipeline

`DispatchService.notify()` is the heart. For a request it resolves the audience to user ids, then for each (recipient, channel) applies an ordered gate — the first failing gate suppresses that channel for that recipient, and the reason is counted in the audit:

1. Category is registered **and** admin policy has not disabled it.
2. Channel is registered **and** admin policy has not disabled it globally.
3. Channel is in the category's `supportedChannels`.
4. The user has not opted out of this (category, channel) — default taken from the category's `channelDefaults`.
5. The user's global mute is off (skipped for categories flagged non-mutable, e.g. security-critical).

Surviving (recipient, channel) pairs are grouped per channel and handed to that channel's transport. The audit row records delivered counts and suppressed counts per channel, so the history tab can show "fired to 5 admins; 2 had it silenced; toast delivered to 3."

### Channel abstraction

A channel is a transport behind one interface, so adding email or push later is a new column in the same matrix — not a new concept. Design for it now:

```typescript
interface INotificationChannel {
    id: string;          // 'toast', later 'email', 'push'
    label: string;
    deliver(recipients: IResolvedRecipient[], message: IRenderedNotification): Promise<IChannelDeliveryResult>;
}
```

The **toast** channel (the only one shipping now) maps each recipient to their identity room and emits a single websocket event. Future channels resolve the recipient's address for their medium (email address, push token) and apply their own throttle — `NOTIFICATION_EMAIL_THROTTLE_MS` already exists for exactly this.

### Websocket changes

Two small core changes make identity-targeted delivery possible:

First, on the handshake the socket already carries `socket.data.authSession` with the user's id and groups (`websocket.service.ts`). Auto-join each socket to `user:${userId}` and a room per group (`group:admin`, …) at connection. That comment in the service already anticipates this room-gating.

Second, add **one** case to the `emit()` switch — `notification` — carrying `{ message, rooms }`. One case serves every category forever, which is the explicit fix for the switch-drops-unknown-events trap: categories are data, not new event cases. The raw `toast` event stays as the dumb primitive; `notification` is the governed one the toast channel emits.

Delivery honors per-user silence by emitting to the resolved `user:${id}` rooms, not by blasting `group:admin` — because a group blast cannot exclude the users who opted out, and a client-side toast suppressor would still pay bandwidth and break cross-device consistency. Recipient resolution is server-side; that is where enforcement belongs.

### Storage

Three module collections (modules are not auto-prefixed like plugins; use the module convention):

| Collection | Key | Holds |
|------------|-----|-------|
| `module_notifications_preferences` | `userId` (unique) | `{ mutedAll, overrides: { [categoryId]: { [channelId]: boolean } } }` |
| `module_notifications_policy` | singleton | `{ channels: { [id]: { enabled } }, categories: { [id]: { enabled } } }` |
| `module_notifications_audit` | `_id` | One blast: category id + **label snapshot**, source, severity, title/body, audience snapshot, per-channel delivered/suppressed counts, `firedBy`, `createdAt` |

Indexes (including the 90-day audit TTL on `createdAt`) are created in the module's `init()` via `database.createIndex` — the collections are new, so there is no production data to migrate.

### Admin and user surfaces

Admins get `/system/notifications` with three tabs: **Categories** (enable/disable each, see its source, supported channels, and defaults), **Channels** (globally enable/disable a transport), and **History** (the audit feed, filterable by category, source, and time). Each tab is backed by an admin-gated REST route under the module.

Users get a notifications-preferences panel (placement TBD — likely the account/settings area) listing every user-configurable category with a per-channel toggle and a global mute. It writes `module_notifications_preferences`; the pipeline reads it at dispatch.

### First slice: cron AI prompt runs

The concrete driver. The `ai-tools` module resolves `'notifications'` via the registry in `run()`, registers a category `ai-tools.scheduled-prompt-run` (audience `{ groups: ['admin'] }`, supported channels `['toast']`, default on, user-configurable), and calls `notify()` at the end of each run in `scheduled-prompts-runner.ts` with the prompt title and success/error. Admins see a toast; any admin can silence it from their preferences panel; an admin can disable the whole category for everyone from `/system/notifications`.

## Implementation Plan

Phases are ordered so the first slice (admin toasts) goes live at Phase 3, then preferences, policy, and audit complete the required controls. Channels beyond toast are the only deferred work.

| Phase | Scope | Outcome |
|-------|-------|---------|
| 1 | Types: add `INotificationService`, `INotificationCategory`, `INotificationChannel`, `INotificationRequest`/`Receipt`, audience/preference/audit types to `@delphian/tronrelic-types`. Follow the [add-export procedure]: re-export from root `index.ts`, bump version, sync each consuming workspace's installed copy. | Shared contract available to core and plugins |
| 2 | Websocket: auto-join `user:`/`group:` identity rooms on handshake; add the single `notification` case to `emit()`. | Identity-targeted delivery primitive |
| 3 | Module scaffold: category + channel registries, toast channel, `DispatchService` (audience → channels → deliver, no prefs yet), publish `INotificationService` on the registry. Wire `ai-tools` cron to register the category and fire. | **Admins receive toasts on cron prompt runs** |
| 4 | `PreferenceService` + enforcement gates 4–5 + user preferences panel. | Users opt out of specific notifications |
| 5 | `PolicyService` + enforcement gates 1–2 + admin Categories/Channels tabs. | Admins disable channels and categories |
| 6 | `AuditService` write-on-dispatch + admin History tab. | Admins audit every blast |
| Future | Email/push channels — proven by the channel abstraction, no pipeline changes. | Multi-channel delivery |

## Decisions Made

**User preferences page placement.** Both: a dedicated `/account/notifications` page for any logged-in user, and a "My Preferences" tab on `/system/notifications` for admins — sharing one `PreferencesPanel` component.

**Audit retention.** A 90-day TTL index on `createdAt` (`AUDIT_RETENTION_DAYS` in `config.ts`). No env var, to avoid the prod-wiring surface a new variable demands.

**Durable inbox.** Out of scope. Shipped: ephemeral toasts plus the admin audit log — not a per-user notification center with unread counts. The category/preference/audit model stays forward-compatible with adding a per-user inbox (fan-out-on-write) later.

**Legacy wallet-keyed `NotificationService`.** Left running in parallel (it powers `transaction:large` wallet alerts). This module supersedes it for new work; re-expressing the wallet/threshold path as categories is deferred.

## Further Reading

**Related infrastructure:**
- [system-hooks.md](./system-hooks.md) — the declared-registry pattern this mirrors (categories ≈ hook descriptors; the registry refuses unknown entries)
- [plugins-service-registry.md](../plugins/plugins-service-registry.md) — how plugins consume `'notifications'` via `context.services.watch()`
- [modules-architecture.md](./modules/modules-architecture.md) — module lifecycle, DI, and publishing a module service onto the registry
- [system-api-websockets.md](./system-api-websockets.md) — websocket event catalog the `notification` event joins
- [system-database-migrations.md](./system-database-migrations.md) — collection indexes and audit TTL
- [environment.md](../environment.md) — `NOTIFICATION_EMAIL_THROTTLE_MS`, `NOTIFICATION_WEBSOCKET_THROTTLE_MS`
