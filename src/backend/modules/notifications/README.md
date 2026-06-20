# Notifications Module

Category-based notification dispatch: any source declares a category and fires; the module resolves the audience, enforces admin policy and per-user opt-outs, delivers across pluggable channels, and audits every blast. The single public surface is `INotificationService`, published on the service registry as `'notifications'`.

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `notifications` |
| Module class | `src/backend/modules/notifications/NotificationsModule.ts` |
| Admin page | `/system/notifications` (menu item `Notifications`, order 37, registered in `run()`) |
| User page | `/account/notifications` (per-user opt-outs; any logged-in user) |
| Service registry name | `'notifications'` → `INotificationService` |
| Consumes from registry | `'user-groups'` (`IUserGroupService.getMembers`) for audience resolution |
| Types package | `@delphian/tronrelic-types` → `INotificationService`, `INotificationCategory`, `INotificationChannel`, `INotificationRequest`/`Receipt`, `INotificationPreferences`, `INotificationPolicy`, `INotificationAuditRecord` |
| Mounted routes | `/api/notifications/*` (login-gated), `/api/admin/system/notifications/*` (`requireAdmin`) |
| Owned collections | `module_notifications_preferences`, `module_notifications_policy`, `module_notifications_audit` |
| WebSocket event | `notification` (emitted to `user:${id}` rooms; single switch case in `websocket.service.ts`) |
| Bootstrap order | Inits/runs after `IdentityModule` (so `'user-groups'` is published) and before `AiToolsModule` (which registers a category and fires through `'notifications'`) |

## Why It Exists

Notifications come from many sources (the AI scheduler today; plugins and modules tomorrow) and target many users and groups, each of whom must be able to opt out. Building each as a bespoke `WebSocketService.emit` recreates the same gaps every time — no category model, no per-user opt-out, no admin kill switch, no audit — and rots into a pile of one-off `emit()` cases the switch silently drops. This module is the one governed pipeline: declare a category, call `notify()`, and inherit audience resolution, policy/preference enforcement, pluggable channels, and audit.

It is a **module** (not a plugin) because it is essential cross-cutting infrastructure with owned storage and an admin surface, and it is not runtime-toggleable. It still publishes its produce-and-fire service on the registry because consumers are late-bound — a plugin enabled an hour after boot reaches it through `context.services.watch('notifications', …)`.

## Source Map

| Path | Responsibility |
|------|----------------|
| `NotificationsModule.ts` | Two-phase lifecycle; constructs services, ensures indexes, mounts routers, publishes the service |
| `config.ts` | Collection names, service name, toast channel id, audit retention window |
| `services/notification.service.ts` | `NotificationService` singleton — the published `INotificationService` facade |
| `services/dispatch.service.ts` | The resolution pipeline: audience → gates → channels → audit |
| `services/category-registry.ts` | In-memory category descriptors (code, process-lifetime) |
| `services/channel-registry.ts` | In-memory channel transports |
| `services/preference.service.ts` | `module_notifications_preferences` — per-user opt-outs |
| `services/policy.service.ts` | `module_notifications_policy` — admin channel/category kill switches |
| `services/audit.service.ts` | `module_notifications_audit` — one row per blast, TTL-indexed |
| `services/recipient-resolver.ts` | Audience → Better Auth user ids via `'user-groups'` |
| `channels/toast-channel.ts` | The built-in toast channel — emits `notification` to `user:${id}` rooms |
| `api/preferences.{controller,routes}.ts` | `/api/notifications/preferences` (login-gated) |
| `api/admin.{controller,routes}.ts` | `/api/admin/system/notifications/*` (`requireAdmin`) |
| `database/index.ts` | The three MongoDB document shapes |

## The Contract

```typescript
interface INotificationService {
    registerCategory(category: INotificationCategory): NotificationDisposer;
    registerChannel(channel: INotificationChannel): NotificationDisposer;
    notify(request: INotificationRequest): Promise<INotificationReceipt>;
    listCategories(): INotificationCategory[];
    listChannels(): INotificationChannelInfo[];
}
```

