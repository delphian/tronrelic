# AI Tools Module

Provider-agnostic governance for AI tools — the registry every tool registers with, and the governor every AI provider plugin executes through. Owns capability classification, policy (rate / approval / autonomous default-deny), the invocation audit trail, and the human-approval queue.

## Agent Quick Surface

| Surface | Value |
|---|---|
| Module id | `ai-tools` |
| Module class | `src/backend/modules/ai-tools/AiToolsModule.ts` |
| Service registry names | `'ai-tools'` → `IAiToolRegistry`, `'ai-tool-governor'` → `IAiToolGovernor`, `'ai-providers'` → `IAiProviderRegistry`, `'curation'` → `ICurationService`, `'prompt-variables'` → `IPromptVariableRegistry` |
| Admin API base | `/api/admin/system/ai-tools` (rate-limited + `requireAdmin`) |
| Admin dashboard | `/system/ai-tools` (Registry · Query · Activity · Approvals · Curation · Policy tabs + trifecta banner + provider panel). The Registry tab has collapsible Tools, Variables, System Prompts, and Screen Settings sections |
| Types package | `@delphian/tronrelic-types` → `IAiTool`, `IAiToolCapability`, `IAiToolRegistry`, `IAiToolGovernor`, `IAiProvider`, `IAiProviderRegistry`, `IAiQueryOptions` (incl. `injectedSystemPrompt`), `IAiStreamChunk`, `IAiQueryRecord`, `AiQueryMode`, `ISavedPrompt`, `ITrifectaStatus`, `IToolInvocation{Context,Result,Record}`, `IToolPolicy`, `IAiToolInvokeContext`, `IPromptVariable{Definition,Info,Registry}`, `IStaticPromptVariable`, `IUntrustedScreenConfig`, `IContentScreenVerdict` |
| Owned collections | `module_ai-tools_invocations`, `module_ai-tools_approvals`, `module_ai-tools_curations`, `module_ai-tools_query_history`, `module_ai-tools_prompts`, `module_ai-tools_variables`, `module_ai-tools_system-prompts` |
| KV keys (core `_kv`) | `ai-tools:tool-states`, `ai-tools:policy-overrides`, `ai-tools:variable-classifications`, `ai-tools:system-prompt-master`, `ai-tools:screen-config` |
| Hook seams | `ai.toolInvoke` (series, veto/hold), `ai.toolInvoked` (observer, audit fan-out) |
| WebSocket signals | `ai-tools:activity`, `ai-tools:approvals-changed`, `ai-tools:curations-changed` (timestamp-only refetch cues; data stays behind the gated REST feed); `ai-tools:query-stream` (`IAiStreamChunk`, **global broadcast** keyed by `queryId` — client filters) |
| Scheduler jobs | `ai-tools:prune-audit` (daily 04:00) — range-deletes `module_ai-tools_invocations` past the 90-day window. `ai-tools:run-scheduled-prompts` (every 2 min) — fires cron-scheduled saved prompts against the active provider. Both registered only when a scheduler is injected |
| Bootstrap order | Inits/runs alongside the other modules, before `loadPlugins` |
| Standard | [system-ai-tools.md](../../../../docs/system/system-ai-tools.md) |

## Why This Module Exists

The AI *provider* is a swappable plugin (`trp-ai-assistant` for Anthropic today; OpenAI/Google could follow). If tool registration and governance lived in the provider, swapping providers would lose them. This module makes core the owner: tools register with `'ai-tools'`, every call runs through `'ai-tool-governor'`, and a provider swap loses nothing about tool governance. It is a module, not a plugin, because the platform's accountability contract cannot be optional.

## Source Map

