# Hook System

Typed extension points where the core pipeline invites plugins to participate in its own execution. Hooks are declared in a central registry, registered through a per-plugin facade scoped to lifecycle, and introspected via an admin endpoint that drives the `/system/hooks` bird's-eye timeline.

## Why This Matters

Without declared extension points, plugins fork core code or push fragile patches to inject behaviour into the request/response pipeline. The service registry already lets plugins **publish** capabilities; hooks complete the picture by letting core **invite** plugins into its own execution at points it explicitly opens. Authority stays with core — core picks the seams, the contract, the ordering, the failure-isolation rules — and plugins can only contribute at seams that exist. The result: an auditable surface where adding extension is a small, reviewable change instead of a refactor.

Skipping the system means re-introducing the WordPress-style failure mode: thousands of magic-string hooks, no central documentation, plugins fighting over priorities, no answer to "who is mutating my response?" The constraints below exist to keep that outcome away.

## How It Works

The hook system has four moving parts.

**Descriptors** in `src/backend/hooks/registry.ts` are the single source of truth. Each descriptor names a seam (`ssr.headFragments`), pins it to a pipeline phase (`ssr.page`), declares its archetype (`waterfall`), and brands its input and output types. `defineHook` is the only sanctioned constructor; the runtime registry refuses to register handlers against any descriptor it did not mint.

**The runtime registry** (`HookRegistry`) stores per-plugin handler registrations, enforces a per-plugin handler cap, orders execution by priority + registration timestamp, and produces the snapshot served to the admin UI. There is one instance per process, constructed in `bootstrapInit` alongside the service registry.

**The plugin facade** (`IPluginHooks` on `context.hooks`) tags every registration with the plugin id, refuses registration outside the lifecycle window (`install`/`enable`/`init`), and is closed and disposed by the plugin loader on `disable()`. Modules use the registry directly through dependency injection — the facade is a plugin-scope concern.

**The invokers** in `src/backend/hooks/invoke.ts` dispatch by archetype. Core code calls `hookRegistry.invoke(descriptor, input, seed?)` and gets back the right shape for the descriptor's kind. Handler failures are isolated per archetype — a misbehaving plugin cannot break the pipeline for others.

### The Four Archetypes

| Kind | Sequencing | Return | Use For |
|---|---|---|---|
| `observer` | Parallel, `Promise.allSettled` | `void` | "X happened, tell everyone." Errors logged and swallowed. |
| `series` | Ordered, awaited | `void` | Side effects in turn. `HookAbortError` halts; other throws are isolated. |
| `waterfall` | Ordered, awaited, threaded | `O` | Transforming an output. Each handler returns the next value. On throw the value is unchanged. |
| `bail` | Ordered, awaited, first-win | `O \| undefined` | Overrideable defaults. First non-`undefined` answer wins; `undefined` lets core fall through. |

Pick the archetype by what the seam *means*, not by what is convenient. Observer for notifications. Series for ordered side effects. Waterfall for transforming a value. Bail for overrides that core has a default for.

### Lifecycle Window

`context.hooks.register(...)` is only callable during `install` / `enable` / `init`. Calling it from a request handler throws — there is no mid-request mutation of the pipeline. The plugin loader rebuilds the facade on enable and closes it on disable; the registry's `disposeForPlugin(pluginId)` is the bulk safety net. The same rhythm as `context.services.register`.

### Failure Isolation

Every handler runs in isolation appropriate to its archetype. Observer rejections are logged and discarded. Series, waterfall, and bail handlers catch each handler individually; the pipeline continues past non-abort throws. A handler that intentionally needs to stop the pipeline throws `HookAbortError` — an explicit, declared signal carrying an optional payload the invoker forwards to the caller. Cross-bundle safety: prefer `isHookAbortError(err)` over a bare `instanceof` check at boundary code.

## Plugin Author Example

The minimum a plugin needs to contribute at a seam: reach the descriptor through `context.hooks.HOOKS` (no path alias into core required), register a handler whose signature is inferred from the descriptor, store the disposer for symmetry — the loader will dispose it on `disable()` regardless.

```typescript
import type { IPluginContext, IHeadFragment } from '@delphian/tronrelic-types';

init: async (context: IPluginContext) => {
    context.hooks.register(
        context.hooks.HOOKS.ssr.headFragments,
        async (_ctx, fragments) => [
            ...fragments,
            {
                id: 'analytics-beacon',
                tag: 'script',
                attributes: { defer: '' },
                content: '/* analytics inline */'
            } satisfies IHeadFragment
        ],
        { priority: 200 }
    );
}
```

