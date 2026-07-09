# Central Curation Queue

One core admin surface for every effect held for human review before it takes hold — drafted tweets, generated images, any future reviewable content. Lives in the [`curation` module](../../src/backend/modules/curation/README.md) and is published as the `'curation'` service.

## Why This Matters

Without it, every plugin that needs human review re-implements its own approval queue and its own review UI — `trp-x-poster` held drafted tweets in a private collection reviewed from its own History tab. Operators then hunt across plugins for things to approve, and each queue re-solves the same problem unevenly. Centralizing gives one inbox and, crucially, turns `forcesCuratorReview` from an honor-system boolean into a **verifiable binding**: the governor relaxes a tool's gates only while a real curation type backs the claim. The pattern mirrors CMS editorial queues (Drupal Content Moderation, Sanity's separate workflow-metadata document).

## How It Works

Core owns only the **decision** (held → approved / rejected) and the **envelope**; the owning content type owns the payload, the preview, and what approval *does*. The envelope is a pointer, never the payload: it stores an opaque `ref` (e.g. `{ postId }`) the type resolves back to its own record, plus a cached `preview` used only as the disabled-owner fallback. While the owner is registered the queue renders from a live `describe()`, so the snapshot never goes stale.

A provider **persists its record first, then holds a pointer to it** — never the payload. The `ref` is opaque to core, but for a reviewable item it must resolve to a durable record: the queue re-runs `describe()` live, a curator edits the body, and a decision writes a status word — none of which a self-contained value `ref` could carry. This is what distinguishes curation from a fire-and-forget pipeline like [notifications](./system-notifications.md), which inlines its whole payload in the `ref` (`{ title, body }`) because nothing re-reads or edits it. The propose path is the shape: write a `pending` row, then `hold({ ref: { postId } })`.