| File | Responsibility |
|------|----------------|
| `AiToolsModule.ts` | Two-phase lifecycle; constructs services, mounts the admin router, publishes `'ai-tools'` + `'ai-tool-governor'`; registers the core built-in `send-toast` tool (external/reversible/public, ships disabled) via `registerBuiltinTools()` — a site-wide UI announcement broadcast on the global `'toast'` WebSocket event, provider-neutral so it survives a provider swap |
| `services/ai-tool-registry.ts` | `IAiToolRegistry`: registration, enabled-state (capability-driven default-deny), declarations for a provider |
| `services/ai-tool-governor.ts` | `IAiToolGovernor`: the invoke pipeline + approve/reject |
| `services/tool-policy-engine.ts` | Capability-classed defaults, admin overrides, fixed-window rate limiter, autonomous default-deny, curation mode (`require`/`auto-approve`) + egress-gating predicate |
| `services/curation-auto-approve-context.ts` | `AsyncLocalStorage` bridge carrying the governor's auto-approve decision across the handler call to `CurationService.hold()` |
| `services/tool-audit-store.ts` | `module_ai-tools_invocations` writes/queries, retention prune |
| `services/tool-approval-queue.ts` | `module_ai-tools_approvals` — park/list/resolve held invocations |
| `services/curation-queue.ts` | `module_ai-tools_curations` — persist/list/decide/edit held envelopes |
| `services/curation-service.ts` | `'curation'` → `ICurationService`: type registry + hold/approve/reject/edit orchestration |
| `services/ai-provider-registry.ts` | `'ai-providers'` → `IAiProviderRegistry`: provider metadata + executable instance; `getActive()` |
| `services/screen-config.service.ts` | `IUntrustedScreenConfig` persisted in core `_kv` (`ai-tools:screen-config`): the untrusted-content screen's master switch, posture, fail mode, offender threshold; read by the governor (every screen decision) and the policy engine (offender threshold) |
| `services/prompt-variable-registry.ts` | `'prompt-variables'` → `IPromptVariableRegistry`: code-registered dynamic variables + DB-persisted static variables (`module_ai-tools_variables`), classification, `{%name%}` expansion, secret-name feed for the trifecta detector |
| `variables/` | Core-owned built-in `dynamic` variables (Blockchain & Network, System Health, Site & Content, Database Access), registered into the registry at module init. Resolvers read injected core services; `types.ts` declares that dependency surface |
| `services/ai-query-history.service.ts` | `module_ai-tools_query_history` writes/queries for the Query tab (`IAiQueryRecord`) |
| `services/saved-prompts.service.ts` | `module_ai-tools_prompts` CRUD + cron validation + scheduler bookkeeping (`ISavedPrompt`); atomic field-level writes; failure-streak auto-pause |
| `services/system-prompts.service.ts` | Master prompt (core `_kv`) + audience-scoped additional prompts (`module_ai-tools_system-prompts`); `compose(principal)` assembles + `{%name%}`-expands the injected system prompt. Internal — not published on the registry |
| `services/scheduled-prompts-runner.ts` | Per-tick cron evaluator: fires due prompts via `getActive().query({ mode: 'programmatic' })`, claim-before-fire to avoid double-firing |
| `api/ai-tools.controller.ts` · `api/ai-tools.router.ts` | Admin REST surface (governance + the `/query*` query backend, incl. `/query/prompts*`) |

## The Governed Pipeline

`governor.invoke(name, input, ctx)` runs, in order: resolve the tool → enabled-check → validate `input` against the tool's schema → `ai.toolInvoke` seam (a handler throws `HookAbortError` to veto or hold) → policy check → execute the handler under a 30s wall-clock budget → wrap the result for provenance → write an `IToolInvocationRecord` → `ai.toolInvoked` seam. It fails safe: an internal fault denies rather than running an ungoverned handler, and a handler fault is caught, audited, and returned to the model as a reason. The result is `{ status: 'ok' | 'denied' | 'pending-approval' | 'error', content, error?, recordId }`.

**Provenance wrap:** when the tool declares `surfacesUntrustedContent`, a successful result's `content` is the `{ untrustedContentNotice, data }` envelope from `wrapUntrustedToolResult` (`@delphian/tronrelic-types`) — the attacker-influenceable payload labeled as data so the provider forwards it JSON-escaped, never as raw text the model could read as instructions. The audit `resultDigest` records the raw value; only what the model sees is wrapped. Because this lives in the governor, no provider transport can bypass it.

