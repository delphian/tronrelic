# AI Tools Module

Provider-agnostic governance for AI tools — the registry every tool registers with, and the governor every AI provider plugin executes through. Owns capability classification, policy (rate / approval / autonomous default-deny), the invocation audit trail, and the human-approval queue.

## Agent Quick Surface

| Surface | Value |
|---|---|
| Module id | `ai-tools` |
| Module class | `src/backend/modules/ai-tools/AiToolsModule.ts` |
| Service registry names | `'ai-tools'` → `IAiToolRegistry`, `'ai-tool-governor'` → `IAiToolGovernor` |
| Admin API base | `/api/admin/system/ai-tools` (rate-limited + `requireAdmin`) |
| Types package | `@delphian/tronrelic-types` → `IAiTool`, `IAiToolCapability`, `IAiToolRegistry`, `IAiToolGovernor`, `IToolInvocation{Context,Result,Record}`, `IToolPolicy`, `IAiToolInvokeContext` |
| Owned collections | `module_ai-tools_invocations`, `module_ai-tools_approvals` |
| KV keys (core `_kv`) | `ai-tools:tool-states`, `ai-tools:policy-overrides` |
| Hook seams | `ai.toolInvoke` (series, veto/hold), `ai.toolInvoked` (observer, audit fan-out) |
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
| `api/ai-tools.controller.ts` · `api/ai-tools.router.ts` | Admin REST surface |

## The Governed Pipeline

`governor.invoke(name, input, ctx)` runs, in order: resolve the tool → enabled-check → validate `input` against the tool's schema → `ai.toolInvoke` seam (a handler throws `HookAbortError` to veto or hold) → policy check → execute the handler under a 30s wall-clock budget → write an `IToolInvocationRecord` → `ai.toolInvoked` seam. It fails safe: an internal fault denies rather than running an ungoverned handler, and a handler fault is caught, audited, and returned to the model as a reason. The result is `{ status: 'ok' | 'denied' | 'pending-approval' | 'error', content, error?, recordId }`.

## Capability Classification & Default State

A tool declares `IAiToolCapability`; the registry sets its first-boot enabled state from it. **Least privilege:** `external`, irreversible, or money-spending tools ship **disabled** (opt-in); everything else ships enabled. A persisted admin toggle always overrides.

| Class signal | Default | Policy consequence |
|---|---|---|
| `sideEffect: 'read'` | enabled | light rate cap |
| `sideEffect: 'write'` | enabled | rate cap + full-arg audit |
| `sideEffect: 'external'` / `reversible: false` / `spendsMoney` | **disabled** | rate cap + approval (when irreversible) + **autonomous default-deny** |
| `sensitivity: 'secret'` | — | arguments redacted in the audit record |

**Autonomous default-deny:** on `triggerPath` `scheduled` or `programmatic`, an `external` tool is denied unless its policy sets `allowUnattended`. **Approval:** irreversible/public effects park as `pending-approval` and run only when an admin approves.

## Service Contracts

### `'ai-tools'` → `IAiToolRegistry`

Tool providers consume this. `registerTool(tool, providerId)`, `unregisterTool(name)`, `getEnabledToolDeclarations()` (handler-free, for a provider to format), `getTool`, `listTools`, `listToolInfo`, `setEnabled(name, enabled)`.

### `'ai-tool-governor'` → `IAiToolGovernor`

The AI provider plugin consumes this. `invoke(name, input, ctx)` returns `IToolInvocationResult`. The concrete `AiToolGovernor` also exposes `approve(approvalId, by)` / `reject(approvalId, by)` for the admin surface.

## Admin REST API

All under `/api/admin/system/ai-tools` (rate-limited + `requireAdmin`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/tools` | Registry: tools with capability, provider, enabled state |
| PATCH | `/tools/:name` | Toggle enabled (`{ enabled }`) |
| GET | `/activity` | Invocation audit feed (filters: `toolName`, `status`, `triggerPath`, `providerId`, `aiProviderId`, `limit`, `offset`) |
| GET | `/activity/:id` | One invocation record |
| GET | `/approvals` | Pending held invocations |
| POST | `/approvals/:id/approve` | Approve and run a held invocation |
| POST | `/approvals/:id/reject` | Reject without running |
| GET | `/policy` | Per-tool overrides + usage tallies |
| PUT/DELETE | `/policy/:name` | Set / clear a per-tool override |

## Hook Seams

Declared in `src/backend/hooks/registry.ts`. `ai.toolInvoke` (series, `IAiToolInvokeContext`) fires before execution — throw `HookAbortError` to block; lets a compliance or lethal-trifecta plugin veto without forking the provider. `ai.toolInvoked` (observer, `IToolInvocationRecord`) fires after, for audit fan-out and alerting. Both surface on `/system/hooks`.

## Lifecycle Obligations

`init()` constructs the registry, policy engine, audit store, approval queue, and governor; loads persisted tool-states and policy overrides; and ensures the two collections' indexes (the collections are new, so index creation here is correct rather than a migration). `run()` mounts the admin router and registers `'ai-tools'` + `'ai-tool-governor'`. Errors in either phase fail the boot — there is no degraded mode.

## Related

- [system-ai-tools.md](../../../../docs/system/system-ai-tools.md) — the AI tool standard this module enforces
- [system-hooks.md](../../../../docs/system/system-hooks.md) — the seam mechanism the governor invokes
- [plugins-service-registry.md](../../../../docs/plugins/plugins-service-registry.md) — how providers discover `'ai-tools'`
- [modules-architecture.md](../../../../docs/system/modules/modules-architecture.md) — the `IModule` contract and bootstrap order
