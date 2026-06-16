# AI Tools Module

Provider-agnostic governance for AI tools — the registry every tool registers with, and the governor every AI provider plugin executes through. Owns capability classification, policy (rate / approval / autonomous default-deny), the invocation audit trail, and the human-approval queue.

## Agent Quick Surface

| Surface | Value |
|---|---|
| Module id | `ai-tools` |
| Module class | `src/backend/modules/ai-tools/AiToolsModule.ts` |
| Service registry names | `'ai-tools'` → `IAiToolRegistry`, `'ai-tool-governor'` → `IAiToolGovernor`, `'ai-providers'` → `IAiProviderRegistry`, `'curation'` → `ICurationService` |
| Admin API base | `/api/admin/system/ai-tools` (rate-limited + `requireAdmin`) |
| Admin dashboard | `/system/ai-tools` (Registry · Activity · Approvals · Curation · Policy tabs + trifecta banner + provider panel) |
| Types package | `@delphian/tronrelic-types` → `IAiTool`, `IAiToolCapability`, `IAiToolRegistry`, `IAiToolGovernor`, `IAiProviderRegistry`, `ITrifectaStatus`, `IToolInvocation{Context,Result,Record}`, `IToolPolicy`, `IAiToolInvokeContext` |
| Owned collections | `module_ai-tools_invocations`, `module_ai-tools_approvals`, `module_ai-tools_curations` |
| KV keys (core `_kv`) | `ai-tools:tool-states`, `ai-tools:policy-overrides` |
| Hook seams | `ai.toolInvoke` (series, veto/hold), `ai.toolInvoked` (observer, audit fan-out) |
| WebSocket signals | `ai-tools:activity`, `ai-tools:approvals-changed`, `ai-tools:curations-changed` (timestamp-only refetch cues; data stays behind the gated REST feed) |
| Scheduler jobs | `ai-tools:prune-audit` (daily 04:00) — range-deletes `module_ai-tools_invocations` past the 90-day window; registered only when a scheduler is injected |
| Bootstrap order | Inits/runs alongside the other modules, before `loadPlugins` |
| Standard | [system-ai-tools.md](../../../../docs/system/system-ai-tools.md) |

## Why This Module Exists

The AI *provider* is a swappable plugin (`trp-ai-assistant` for Anthropic today; OpenAI/Google could follow). If tool registration and governance lived in the provider, swapping providers would lose them. This module makes core the owner: tools register with `'ai-tools'`, every call runs through `'ai-tool-governor'`, and a provider swap loses nothing about tool governance. It is a module, not a plugin, because the platform's accountability contract cannot be optional.

## Source Map

| File | Responsibility |
|------|----------------|
| `AiToolsModule.ts` | Two-phase lifecycle; constructs services, mounts the admin router, publishes `'ai-tools'` + `'ai-tool-governor'` |
| `services/ai-tool-registry.ts` | `IAiToolRegistry`: registration, enabled-state (capability-driven default-deny), declarations for a provider |
| `services/ai-tool-governor.ts` | `IAiToolGovernor`: the invoke pipeline + approve/reject |
| `services/tool-policy-engine.ts` | Capability-classed defaults, admin overrides, fixed-window rate limiter, autonomous default-deny |
| `services/tool-audit-store.ts` | `module_ai-tools_invocations` writes/queries, retention prune |
| `services/tool-approval-queue.ts` | `module_ai-tools_approvals` — park/list/resolve held invocations |
| `services/curation-queue.ts` | `module_ai-tools_curations` — persist/list/decide/edit held envelopes |
| `services/curation-service.ts` | `'curation'` → `ICurationService`: type registry + hold/approve/reject/edit orchestration |
| `api/ai-tools.controller.ts` · `api/ai-tools.router.ts` | Admin REST surface |

## The Governed Pipeline

`governor.invoke(name, input, ctx)` runs, in order: resolve the tool → enabled-check → validate `input` against the tool's schema → `ai.toolInvoke` seam (a handler throws `HookAbortError` to veto or hold) → policy check → execute the handler under a 30s wall-clock budget → write an `IToolInvocationRecord` → `ai.toolInvoked` seam. It fails safe: an internal fault denies rather than running an ungoverned handler, and a handler fault is caught, audited, and returned to the model as a reason. The result is `{ status: 'ok' | 'denied' | 'pending-approval' | 'error', content, error?, recordId }`.

## Capability Classification & Default State

A tool declares `IAiToolCapability`; the registry sets its first-boot enabled state from it. **Least privilege:** `external`, irreversible, or money-spending tools ship **disabled** (opt-in); everything else ships enabled. A persisted admin toggle always overrides.

| Class signal | Default | Policy consequence |
|---|---|---|
| `sideEffect: 'read'` | enabled | light rate cap |
| `sideEffect: 'write'` | enabled | rate cap + full-arg audit |
| `sideEffect: 'external'` / `reversible: false` / `spendsMoney` | **disabled** | rate cap + approval (irreversible & not self-curated) + **autonomous default-deny** (unless self-curated) |
| `sensitivity: 'secret'` | — | arguments redacted in the audit record |

**Autonomous default-deny:** on `triggerPath` `scheduled` or `programmatic`, an `external` tool is denied unless it declares `forcesCuratorReview: true` — its own human-review queue makes an unattended call safe, because the call can only draft into that queue — or an admin policy override grants `allowUnattended`. **Approval:** an external/irreversible tool that does not self-curate parks as `pending-approval` and runs only when an admin approves; a `forcesCuratorReview` tool relies on its own queue, so the governor adds no second gate. Both gates derive from the capability — a tool cannot opt itself out of either; only an admin policy override (`IToolPolicy`) can relax them.