**Untrusted-content screen (active):** the wrap is passive; on top of it the governor runs an optional screen on a `surfacesUntrustedContent` result before forwarding. Per `ScreenConfigService`, when enabled (and, under `trifecta` posture, only when `isEgressReachable()` reports an open egress) it calls the active provider's `screenUntrustedContent(text)` — the provider's cheapest model, in an isolated tool-less call — and **withholds** a flagged result from the model (`{ contentWithheld: true, reason }`), recording the verdict on `IToolInvocationRecord.screen` and an offender hit via `policy.recordScreenHit()`. When the screen can't run (no provider screen, or it throws) the configured `onFailure` decides: `open` forwards the wrapped result, `closed` withholds. A flagged-offender tool is throttled by `ToolPolicyEngine` once it crosses `offenderThreshold`. The model choice is the provider's; whether/when to screen is core config.

## Capability Classification & Default State

A tool declares `IAiToolCapability`; the registry sets its first-boot enabled state from it. **Least privilege:** `external`, irreversible, or money-spending tools ship **disabled** (opt-in); everything else ships enabled. A persisted admin toggle always overrides.

| Class signal | Default | Policy consequence |
|---|---|---|
| `sideEffect: 'read'` | enabled | light rate cap |
| `sideEffect: 'write'` | enabled | rate cap + full-arg audit |
| `sideEffect: 'external'` / `reversible: false` / `spendsMoney` | **disabled** | rate cap + approval (irreversible & not self-curated) + **autonomous default-deny** (unless self-curated) |
| `sensitivity: 'secret'` | — | arguments redacted in the audit record |
| `operatesOnUserOwnedObjects` | — | **denied unless `ctx.endUser` is present** — a user-scoped tool cannot run under ambient authority |

**Autonomous default-deny:** on `triggerPath` `scheduled` or `programmatic`, an `external` tool is denied unless it declares `forcesCuratorReview: true` — its own human-review queue makes an unattended call safe, because the call can only draft into that queue — or an admin policy override grants `allowUnattended`. **Approval:** an external/irreversible tool that does not self-curate parks as `pending-approval` and runs only when an admin approves; a `forcesCuratorReview` tool relies on its own queue, so the governor adds no second gate. Both gates derive from the capability — a tool cannot opt itself out of either; only an admin policy override (`IToolPolicy`) can relax them.

**Object-authorization precondition:** a tool that declares `operatesOnUserOwnedObjects: true` is denied — first, before any other check — when the invocation context carries no `endUser` principal (or its `userId` is blank). Such a tool must scope every object access to that end user; running it under the actor's ambient server/admin authority is the confused-deputy (BOLA) failure, since there is no principal to authorize against. When the gate passes, the governor hands the handler the trusted principal as its second argument (`handler(input, principal)`, never from model `input`), so the tool can authorize against `principal.userId`. The actor's `kind` does not satisfy the gate — an admin is ambient authority, not a specific end user. Core cannot verify the handler performs the ownership check, but it refuses to run the tool without the identity the check needs, turning "execute in the user's context" from honour-system into an enforced precondition. The principal is supplied only by a non-admin-facing query path; today none exists, so the gate is inert and no tool declares the flag. See [system-ai-tools.md](../../../docs/system/system-ai-tools.md).

**Curation mode:** a curation-capable tool (`forcesCuratorReview` honored) defaults to `IToolPolicy.curation: 'require'` — every held effect waits for a human in the Curation tab. An admin may override to `'auto-approve'`: an explicit, audited bypass that releases that tool's held effects without manual review. It is honored **only on the interactive trigger path**; a `scheduled`/`programmatic` run ignores it and falls back to a manual hold, so an unattended run can never auto-execute an external effect. Auto-approve un-gates the egress, so the tool re-arms the lethal-trifecta signal (`exfiltrationGated` → `exfiltrationOpen`). The governor carries the decision across the handler call via an `AsyncLocalStorage` and `CurationService.hold()` approves the new item under `system:policy-auto-approve` — a distinct, non-human decider in the audit.