The handler signature is enforced off the descriptor's type parameters. A misnamed seam (`context.hooks.HOOKS.ssr.headFragment`) does not compile; a handler whose return type drifts from `ReadonlyArray<IHeadFragment>` does not compile. There is no string parameter anywhere in the call site.

Core modules registering as `'core'` consume the descriptors through the constructor-injected `IHookRegistry` instead — `hookRegistry.register('core', HOOKS.<phase>.<name>, handler, { priority })`. Plugins cannot import `HOOKS` directly because plugin workspaces have no TypeScript path alias into `src/backend/hooks/`; `context.hooks.HOOKS` is the same runtime registry, exposed through the per-plugin facade so the descriptor identity passes the `defineHook` known-set check.

## Declared Seams

See `src/backend/hooks/registry.ts` for the live list. Today:

| Id | Phase | Kind | Order | Purpose |
|---|---|---|---|---|
| `ssr.htmlAttributes` | `ssr.page` | `waterfall` | 100 | Stamp attributes onto the root `<html>` element. Seeded `{ lang: 'en' }`. Last writer wins per key. Backed by `POST /api/ssr/html-attributes`. |
| `ssr.headFragments` | `ssr.page` | `waterfall` | 200 | Contribute `<style>` / `<link>` / `<meta>` / `<script>` to the rendered `<head>`. Backed by `POST /api/ssr/head-fragments`. |
| `ai.toolInvoke` | `ai.tool` | `series` | 100 | Inspect a governed AI tool call before it runs (after schema validation). Throw `HookAbortError` to veto or hold; the governor surfaces the abort to the model as a denial. For compliance / lethal-trifecta gating. |
| `ai.toolInvoked` | `ai.tool` | `observer` | 200 | Fired after a governed AI tool call completes, with the full `IToolInvocationRecord`. For audit fan-out, alerting, and lethal-trifecta watch; cannot change the outcome. |
| `http.walletLinked` | `http.api` | `observer` | 100 | Fired after a user verifies (links) a TRON wallet on their profile and it is persisted. Carries `IWalletLinkedContext` (`{ userId, address }`). For modules reacting to new verified ownership — account-history enrolls the address into its backfill; cannot change the link outcome. |
| `scheduler.legDelivered` | `scheduler.tick` | `observer` | 100 | Fired when the syndication relay successfully delivers a publish leg to its sink — one firing per leg. Carries `ISyndicationDeliveredContext` (sink, delivered descriptor, and provider coordinates `typeId` + `ref` so a subscriber can load the full record). A `refused` settle does not fire it; cannot change the outcome. |

Adding a seam is a PR to `registry.ts`: declare the descriptor with its types, then wire core to invoke it via `hookRegistry.invoke(descriptor, input, seed?)`. The bar to add is intentionally higher than the bar to use — that asymmetry is what keeps the surface small.

## Introspection

`GET /api/admin/system/hooks` returns the registry snapshot — tracks organised by `HookPhase`, each containing the declared hooks in `order`, each hook listing its registered handlers in execution order. The `/system/hooks` admin page renders this directly: track tabs at the top, vertical timeline below, each hook node expandable to show its description and the ordered handler list with `pluginId`, priority, source location, and `<ClientTime>` registration timestamp. Empty hooks render greyed out because "no plugins registered here" is diagnostically useful.

## Quick Reference

- Source: `src/backend/hooks/` (runtime), `packages/types/src/hooks/` (types), `src/backend/hooks/__tests__/hooks.test.ts` (contract tests).
- Add a seam: edit `registry.ts`, then `hookRegistry.invoke(...)` from core.
- Register a handler (plugin): `context.hooks.register(context.hooks.HOOKS.<phase>.<name>, handler, { priority })`. Modules registering as `'core'` use the injected `IHookRegistry` directly with the imported `HOOKS` constant.
- Abort a pipeline: `throw new HookAbortError('reason', payload)`.
- See registrations: `/system/hooks` (admin), or `GET /api/admin/system/hooks` (raw JSON).

## Further Reading

- [system.md](./system.md) — System architecture overview that contextualises the hook system among the other backend components.
- [plugins-service-registry.md](../plugins/plugins-service-registry.md) — Service registry, the inverse directional flow plugins use to **publish** capabilities for other components to consume.
- [modules-architecture.md](./modules/modules-architecture.md) — How modules participate in the hook registry through constructor-injected `IHookRegistry`.
- [documentation.md](../documentation.md) — Writing standards this document follows.