A provider registers an `ICurationType` and producers call `hold()`; the admin surface lists and decides. Core records the decision first (the queue's atomic gate), then commits the type's `decisionStatus` word through `applyEdit` — so a write failure leaves the item decided rather than re-opening a half-committed effect. A type whose plugin is disabled is unregistered, so its held items **block** on decision until the plugin returns; this is intentional, not data loss.

A decision mutates an item in place rather than deleting it, so the queue doubles as an audit trail. The admin page's **Pending** view is the live queue (`GET /curations`); its **History** view reads the decided items back (`GET /curations/history`), newest decision first, rendered read-only from each item's frozen `preview` snapshot — re-deriving a live `describe()` could misrepresent a past decision, so history keeps the snapshot it was decided on.

### Accountability Record

Every decision is a durable forensic record — the blame trail for an approved, routed effect — not a fire-and-forget action. Because the decision mutates the item in place, the decided envelope permanently captures **who** decided (`decidedBy`, the curator's Better Auth user id), **when** (`decidedAt`), **what produced it** (`source`, e.g. `ai-tool:propose-social-post`), the content **as approved** (the frozen `preview` — curator edits included, and it outlives the owning plugin being disabled), and **where it went** (`destinations[]`, each selected sink with its settled outcome — `delivered` / `failed` / `refused` — carrying the error or refusal reason). The everything-is-a-sink model governs only *where a terminal effect executes* (routed legs versus a decision callback), never *whether it is recorded*: routing is the mechanism, this envelope is the audit, and both always exist.

Retention is permanent by design. `module_curation_curations` carries no TTL index, no cleanup job, and no delete route, and curation is a core module with no uninstall — a decided item is never pruned (deliberately unlike the [notifications audit](./system-notifications.md), which sets an `audit_ttl`). The trade is an unbounded collection; a bounded retention policy would be an explicit future addition, never a silent default.

### The Type Contract

An `ICurationType` is an [`IContentType`](./system-content-types.md) plus the decision semantics curation adds. The content half — `typeId`, `label`, `describe`, `applyEdit` — is inherited and shared with every pipeline; only the decision semantics are curation-specific, because only curation has an approve/reject lifecycle. A type declares those decisions declaratively: a required `decisionStatus` map names the status word for each outcome, and core commits the word through the type's inherited `applyEdit({ status })`. Core stays payload-agnostic — it only ever sees the generic `IContentDescriptor` (`title` / `body` / `media` / `fields` / `editable`). On register, the service mirrors the content facet into the central `'content-types'` registry so other pipelines discover the same type.

| Member | Role |
|---|---|
| `typeId` | Inherited. Namespaced `<provider>:<name>` (e.g. `core:social-post`); the binding key |
| `describe(ref)` | Inherited. Flatten the record into the generic descriptor; resolves cross-plugin URLs |
| `applyEdit(ref, patch)` | Inherited, required. The sole decision-commit seam plus a curator's inline `{ body }` edit; the type validates and owns the write |
| `decisionStatus` | Required. The originator's status word per decision: `{ approved?, rejected }`. `rejected` is required — rejection is intrinsic to review, and nothing else carries it. Omit `approved` when a routed publish sink carries the approval instead |

Both `decisionStatus` and `applyEdit` are required on every curation type — the coherence guard rejects a type missing either at registration. There is no other commit seam: core writes the declared word through `applyEdit({ status })`, and no imperative post-decision callback exists. A type that needs a side effect on approval routes it through a [content-router publish sink](./system-content-routing.md#selecting-the-mandated-subset-at-the-gate), not through the binding.

`applyEdit` being unconditional also means a type is never "non-editable by omission" — the body's editability is signalled by the descriptor's `editable` flag, not by the method's presence.

**For a `publishesToDestinations` type, approval routes to the curator-selected destinations.** Delivery — publishing to a surface, posting to a channel — belongs exclusively to the curator-selected publish destinations (see [content routing](./system-content-routing.md#selecting-the-mandated-subset-at-the-gate)); routed fan-out runs first, then core marks the type's own record via `decisionStatus`/`applyEdit`. Such a type omits `decisionStatus.approved` so the routed sink alone flips the record — declaring it too would double-publish the moment a curator (or a saved destination default) selects that sink, the defect that forced the blog plugin's migration to this pattern. A classic type that omits the `publishesToDestinations` flag has no destinations, so the `decisionStatus.approved` word is the only approval effect — it *does* commit the one thing (release an AI action, apply a moderation decision). When a type's content must reach the type's own surface with full fidelity, carry the needed enrichment (a reserved slug, tags) through the descriptor's governed `fields` so the sink can publish the originating record itself; seed the sink as the type's destination default so the ordinary approval publishes without extra clicks.

A `publishesToDestinations` type with any eligible sink must have at least one destination selected on approval: curation blocks an empty-selection approval at the service (mirrored by the picker's disabled Approve button), so a decision can never record while publishing nowhere. A type with zero eligible sinks — a classic type, or a destinations type whose transports are all disabled — approves to nowhere, the only available outcome, so the guard never deadlocks a queue.

### The Verifiable Binding

An AI tool keeps `forcesCuratorReview: boolean` (the declaration) and adds `curationTypeId` (the verification). Three valid states:

| Capability | Governor behavior |
|---|---|
| Neither | Ordinary external tool — default-deny, parks for approval |
| `forcesCuratorReview: true` only | Legacy honor system — trusted on the tool's word (its own private queue) |
| `forcesCuratorReview: true` + `curationTypeId` | Honored **only while** that type is registered; re-tightens the moment the owner is disabled |

The governor resolves the binding live against the curation registry (`ToolPolicyEngine.setCurationResolver` → `CurationService.hasType`). Declaring `curationTypeId` without `forcesCuratorReview: true` is incoherent and rejected at tool registration.

### Auto-Approve Bypass

A held effect waits for a human by default — a curation-capable tool's `IToolPolicy.curation` defaults to `'require'`. An admin may override one tool to `'auto-approve'`: an explicit, audited bypass that releases its held effects without manual review. It is an operator decision, never a tool self-grant.

Auto-approve is honored **only on the interactive trigger path**, where an admin is already driving the query. A `scheduled`/`programmatic` run ignores it and falls back to a manual hold, so the "auto-approve + autonomous" corner — an external effect firing with no human anywhere — is structurally impossible. The governor decides at invoke time and carries the flag across the handler call through an `AsyncLocalStorage`; `hold()` reads it and approves the new item under the `system:policy-auto-approve` decider, so the audit separates a policy bypass from a curator's decision. Because the released effect is no longer human-gated, the tool's egress counts as *open* — flipping the bypass re-arms the lethal-trifecta banner from supervised to lethal. See [AI Tools Module README](../../src/backend/modules/ai-tools/README.md) for the governor wiring.

### Editing

The admin edits the neutral `body` text in a core modal; the write routes core → `CurationService.edit` → the type's `applyEdit` → the plugin's own record, then core re-derives and re-caches the preview. The type is the validation authority (x-poster enforces the ≤280 tweet limit and throws on violation). A type without `applyEdit` is not editable and shows no edit affordance. Rich per-type editors are a future extension on the same seam.

## Quick Reference

| Surface | Value |
|---|---|
| Service registry name | `'curation'` → `ICurationService` |
| Owned collection | `module_curation_curations` |
| Admin page | `/system/curation` |
| WebSocket signal | `curation:changed` (refetch cue) |
| Review bypass | `IToolPolicy.curation: 'require'` (default) \| `'auto-approve'` (interactive-only admin bypass) |
| REST | `GET /curations`, `GET /curations/count`, `GET /curations/history` (decided audit), `PATCH /curations/:id`, `POST /curations/:id/{approve,reject}` under `/api/admin/system/curation` |
| Types | `@delphian/tronrelic-types` → `ICurationType` (extends `IContentType`), `ICurationItem`, `ICurationService`; the render shape is the shared `IContentDescriptor` (`ICurationPreview` is a retained alias) |

## Example

A provider registers its type and routes held effects in:

```typescript
// On init, via the registry (watch covers boot-order + churn). `core:social-post`
// is the reference type: a destination-routable post the curator fans out.
context.services.watch<ICurationService>('curation', {
    onAvailable: (curation) => curation.registerType({
        typeId: 'core:social-post',
        label: 'Social Post',
        publishesToDestinations: true,                              // curator picks publish sinks on approval
        classification: { egress: 'external', audience: 'public' }, // ceiling the picker stays under
        describe: async (ref) => ({ body: (await store.getById(String(ref.postId)))?.body }),
        // Declarative decision bookkeeping — core writes the mapped word via applyEdit; routed delivery ran first.
        decisionStatus: { approved: 'published', rejected: 'rejected' },
        applyEdit: (ref, patch) => store.apply(String(ref.postId), patch)  // maps a { body } edit or a { status } transition onto the draft
    }, providerId)
});

// The tool's handler holds the effect rather than performing it:
await curation.hold({ typeId: 'core:social-post', ref: { postId }, source: 'ai-tool:propose-social-post' });
```

## Further Reading

- [system-content-types.md](./system-content-types.md) — the central content registry; `ICurationType` is an `IContentType` plus curation's declarative `decisionStatus`
- [system-ai-tools.md](./system-ai-tools.md) — the AI tool standard; `forcesCuratorReview` and the capability vocabulary the binding hardens
- [Curation Module README](../../src/backend/modules/curation/README.md) — the module that owns the curation service, queue, and `/system/curation` admin surface
- [AI Tools Module README](../../src/backend/modules/ai-tools/README.md) — the governor that verifies a tool's `curationTypeId` against the curation service, plus `core:social-post` (the reference `publishesToDestinations` type) and the `propose-social-post` tool that holds into it
- [trp-x-poster README](../../src/plugins/trp-x-poster/README.md) — the `x-poster:account` content-router publish sink an approved `core:social-post` fans out to
- [plugins-service-registry.md](../plugins/plugins-service-registry.md) — `watch()` vs `get()` for registering a type and discovering `'curation'`