**Lethal-trifecta detection:** `detectTrifecta()` scans the *enabled* set for the co-presence of a private-data source, a `surfacesUntrustedContent` source, and an `external` sink — the combination that lets injected text read a secret and exfiltrate it in one turn. The private-data leg counts both a `sensitivity: 'secret'` reader tool and a `secret`-classified prompt variable (passed in from `PromptVariableRegistry.getSecretVariableNames()`), surfaced in `ITrifectaStatus.privateDataVariables` — a secret variable splices secret content into the prompt with no tool call, so it forms the leg on its own. The exfiltration leg splits by whether the channel is autonomously closable: a curator-gated sink (`forcesCuratorReview` honored and not auto-approved) is *supervised*, not lethal — per the Rule of Two, a human releasing every effect is the sanctioned escape hatch. `GET /trifecta` returns `severity` (`safe` / `supervised` / `lethal`), the `present` boolean (= `lethal`, back-compat), and the tool names per leg with the egress split into `exfiltrationOpen` / `exfiltrationGated`. An operator breaks the chain by disabling a leg; an admin auto-approve bypass moves a sink from gated to open, re-arming `lethal`.

## Service Contracts

### `'ai-tools'` → `IAiToolRegistry`

Tool providers consume this. `registerTool(tool, providerId)`, `unregisterTool(name)`, `getEnabledToolDeclarations()` (handler-free, for a provider to format), `getTool`, `listTools`, `listToolInfo`, `setEnabled(name, enabled)`.

`registerTool` lints the capability declaration first (`lintToolCapability`, `services/capability-linter.ts`). A self-contradictory or invalid declaration is an `error` and **rejects the registration** — an unrecognised `sideEffect`/`sensitivity` value (a typo would otherwise slip the default-deny or skip audit redaction, both of which match on exact strings), a `curationTypeId` without `forcesCuratorReview` (the binding it is supposed to verify), or a `spendsMoney` tool with no valid positive `costPerCallUsd` (the cost ceiling cannot meter a paid tool whose per-call cost is missing, non-finite, zero, or negative — a $0 charge never trips the ceiling — so it fails closed rather than registering unmetered). Likely misclassifications are `warn`s that log and still register: a `read` tool marked irreversible or money-spending, or — the F3 footgun — a description that reads like an untrusted-content source (memo, tweet, timeline, fetched page) without `surfacesUntrustedContent` set. Core cannot read a handler's intent, so the untrusted-content check is a heuristic nudge, not a reject; over-declaring only makes the trifecta banner more cautious. The linter is pure and unit-tested independently of the registry.

### `'ai-tool-governor'` → `IAiToolGovernor`

The AI provider plugin consumes this. `invoke(name, input, ctx)` returns `IToolInvocationResult`. The concrete `AiToolGovernor` also exposes `approve(approvalId, by)` / `reject(approvalId, by)` for the admin surface, and `setBroadcast(fn)` which the module wires to `WebSocketService` so governed events emit refetch signals.

### `'ai-providers'` → `IAiProviderRegistry`

The installed AI provider plugin registers itself here, handing the registry both its metadata and its **executable `IAiProvider` instance**: `registerProvider(info, instance)` / `unregisterProvider(id)` / `listProviders()` / `getActive()`. `listProviders()` backs the provider-agnostic Provider panel; `getActive()` returns the active provider's executable instance (or `null`) and is the provider-neutral way for core surfaces (the query backend) and consumer plugins to actuate AI — there is no vendor service key. `trp-ai-assistant` registers on enable and unregisters on disable.

### `'curation'` → `ICurationService`

The central queue of effects held for human review across content types. Providers `registerType`/`unregisterType` an `ICurationType` — an [`IContentType`](../../../../docs/system/system-content-types.md) (`describe` / optional `applyEdit`, both `ref`-addressed) plus the curation verbs `onApprove` / `onReject`; the service mirrors the content facet into the central `'content-types'` registry so other pipelines discover it. Producers `hold()`; the admin surface lists and `approve`/`reject`/`edit`. Core owns the decision and the pointer-plus-cached-preview envelope; the owning type owns the payload and what a decision does. The governor reads `hasType()` to verify a tool's `curationTypeId` binding (wired via `ToolPolicyEngine.setCurationResolver` in `init()`). A held item normally waits for a human; a tool whose `IToolPolicy.curation` is `'auto-approve'` has its held effects released immediately by the governor on the interactive path (see **Curation mode** above). Full design: [system-curation.md](../../../../docs/system/system-curation.md).

