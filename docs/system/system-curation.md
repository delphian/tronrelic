# Central Curation Queue

One core admin surface for every effect held for human review before it takes hold — drafted tweets, generated images, any future reviewable content. Lives in the [`curation` module](../../src/backend/modules/curation/README.md) and is published as the `'curation'` service.

## Why This Matters

Without it, every plugin that needs human review re-implements its own approval queue and its own review UI — `trp-x-poster` held drafted tweets in a private collection reviewed from its own History tab. Operators then hunt across plugins for things to approve, and each queue re-solves the same problem unevenly. Centralizing gives one inbox and, crucially, turns `forcesCuratorReview` from an honor-system boolean into a **verifiable binding**: the governor relaxes a tool's gates only while a real curation type backs the claim. The pattern mirrors CMS editorial queues (Drupal Content Moderation, Sanity's separate workflow-metadata document).

## How It Works

Core owns only the **decision** (held → approved / rejected) and the **envelope**; the owning content type owns the payload, the preview, and what approval *does*. The envelope is a pointer, never the payload: it stores an opaque `ref` (e.g. `{ postId }`) the type resolves back to its own record, plus a cached `preview` used only as the disabled-owner fallback. While the owner is registered the queue renders from a live `describe()`, so the snapshot never goes stale.

A provider registers an `ICurationType` and producers call `hold()`; the admin surface lists and decides. Core records the decision first (the queue's atomic gate), then invokes the type's callback — so a callback failure leaves the item decided rather than re-opening a half-committed effect. A type whose plugin is disabled is unregistered, so its held items **block** on decision until the plugin returns; this is intentional, not data loss.

A decision mutates an item in place rather than deleting it, so the queue doubles as an audit trail. The admin page's **Pending** view is the live queue (`GET /curations`); its **History** view reads the decided items back (`GET /curations/history`), newest decision first, rendered read-only from each item's frozen `preview` snapshot — re-deriving a live `describe()` could misrepresent a past decision, so history keeps the snapshot it was decided on.

### The Type Contract

An `ICurationType` is an [`IContentType`](./system-content-types.md) plus the two review verbs curation adds. The content half — `typeId`, `label`, `describe`, `applyEdit` — is inherited and shared with every pipeline; only `onApprove`/`onReject` are curation-specific, because only curation has an approve/reject lifecycle. Core stays payload-agnostic — it only ever sees the generic `IContentDescriptor` (`title` / `body` / `media` / `fields` / `editable`). On register, the service mirrors the content facet into the central `'content-types'` registry so other pipelines discover the same type.

| Member | Role |
|---|---|
| `typeId` | Inherited. Namespaced `<provider>:<name>` (e.g. `core:social-post`); the binding key |
| `describe(ref)` | Inherited. Flatten the record into the generic descriptor; resolves cross-plugin URLs |
| `applyEdit?(ref, patch)` | Inherited. Optional content self-mutation (today `{ body }`); the type validates and owns the write |
| `onApprove(item)` | Curation verb: commit the effect (publish, schedule) |
| `onReject(item)` | Curation verb: discard the effect |

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
        onApprove: (item) => store.markPublished(String(item.ref.postId)),  // bookkeeping; routed delivery ran first
        onReject: (item) => store.markRejected(String(item.ref.postId)),
        applyEdit: (ref, patch) => store.editBody(String(ref.postId), patch.body ?? '')
    }, providerId)
});

// The tool's handler holds the effect rather than performing it:
await curation.hold({ typeId: 'core:social-post', ref: { postId }, source: 'ai-tool:propose-social-post' });
```

## Further Reading

- [system-content-types.md](./system-content-types.md) — the central content registry; `ICurationType` is an `IContentType` plus the `onApprove`/`onReject` review verbs
- [system-ai-tools.md](./system-ai-tools.md) — the AI tool standard; `forcesCuratorReview` and the capability vocabulary the binding hardens
- [AI Tools Module README](../../src/backend/modules/ai-tools/README.md) — the module that owns the curation service, governor, and registry
- [Curation Module README](../../src/backend/modules/curation/README.md) — the module that owns the curation service, queue, and `/system/curation` admin surface
- [AI Tools Module README](../../src/backend/modules/ai-tools/README.md) — the governor that verifies a tool's `curationTypeId` against the curation service
- [AI Tools Module README](../../src/backend/modules/ai-tools/README.md) — `core:social-post`, the reference `publishesToDestinations` curation type, and the `propose-social-post` tool that holds into it
- [trp-x-poster README](../../src/plugins/trp-x-poster/README.md) — the `x-poster:account` content-router publish sink an approved `core:social-post` fans out to
- [plugins-service-registry.md](../plugins/plugins-service-registry.md) — `watch()` vs `get()` for registering a type and discovering `'curation'`
