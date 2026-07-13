# Curation Module

Owns the central human-review queue: the registry of reviewable content types, the held-item lifecycle, the persistent envelope store, and the `/system/curation` admin surface. Extracted from the `ai-tools` module so curation is a first-class subsystem with its own home — its consumers (drafted tweets, broadcast messages, generated images, any future reviewable content) have nothing to do with AI tooling beyond being one way an effect gets held.

**Intent.** This module is meant to be *the* centralized core curation pipeline for the whole platform — the single place any module or plugin routes an effect that must wait for a human before it takes hold, AI-driven or not. A consumer should never build its own approval queue and review UI again: it registers an `ICurationType`, holds effects by reference, and inherits one shared inbox, audit trail, notification path, and governance surface. The roadmap toward that end state — including folding the remaining plugin-private review queues into this one — lives in [TODO.md](./TODO.md).

## Agent Quick Surface

| Surface | Value |
|---------|-------|
| Module id | `curation` |
| Module class | `src/backend/modules/curation/CurationModule.ts` |
| Admin page | `/system/curation` (menu item `Curation`, order 37, registered in `run()`) |
| Service registry name | `'curation'` → `ICurationService` |
| Content-router sink | `curation:gate` (`kind: 'gate'`, `accepts: []`, `reach: { internal, admin }`) registered on `'content-router'` in `run()` — the gate sink family |
| Sink selection | `publishesToSinks` types surface the gate-admitted `publish` sinks at review; the curator selects which fire on approval → enqueued into the durable [`'syndication'`](../syndication/README.md) outbox (best-effort inline fan-out only when syndication is absent), live per-sink outcomes overlaid on the item from the outbox |
| Mounted routes | `/api/admin/system/curation/curations*` |
| Owned collections | `module_curation_curations`, `module_curation_sink_defaults` |
| WebSocket signal | `curation:changed` (refetch cue; needs a case in `WebSocketService.emit`) |
| Notification category | `curation.held` / content type `curation:held` (admin toast on each hold) |
| Types package | `@delphian/tronrelic-types` → `ICurationType`, `ICurationItem`, `ICurationService`, `ICurationHoldInput`, `ICurationEditPatch`, `ICurationTypeInfo` |
| Bootstrap order | Inits/runs after `NotificationsModule` and before `AiToolsModule` in both phases |

## Why This Module Exists Separately

Without a central queue, every plugin needing human review re-implements its own approval inbox and review UI; operators then hunt across plugins for things to approve. Centralizing gives one inbox and turns a tool's `forcesCuratorReview` from an honor-system boolean into a **verifiable binding**: the AI tool governor relaxes a tool's gates only while a real curation type backs the claim. Full design rationale lives in [system-curation.md](../../../../docs/system/system-curation.md).

Curation is a module, not a plugin, because the governed-tool path cannot run without it — the governor resolves `'curation'` live to verify `curationTypeId` bindings. It carries no AI dependency itself; ai-tools depends on it, not the reverse.

## Source Map

| Path | Responsibility |
|------|----------------|
| `CurationModule.ts` | Two-phase lifecycle; constructs queue + service, mounts router, publishes `'curation'`, registers menu node + `curation.held` notification |
| `services/curation-service.ts` | `ICurationService`: type registry + held-item lifecycle (hold/approve/reject/edit), content-registry mirroring, live-preview resolution, sink eligibility, durable-syndication enqueue (best-effort fallback), live outcome overlay |
| `services/curation-queue.ts` | Persistent envelope store over `module_curation_curations`; atomic decision gate (persists the selected sinks with the decision) |
| `services/curation-sink-defaults.ts` | Standing per-type default publish sinks over `module_curation_sink_defaults` — the subset the picker pre-selects |
| `services/curation-gate-sink.ts` | The `curation:gate` content-router sink; `deliver()` holds by reference |
| `services/curation-auto-approve-context.ts` | `AsyncLocalStorage` carrying the governor's auto-approve decision into `hold()` — the one runtime primitive shared with ai-tools (`runWithCurationAutoApprove` is imported by the governor) |
| `api/curation.controller.ts` | Admin handlers: pending list, history, count, inline edit, approve/reject |
| `api/curation.router.ts` | `/api/admin/system/curation` router (`createAdminRateLimiter` + `requireAdmin`) |
| `migrations/001_migrate_curations_from_ai_tools.ts` | Copy-then-drop `module_ai-tools_curations` → `module_curation_curations` |
| `migrations/002_rename_curation_held_notification_category.ts` | Rewrite `ai-tools.curation-held` → `curation.held` in notification preferences + policy |

## Published Service — `'curation'` → `ICurationService`