### `'prompt-variables'` → `IPromptVariableRegistry`

The single registry of prompt variables — the `{%name%}` tokens an AI provider expands into a prompt. Holds two kinds behind one service (the Menu module's dual-backing pattern): `dynamic` variables a provider plugin or core module registers in code (`registerVariable`, classify-only) and `static` variables an admin authors and persists (`createStatic`/`updateStatic`/`deleteStatic`, full CRUD). The AI provider consumes `expandAll`/`expandWithMetadata` at request-build time, so a prompt expands admin-authored statics alongside built-ins. `classify()` sets a variable's sensitivity — a static stores it on the document, a dynamic persists an admin override over its code-declared default. `getSecretVariableNames()` feeds the trifecta detector. A new static defaults to `secret` (fail-safe), and a static that shadows a registered dynamic name is rejected. This module registers a core-owned set of **built-in dynamic variables** (`variables/`) at init; the installed AI provider and other plugins register their own the same way through the service watch. The module owns the registry — it and the built-in set were lifted out of the `trp-ai-assistant` plugin.

| Category | Built-in dynamic variables |
|---|---|
| Blockchain & Network | `system-status`, `chain-params`, `tx-activity`, `tx-types`, `tx-week` |
| System Health | `observer-stats`, `log-summary`, `server-info` |
| Site & Content | `site-info` |
| Database Access | `cache-keys` |

## Admin REST API

All under `/api/admin/system/ai-tools` (rate-limited + `requireAdmin`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/tools` | Registry: tools with capability, provider, enabled state |
| PATCH | `/tools/:name` | Toggle enabled (`{ enabled }`) |
| GET | `/trifecta` | Lethal-trifecta status: `severity` (`safe`/`supervised`/`lethal`) + `present` (= lethal) + tool names per leg, egress split `exfiltrationOpen`/`exfiltrationGated` |
| GET | `/providers` | Installed AI provider plugins (Provider panel) |
| GET | `/screen-config` | Untrusted-content screen policy (`enabled`, `postureMode`, `onFailure`, `offenderThreshold`) |
| PUT | `/screen-config` | Update the screen policy (partial body; each field validated, 400 on bad input) |
| GET | `/variables` | Every prompt variable (dynamic + static) with kind, effective sensitivity, editability, size |
| POST | `/variables` | Create an admin-authored static variable (400 invalid · 409 duplicate/shadows a dynamic) |
| PATCH | `/variables/:name` | Edit a static variable's mutable fields (404 unknown) |
| DELETE | `/variables/:name` | Delete a static variable |
| PUT | `/variables/:name/classification` | Set a variable's sensitivity (both kinds); `secret` feeds the trifecta private-data leg |
| GET | `/system-prompts` | The master prompt + every additional prompt (`{ master, additional }`) |
| PUT | `/system-prompts/master` | Replace the always-on master prompt (`{ content }`; blank allowed) |
| POST | `/system-prompts` | Create (no `id`) or update (with `id`) an additional prompt; returns refreshed `{ master, additional }` (400 invalid / both-filters-empty · 404 missing) |
| DELETE | `/system-prompts/:id` | Delete an additional prompt |
| POST | `/query` | Run a query against `getActive()`. Streaming by default (requires `queryId`; chunks arrive over WebSocket, 200 returns immediately); non-streaming when body `stream: false` (awaits and returns `result`). 503 when no active provider |
| POST | `/query/:queryId/cancel` | Abort an in-flight streaming query (`provider.cancel(queryId)`) |
| GET | `/query/history` | Paged query history, newest first (`limit`, `offset`) |
| GET | `/query/conversations/:conversationId` | One conversation's turns, oldest first (Query tab "open in chat") |
| GET | `/query/models` | Available models from the active provider |
| GET | `/query/prompts` | Saved prompt templates, newest-updated first |
| POST | `/query/prompts` | Create (no `id`) or update (with `id`) a saved prompt; returns the refreshed list. 400 invalid · 404 missing · 409 duplicate name |
| DELETE | `/query/prompts/:id` | Delete a saved prompt template |
| GET | `/activity` | Invocation audit feed (filters: `toolName`, `status`, `triggerPath`, `providerId`, `aiProviderId`, `limit`, `offset`) |
| GET | `/activity/:id` | One invocation record |
| GET | `/approvals` | Pending held invocations |
| GET | `/approvals/count` | Pending-approval count (nav/tab badge) |
| POST | `/approvals/:id/approve` | Approve and run a held invocation |
| POST | `/approvals/:id/reject` | Reject without running |
| GET | `/policy` | Per-tool overrides + usage tallies |
| PUT/DELETE | `/policy/:name` | Set / clear a per-tool override |
| GET | `/curations` · `/curations/count` | Pending curation queue + count (Curation tab + badge) |
| GET | `/curations/history` | Decided items (approved/rejected), newest decision first (Curation tab → History) |
| PATCH | `/curations/:id` | Apply an operator inline edit (`{ body }`) via the type's `applyEdit` |
| POST | `/curations/:id/approve` · `/curations/:id/reject` | Decide a held item (404 not-pending · 409 owner-unavailable) |

## Query Backend

A provider-neutral chat surface owned by core, not by any provider plugin. The `/query*` routes resolve the active provider via `IAiProviderRegistry.getActive()` and persist every turn, so the `/system/ai-tools` **Query tab** (multi-turn chat, history with open-in-chat, model picker, streaming + non-streaming) survives a provider swap. There is no batch mode here — batch stays a provider concern.

Streaming is fire-and-forget: `POST /query` (default) requires a client-generated `queryId`, fires `provider.queryStream(opts, onChunk)`, returns 200 immediately, and appends an `IAiQueryRecord` when the stream settles. Each chunk reaches the browser as one **global** WebSocket broadcast of event `ai-tools:query-stream` carrying an `IAiStreamChunk` (with `queryId`); the client filters by its own `queryId`. Non-streaming (`stream: false`) awaits `provider.query` and returns the result inline. Both interactive paths record history with persisted `mode` `'stream'` or `'programmatic'`; the cron runner writes the third `AiQueryMode` value, `'scheduled'` (see [Saved Prompts & Scheduling](#saved-prompts--scheduling)). All three share one builder, `buildAiQueryRecord`, so the record shape never drifts between paths.

History lives in `module_ai-tools_query_history` (`IAiQueryRecord`), indexed unique `{ id }`, descending `{ createdAt }`, and sparse `{ conversationId, createdAt }` for oldest-first thread reads. Turns sharing a `conversationId` form one chat.

### Saved Prompts & Scheduling

Saved prompts are durable, **provider-independent** user assets — a named prompt body, optionally carrying a cron schedule — owned by core so they outlive any provider swap (a plugin-scoped copy would be orphaned when the transport is disabled). `SavedPromptsService` owns `module_ai-tools_prompts` (`ISavedPrompt`) with atomic field-level writes; each prompt is its own document keyed by `id`, indexed unique `{ id }`, case-insensitive-unique `{ name }`, and descending `{ updatedAt }`. The `/query/prompts*` routes back the Query tab's saved-prompts panel and cron editor.

`ai-tools:run-scheduled-prompts` evaluates every prompt with a cron on each 2-minute tick (`runScheduledPrompts`). A due prompt is **claimed before it fires** — `lastRunAt` is written first — so a slow query can never double-fire on the next tick (worst case is a skipped run on crash, never a duplicate). The run executes through `getActive().query({ mode: 'programmatic' })`, which the provider attributes as `triggerPath: 'programmatic'` / `actor: system`; the governor's external-tool default-deny keys on `triggerPath !== 'interactive'`, so an autonomous run gets the same protection a dedicated `scheduled` path would — the public `IAiQueryOptions` deliberately carries no trigger field, which keeps any caller from claiming `interactive`. With no provider installed the tick is a no-op and prompts wait untouched. Five consecutive failures auto-pause a schedule (`scheduleEnabled: false`) with an annotated `lastRunError`; any success or schedule edit resets the streak. Each run (success or failure) is also recorded in `module_ai-tools_query_history` tagged `mode: 'scheduled'`, each with its own `conversationId` so the grouped Query-tab history surfaces it (records without one are hidden one-shots) — an autonomous run is visible beside interactive queries, badged `Scheduled`.

### System Prompts

Core-owned, provider-neutral system prompts injected into every query. `SystemPromptsService` (internal — not on the registry) owns one always-on **master** prompt (core `_kv` key `ai-tools:system-prompt-master`, may be blank) plus any number of audience-scoped **additional** prompts (`module_ai-tools_system-prompts`, indexed unique `{ id }` and `{ order }`). Each additional prompt targets `userIds` (any-of) and/or `groups` (all-of); it applies when the querying user's id is in `userIds` **OR** the user is a member of every listed group — the two filters combine with **OR**. A both-empty additional prompt is rejected (the master covers everyone). Bodies expand `{%name%}` variables.

`compose(principal)` assembles the master first, then each enabled matching additional prompt by ascending `order`, then `{%name%}`-expands the whole via the prompt-variable registry — returning `''` when nothing applies. Both core query call sites compose and pass the result as `IAiQueryOptions.injectedSystemPrompt`: the interactive query controller (matching the admin's resolved `endUser`) and the scheduled-prompts runner (matching the prompt owner's re-resolved principal; a null principal yields master-only). The active provider injects it **after** its always-on security clause and **before** its own `config.systemPrompt`, so the final `system` order is **security clause → core injected → provider config** — core's prompts and the provider's own coexist rather than one replacing the other. A compose failure degrades to no injection rather than failing the query.

## Hook Seams

Declared in `src/backend/hooks/registry.ts`. `ai.toolInvoke` (series, `IAiToolInvokeContext`) fires before execution — throw `HookAbortError` to block; lets a compliance or lethal-trifecta plugin veto without forking the provider. `ai.toolInvoked` (observer, `IToolInvocationRecord`) fires after, for audit fan-out and alerting. Both surface on `/system/hooks`.

## Lifecycle Obligations

`init()` constructs the registry, policy engine, audit store, approval queue, curation queue + service, governor, provider registry, query-history service, saved-prompts service, prompt-variable registry (into which it registers the core-owned built-in dynamic variables), and system-prompts service; loads persisted tool-states, policy overrides, and prompt-variable statics + classifications; ensures every collection's indexes (the collections are new, so index creation here is correct rather than a migration — including `module_ai-tools_query_history`, `module_ai-tools_prompts`, `module_ai-tools_variables`, and `module_ai-tools_system-prompts`); and injects the curation binding resolver into the policy engine (`policy.setCurationResolver(curation.hasType)`). `run()` mounts the admin router, registers `'ai-tools'` / `'ai-tool-governor'` / `'ai-providers'` / `'curation'` / `'prompt-variables'`, wires the governor's and curation service's broadcast sinks to `WebSocketService`, registers the daily `ai-tools:prune-audit` retention job and the 2-minute `ai-tools:run-scheduled-prompts` job (both only when a scheduler is injected), and registers the `/system/ai-tools` admin nav item under the System container. Errors in either phase fail the boot — there is no degraded mode.

## Related

- [system-ai-tools.md](../../../../docs/system/system-ai-tools.md) — the AI tool standard this module enforces
- [system-curation.md](../../../../docs/system/system-curation.md) — the central curation queue, the type contract, and the verifiable binding
- [system-hooks.md](../../../../docs/system/system-hooks.md) — the seam mechanism the governor invokes
- [plugins-service-registry.md](../../../../docs/plugins/plugins-service-registry.md) — how providers discover `'ai-tools'`
- [modules-architecture.md](../../../../docs/system/modules/modules-architecture.md) — the `IModule` contract and bootstrap order