**Lethal-trifecta detection:** `detectTrifecta()` scans the *enabled* set for the co-presence of a `sensitivity: 'secret'` reader, a `surfacesUntrustedContent` source, and an `external` sink — the combination that lets injected text read a secret and exfiltrate it in one turn. `GET /trifecta` surfaces `present` plus the tool names forming each leg, so an operator can break the chain by disabling one.

## Service Contracts

### `'ai-tools'` → `IAiToolRegistry`

Tool providers consume this. `registerTool(tool, providerId)`, `unregisterTool(name)`, `getEnabledToolDeclarations()` (handler-free, for a provider to format), `getTool`, `listTools`, `listToolInfo`, `setEnabled(name, enabled)`.

### `'ai-tool-governor'` → `IAiToolGovernor`

The AI provider plugin consumes this. `invoke(name, input, ctx)` returns `IToolInvocationResult`. The concrete `AiToolGovernor` also exposes `approve(approvalId, by)` / `reject(approvalId, by)` for the admin surface, and `setBroadcast(fn)` which the module wires to `WebSocketService` so governed events emit refetch signals.

### `'ai-providers'` → `IAiProviderRegistry`

The installed AI provider plugin registers itself here (`registerProvider`/`unregisterProvider`/`listProviders`) so the Provider panel stays provider-agnostic — `trp-ai-assistant` registers on enable and unregisters on disable.

### `'curation'` → `ICurationService`

The central queue of effects held for human review across content types. Providers `registerType`/`unregisterType` an `ICurationType` (`describe` / `onApprove` / `onReject` / optional `applyEdit`); producers `hold()`; the admin surface lists and `approve`/`reject`/`edit`. Core owns the decision and the pointer-plus-cached-preview envelope; the owning type owns the payload and what a decision does. The governor reads `hasType()` to verify a tool's `curationTypeId` binding (wired via `ToolPolicyEngine.setCurationResolver` in `init()`). Full design: [system-curation.md](../../../../docs/system/system-curation.md).

## Admin REST API

All under `/api/admin/system/ai-tools` (rate-limited + `requireAdmin`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/tools` | Registry: tools with capability, provider, enabled state |
| PATCH | `/tools/:name` | Toggle enabled (`{ enabled }`) |
| GET | `/trifecta` | Lethal-trifecta status over the enabled set (`present` + tool names per leg) |
| GET | `/providers` | Installed AI provider plugins (Provider panel) |
| GET | `/activity` | Invocation audit feed (filters: `toolName`, `status`, `triggerPath`, `providerId`, `aiProviderId`, `limit`, `offset`) |
| GET | `/activity/:id` | One invocation record |
| GET | `/approvals` | Pending held invocations |
| GET | `/approvals/count` | Pending-approval count (nav/tab badge) |
| POST | `/approvals/:id/approve` | Approve and run a held invocation |
| POST | `/approvals/:id/reject` | Reject without running |
| GET | `/policy` | Per-tool overrides + usage tallies |
| PUT/DELETE | `/policy/:name` | Set / clear a per-tool override |
| GET | `/curations` · `/curations/count` | Pending curation queue + count (Curation tab + badge) |
| PATCH | `/curations/:id` | Apply an operator inline edit (`{ body }`) via the type's `applyEdit` |
| POST | `/curations/:id/approve` · `/curations/:id/reject` | Decide a held item (404 not-pending · 409 owner-unavailable) |

## Hook Seams

Declared in `src/backend/hooks/registry.ts`. `ai.toolInvoke` (series, `IAiToolInvokeContext`) fires before execution — throw `HookAbortError` to block; lets a compliance or lethal-trifecta plugin veto without forking the provider. `ai.toolInvoked` (observer, `IToolInvocationRecord`) fires after, for audit fan-out and alerting. Both surface on `/system/hooks`.

## Lifecycle Obligations

`init()` constructs the registry, policy engine, audit store, approval queue, curation queue + service, governor, and provider registry; loads persisted tool-states and policy overrides; ensures the collections' indexes (the collections are new, so index creation here is correct rather than a migration); and injects the curation binding resolver into the policy engine (`policy.setCurationResolver(curation.hasType)`). `run()` mounts the admin router, registers `'ai-tools'` / `'ai-tool-governor'` / `'ai-providers'` / `'curation'`, wires the governor's and curation service's broadcast sinks to `WebSocketService`, registers the daily `ai-tools:prune-audit` retention job (only when a scheduler is injected), and registers the `/system/ai-tools` admin nav item under the System container. Errors in either phase fail the boot — there is no degraded mode.

## Related

- [system-ai-tools.md](../../../../docs/system/system-ai-tools.md) — the AI tool standard this module enforces
- [system-curation.md](../../../../docs/system/system-curation.md) — the central curation queue, the type contract, and the verifiable binding
- [system-hooks.md](../../../../docs/system/system-hooks.md) — the seam mechanism the governor invokes
- [plugins-service-registry.md](../../../../docs/plugins/plugins-service-registry.md) — how providers discover `'ai-tools'`
- [modules-architecture.md](../../../../docs/system/modules/modules-architecture.md) — the `IModule` contract and bootstrap order