| Method | Purpose |
|--------|---------|
| `registerType(type, providerId)` | Register a reviewable `ICurationType` (also mirrors its content facet into `'content-types'`) |
| `unregisterType(typeId)` | Drop a type on provider disable; held items block until it re-registers |
| `hasType(typeId)` / `getType(typeId)` / `listTypes()` | Binding checks + admin introspection |
| `hold(input)` | Hold an effect for review (auto-approves when the interactive governor bypass is in scope) |
| `listPending` / `countPending` / `listHistory` / `get` | Queue reads (pending shows a live `describe()`; history shows the frozen decision-time snapshot) |
| `approve(id, by?, sinks?)` / `reject` / `edit` | Decide or inline-edit a pending item through its owning type; `approve` fans the approved content to the selected publish subset, recording each outcome. Selection is **required** for a type with eligible sinks — an empty selection throws before the decision records; a type with zero eligible sinks approves to nowhere (no deadlock) |
| `listEligibleSinks(id)` | The gate-admitted `publish` sinks for a sinks-enabled pending item, each flagged `defaultSelected` — the picker's data |
| `get` / `setSinkDefaults(typeId[, sinkIds])` | Read/write the standing per-type default sinks the picker pre-selects |

Consume via `services.watch<ICurationService>('curation', { onAvailable })` so registration tolerates boot-order and provider churn. The two reference consumers are `trp-x-poster` (`x-poster:tweet`) and `trp-telegram-bot` (`telegram-bot:message` / `:photo`).

## REST Endpoints

All under `/api/admin/system/curation`, gated by `requireAdmin` + the curation admin rate limiter.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/curations` | Pending items (live preview) |
| GET | `/curations/count` | Pending count for the nav badge |
| GET | `/curations/history` | Decided items, newest decision first (frozen snapshot) |
| GET | `/curations/:id/sinks` | Eligible publish sinks for a pending item (picker data) |
| POST | `/curations/:id/sinks/defaults` | Set the standing default sinks for the item's content type (body `{ sinkIds }`) |
| PATCH | `/curations/:id` | Inline-edit the neutral `body` through the owning type's `applyEdit` |
| POST | `/curations/:id/approve` | Approve, fan to the selected `sinks` (body `{ sinks? }`), commit via the type; **400** when the item has eligible sinks but no sink is selected |
| POST | `/curations/:id/reject` | Reject + discard via the type |

## Lifecycle

**`init()`** constructs `CurationQueue` (and ensures its indexes), resolves the `'content-types'` registry, constructs `CurationService` and `CurationController`. **`run()`** mounts the admin router, wires the `curation:changed` broadcast and the held-item toast, publishes `'curation'`, registers the `curation:gate` sink on the `'content-router'` service (so the central router can route effects to human review), registers the `curation.held` notification category + content type, and registers the `/system/curation` menu node.

## Current Capabilities

What the module does today, as the contract tables above detail: a registry of reviewable content types (`registerType`/`unregisterType`, mirrored into the central `'content-types'` registry); the held-item lifecycle (`hold` → `approve`/`reject`/`edit`) with an atomic decision gate and disabled-owner blocking; live-preview resolution for pending items and frozen snapshots for decided history; a generic inline body-text editor that writes through the owning type's `applyEdit`; the interactive auto-approve bypass the AI tool governor drives; interactive sink selection for `publishesToSinks` types (the review gate surfaces the gate-admitted `publish` sinks, the curator picks which fire on approval, committed to the durable [`'syndication'`](../syndication/README.md) outbox and delivered by its retrying relay — best-effort inline only when syndication is absent — with live per-sink outcomes overlaid on read; the first selectable outlet being the core `core:internal-publish` sink); a `/system/curation` admin surface with Pending/History views; an admin toast per hold (`curation.held`); a `curation:changed` WebSocket refetch cue; and, on an approval that synchronously commits canonical content (the type declares `decisionStatus.approved`), the core `content.published` observer hook fires so downstream reactors act on the live record (see [system-hooks.md](../../../../docs/system/system-hooks.md)). Two reference consumers exercise it — `trp-x-poster` and `trp-telegram-bot`.

## Vision & Roadmap

The current surface is the foundation, not the finished pipeline. The module is designed to grow into the platform-wide curation service: per-type rich editors and curator authorization, queue management at scale (filter/search, bulk decisions, multi-curator claiming, expiry/SLA via a curation-owned scheduler job), additional notification channels, and the consolidation of every remaining plugin-private review queue into this one. The full backlog, with the why and rough scope of each item, lives in [TODO.md](./TODO.md). The guiding principle: a new consumer needing manual review registers a type and holds by reference — it never re-implements an approval queue.

## Related

- [TODO.md](./TODO.md) — the roadmap toward the centralized curation pipeline
- [system-curation.md](../../../../docs/system/system-curation.md) — design rationale, the type contract, the verifiable binding
- [system-content-types.md](../../../../docs/system/system-content-types.md) — the registry curation mirrors types into
- [AI Tools Module README](../ai-tools/README.md) — the governor that verifies `curationTypeId` against this service
- [Module Architecture](../../../../docs/system/modules/modules-architecture.md) — IModule contract, bootstrap order, service registry