A **source** declares a category at boot, then fires:

```typescript
const notifications = services.get<INotificationService>('notifications');
notifications?.registerCategory({
    id: 'my-plugin.thing-happened',
    label: 'Thing happened',
    description: 'Fires when the thing happens.',
    source: 'my-plugin',
    defaultAudience: { groups: [ADMIN_GROUP_ID] },
    supportedChannels: ['toast'],
    channelDefaults: { toast: true },
    userConfigurable: true
});
// later, when the thing happens:
await notifications?.notify({ category: 'my-plugin.thing-happened', title: 'It happened', severity: 'info' });
```

## The Resolution Pipeline

`DispatchService.notify()` resolves the audience to user ids, then applies an ordered gate per `(recipient, channel)` — the first failing gate suppresses that pairing, and the reason is counted in the audit:

1. Admin policy has not disabled the **category**.
2. Admin policy has not disabled the **channel**, and the channel is registered.
3. The channel is in the category's `supportedChannels`.
4. The user has not opted out of this `(category, channel)` — default from `channelDefaults`.
5. The user's global mute is off (skipped when the category is `mutable: false`).

Surviving pairs are grouped per channel and delivered. Per-user silencing is honored by emitting only to the `user:${id}` rooms of survivors — never a group blast — so enforcement stays server-side. Each blast writes one audit row snapshotting the category label and audience, so history survives a plugin (and its category) being disabled.

## Channels

A channel is a transport behind `INotificationChannel`. **Toast** is the only channel today; email and push are future implementations of the same interface — a new column in the preference matrix, not a new concept. The toast channel maps recipients to `user:${id}` socket rooms and emits the single `notification` event. A channel-provider plugin registers its transport via `registerChannel`.

## Storage

| Collection | Key | Holds |
|------------|-----|-------|
| `module_notifications_preferences` | `userId` (unique) | `mutedAll` + `overrides[categoryId][channelId]` |
| `module_notifications_policy` | singleton `_id` | `channels` + `categories` enable maps (missing = enabled) |
| `module_notifications_audit` | `_id` | One blast: label/audience snapshot, per-channel delivered/suppressed, TTL-indexed (90d) |

Indexes are created in `init()` (the collections are new — no production data to migrate). Categories and channels are code (registered at boot); only their admin enable-state, the per-user opt-outs, and the audit history persist.

## REST Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/notifications/preferences` | login | The caller's preferences + the opt-out catalog |
| PUT | `/api/notifications/preferences` | login | Merge a preference patch (`mutedAll`, `overrides`) |
| GET | `/api/admin/system/notifications/categories` | `requireAdmin` | Categories + admin enable state |
| PATCH | `/api/admin/system/notifications/categories/:id` | `requireAdmin` | Enable/disable a category |
| GET | `/api/admin/system/notifications/channels` | `requireAdmin` | Channels + admin enable state |
| PATCH | `/api/admin/system/notifications/channels/:id` | `requireAdmin` | Enable/disable a channel |
| GET | `/api/admin/system/notifications/history` | `requireAdmin` | Audit feed (filter: `categoryId`, `source`; paginated) |

## First Consumer

The `ai-tools` module registers the `ai-tools.scheduled-prompt-run` category (audience: admin group, toast, default-on, user-silenceable) and fires it after every cron-scheduled prompt run — so admins see a toast when a scheduled AI prompt runs, any admin can opt out at `/account/notifications` or the My Preferences tab, and an admin can disable the whole category for everyone.

## Related

- [system-notifications.md](../../../../docs/system/system-notifications.md) — design rationale and the resolution pipeline in depth
- [Module Architecture](../../../../docs/system/modules/modules-architecture.md) — IModule contract, bootstrap order, service registry
- [plugins-service-registry.md](../../../../docs/plugins/plugins-service-registry.md) — `watch()` vs `get()` for consuming `'notifications'`
- [Identity Module README](../identity/README.md) — the `'user-groups'` service used for audience resolution
