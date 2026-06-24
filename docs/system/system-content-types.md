# Content Types

The central registry of provider-owned content — the reusable "noun" the platform can render, hold, decide, or deliver without understanding its payload. One registry, published as `'content-types'`, that curation and notifications both consume.

## Why This Matters

Before this, every pipeline that handles provider content reinvented the same three things: a content model, a way to render it generically, and an audit projection. Curation grew its own `ICurationType`; a notification would have grown its own parallel shape. That duplication is exactly what the platform pays for twice — and it leaves no single place to ask "what content types exist, and who uses them?"

The fix is to separate three roles that were tangled. **Content** is a noun owned by its originator — it knows its payload and how to flatten it. A **pipeline** (curation, notifications) is a verb that orchestrates content without owning it. **Identity** is a runtime `typeId` tag plus an opaque `ref` that reunites a pipeline's pointer with the originator's record after persistence or dynamic dispatch has severed any compile-time link. The originator owns the content and its concrete type; core holds only a pointer and a tag; concreteness is recovered at the originator's edge by registry lookup. A literal generic over the content type was rejected for exactly this reason — persistence erases the static type, so it lives only at the edges.

## How It Works

A provider registers an `IContentType` once on the central registry. The type knows its `typeId`, a `label`, and `describe(ref)` — which flattens its own record into a generic `IContentDescriptor` (`title` / `body` / `media` / `details`, plus an optional governed typed `fields` map for machine-readable enrichment). Optionally it implements `applyEdit(ref, patch)` to mutate its own record. Both `describe` and `applyEdit` operate on the originator's record via the opaque `ref`; neither knows about any pipeline.

`ContentRegistry` is core infrastructure, a peer of the service registry and hook registry — constructed in `bootstrapInit` and published as `'content-types'` **before any module init**, so curation and notifications can resolve it during their own init. It is in-memory and process-lifetime; persisted state (curation decisions, audit) references content types by `typeId`.

Pipelines bind their own verbs onto a content type:

- **Curation** registers a type as an `ICurationType` — an `IContentType` plus the review verbs `onApprove` / `onReject` — and mirrors the content facet into the shared registry. See [system-curation.md](./system-curation.md).
- **Notifications** fires `notify({ category, typeId, ref })`; dispatch resolves the type, calls `describe(ref)`, and routes to the channels whose declared capabilities can render the descriptor's features. See [system-notifications.md](./system-notifications.md).

The split is deliberate: generic operate-on-own-record operations (`describe`, `applyEdit`) live on `IContentType`; pipeline-decision semantics (curation's `onApprove`/`onReject`) stay on the binding, because "approve" only means something inside a review lifecycle.

## The Contract

| Member | Role |
|---|---|
| `IContentType.typeId` | Namespaced `<provider>:<name>` (e.g. `x-poster:tweet`); the stable key every pipeline references |
| `IContentType.label` | Human-readable label for listing and headings |
| `IContentType.describe(ref)` | Flatten the record into a generic `IContentDescriptor`; safe to call repeatedly, must not mutate |
| `IContentType.applyEdit?(ref, patch)` | Optional content self-mutation (today `{ body }`); the type validates and owns the write |
| `IContentDescriptor` | `title` / `body` / `media` / `details` (render shape) / `fields` (governed typed enrichment map) / `editable` |
| `IContentRegistry` | `register(type, providerId)` → disposer, `get`, `has`, `list` |
| `IContentTypeInfo` | `typeId` / `label` / `providerId` — the listing record |

## Admin View

`/system/content-types` is a read-only table of every registered type with its provider and the one statically-resolvable binding — whether a curation type backs the id. Notification usage is dynamic (a content type is chosen per `notify()` call), so it is deliberately not attributed. A type that lists no binding is registered but unused — the surface makes that drift visible. Backed by `GET /api/admin/system/content-types`, mounted in bootstrap alongside the hooks introspection router.

## Quick Reference

| Surface | Value |
|---|---|
| Service registry name | `'content-types'` → `IContentRegistry` |
| Constructed | `bootstrapInit` (`src/backend/services/content-registry.ts`), before module init |
| Admin page / route | `/system/content-types` · `GET /api/admin/system/content-types` |
| Types | `@delphian/tronrelic-types` → `IContentType`, `IContentDescriptor`, `IContentEditPatch`, `IContentRegistry`, `IContentTypeInfo` |
| Consumers | curation (binds approve/reject), notifications (capability-routed delivery) |

## Further Reading

- [system-curation.md](./system-curation.md) — the curation pipeline; `ICurationType` as an `IContentType` plus review verbs
- [system-notifications.md](./system-notifications.md) — the notification pipeline; capability routing over the descriptor
- [system-hooks.md](./system-hooks.md) — the sibling bootstrap-level registry whose admin introspection pattern this mirrors
- [plugins-service-registry.md](../plugins/plugins-service-registry.md) — resolving `'content-types'` from the registry
