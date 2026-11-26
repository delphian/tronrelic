# Cross-Component Service Sharing

The service registry (`context.services`) lets plugins register named services that other plugins and modules consume at runtime. It is TronRelic's mechanism for plugin-to-plugin and plugin-to-module collaboration — a plugin provides a capability, any consumer discovers it by name without importing concrete implementations.

## Why This Matters

Constructor injection wires static dependencies at bootstrap; the registry is late-binding and resolves at call time. That makes the registry the natural fit for optional, plugin-provided services where the provider may be disabled or not yet initialized. Both mechanisms enforce the same DI principle — consumers depend on abstractions, not implementations — so the contract stays interface-based either way.

The registry exists so features that publish shared capabilities (AI analysis, notification dispatch, data enrichment) can stay plugins instead of being promoted to modules. A plugin that exposes a shared service is still a plugin if the application functions without it. Consumers must handle the service being unavailable, which enforces graceful degradation by design. See [modules.md](../system/modules/modules.md#module-vs-plugin-decision-matrix) for how this changes the module vs plugin decision.

## Providing a Service

Register during `init()`, unregister during `disable()`:

```typescript
init: async (context: IPluginContext) => {
    const myService = new MyService(context.database, context.logger);
    context.services.register('my-service', myService);
},
disable: async (context: IPluginContext) => {
    context.services.unregister('my-service');
}
```

### One Name Per Plugin

**A plugin publishes exactly one registry name.** Everything a programmatic caller may do with that plugin is reachable from the object behind it, and nothing the plugin can do is reachable only over HTTP or only from its own admin screens.

The registry lists names and nothing more. `getNames()` returns every registered name for diagnostics and admin tooling, but `register()` records no metadata alongside a name, so nothing in the registry says which capability a given name carries. A consumer resolves a string it already imported, so every extra name a plugin publishes is another string a consumer has to learn from a README and another thing that can silently be absent. One name per plugin makes the plugin's own id the only thing a consumer has to know.

It also stops a plugin's abilities from splitting across two access paths. When part of the surface is on the registry and the rest is only behind admin routes, an in-process consumer ends up making HTTP calls to its own server to reach the other half.

**Where the plugin covers several distinct topics, do not put every method on the registered object.** Give it accessor methods instead, and have each accessor return a smaller service covering one of them. A caller then asks for the topic it came for and works with an interface scoped to it:

```typescript
export interface IMyPlugin {
    read(): IMyPluginReadService;
    admin(): IMyPluginAdminService | null;
    diagnostics(): IMyPluginDiagnosticsService | null;
}
```

Group the accessors by topic — the related data and abilities that belong together. Reading what a plugin has produced, administering it, and inspecting its runtime state are three different subjects, and each one is easier to learn, document, and change when it is not interleaved with the other two. That is the single responsibility principle applied to a published interface, and it is the reason for the split.

It is not an access-control mechanism. The registry gates nothing, and any caller can ask for any accessor, so a caller holding a narrow service holds it because that is the topic it asked for, not because it was denied the rest. Neither does the split by itself say anything about how often each service changes. A plugin may find that its accessors happen to divide along either line, and it is free to make use of that, but neither is what the subdivision is for.

One practical detail does come with the shape: an accessor that returns `null` reports a real condition, namely that the plugin is enabled but that part of its pipeline is not assembled, instead of leaving a method to throw.

**Publish a projection, not the implementation.** Register an explicit object listing exactly the members that are public, rather than an instance whose every public method becomes contract by accident. `trp-blog` is the reference: it registers `buildBlogServiceFacade(service)`, a seven-method projection over a class that also carries the admin reads and writes, and a test in `blog-service.test.ts` asserts the exact key set so the published surface cannot grow without someone noticing.

## Sharing the Contract — Types-Only Sibling Package

Provider plugins publish their service interface as a small types-only sibling package at `packages/types/` inside the provider's repo, named like `@delphian/trp-<plugin>-types`, published to the registry (GitHub Packages). A consumer declares that published, versioned package in its own `dependencies` — exactly as it declares the core `@delphian/tronrelic-types` contract — and installs it like any third-party package, so the contract resolves from the consumer's own `node_modules`, identically in the monorepo and in a standalone build. Use `dependencies`, not `devDependencies`: the build installs plugins with `--omit=dev`, which prunes a build-time type declared as dev. The `import type`-only rule (below) keeps this off the runtime graph — the cost is just the tiny types package on disk. Per the [coupling invariant](./plugins.md#plugins-couple-only-through-published-contracts), the monorepo is not a dependency channel: a consumer never reaches the provider's in-tree source and never relies on workspace hoisting to resolve the contract. Import the real interface:

```typescript
import type { IXPosterService } from '@delphian/trp-x-poster-types';

const xposter = context.services.get<IXPosterService>('x-poster');
if (xposter) {
    const ready = await xposter.isConfigured();
}
```

**Platform-wide contracts live in core, not a sibling package.** A service interface that many plugins consume belongs in `@delphian/tronrelic-types`, not in one plugin's sibling package. The AI tool contracts (`IAiTool`, `IAiProvider`), the `'ai-tools'` registry (`IAiToolRegistry`), and the `'ai-providers'` registry (`IAiProviderRegistry`) are core for exactly this reason — every tool-providing plugin and the AI provider need them — so a tool provider imports them from `@delphian/tronrelic-types` and registers tools on the core `'ai-tools'` registry, never on a provider's sibling package. The sibling-package pattern is for a contract specific to one plugin that only some peers consume, like `IXPosterService` above.

**Consumers must use `import type` only.** The types package exists purely so the TypeScript compiler sees the real contract — a signature change in the provider then surfaces as a build error in the consumer instead of a silent runtime break. `import type` erases at compile time and leaves no `require`/`import` in emitted JS, so listing the types package creates no runtime dependency on the provider plugin. The runtime lookup still flows through `context.services.get('x-poster')` and returns `undefined` when the provider is disabled or uninstalled — graceful degradation is preserved. If a consumer ever needs a runtime value (a constant, a helper) from the provider, promote that code to a package that ships runtime JS and declare a real dependency; do not value-import from a types-only package.

Canonical sibling-package provider: `trp-x-poster` (publishes `IXPosterService` as `@delphian/trp-x-poster-types`). Canonical consumers: `trp-bazi-fortune/src/backend/backend.ts` watches the core `'ai-providers'` registry and resolves the active provider lazily via `getActive()` for AI queries; tool providers like `trp-telegram-bot` watch the core `'ai-tools'` registry to register tools.

### Anti-Pattern: Do Not Redeclare the Interface Locally

Tempting alternative: write a "minimal structural adapter" describing only the methods the consumer calls, type registered payloads as `unknown`, avoid the dependency on the provider's types package. Don't. It reproduces the contract *by guessing*, and when the provider changes a method signature, adds a required field to its payload type, or renames an identifier, the consumer compiles green and fails at runtime. The types-only package exists to close that gap — import the real interface, never redeclare it locally.

## Consuming a Service

Two lookup shapes. The choice is about consumer lifetime, not provider identity.

### `get()` — One-Shot Read

Use `get()` when the caller needs the service at a single moment and doesn't care whether it appears or disappears later (an admin route, a one-off migration, diagnostics). Always handle the undefined case. For the active AI provider, resolve the core `'ai-providers'` registry and call `getActive()` — never a vendor service key:

```typescript
import type { IAiProviderRegistry } from '@delphian/tronrelic-types';

const ai = context.services.get<IAiProviderRegistry>('ai-providers')?.getActive();
if (ai) {
    const result = await ai.ask('Analyze recent transactions');
    context.logger.info({ text: result.responseText }, 'ai response');
}
```

### `watch()` — Continuous Presence

Use `watch()` when the caller's behavior depends on the service being present over time — registering peer-facing hooks the moment a provider appears, dropping cached references when it goes away. `watch()` fires `onAvailable` synchronously if the service is already registered at subscription time, re-fires on every subsequent re-registration, and fires `onUnavailable` whenever the provider unregisters. This closes two gaps `get()` cannot: the boot-order race where the consumer's `init()` runs before the provider's, and runtime churn where a provider is disabled and re-enabled by an operator.

```typescript
import type { IAiToolRegistry } from '@delphian/tronrelic-types';

let unwatchTools: (() => void) | null = null;

init: async (context: IPluginContext) => {
    unwatchTools = context.services.watch<IAiToolRegistry>('ai-tools', {
        onAvailable: (registry) => registry.registerTool(myToolDefinition, myManifest.id),
        onUnavailable: () => context.logger.info('ai-tools gone — tool unregistered')
    });
},

disable: async (context: IPluginContext) => {
    unwatchTools?.();
    unwatchTools = null;
}
```

`watch()` is state-oriented, not event-oriented: the registry models "does this capability exist right now?" as a continuous truth, and `watch()` subscribes the caller to that truth.

**Three rules for handlers:**

- **`onAvailable` must be idempotent** — the registry fires it again on every re-registration.
- **`onUnavailable` is past tense** — the provider's instance is already gone; don't call into it.
- **Always dispose in `disable()`** — the disposer returned from `watch()` prevents the registry from retaining closures that point at torn-down plugin state.

## Platform-Provided Services: `user-groups`

Modules also publish on the registry. `IUserGroupService` (registered as `'user-groups'` by the identity module) is the canonical entry point for plugin permission gating. It exposes membership reads and writes (`isMember`, `getUserGroups`, `addMember`, `removeMember`) plus an `isAdmin(userId)` predicate — admin is membership in the single literal `admin` group. The contract ships with the platform via `@/types`, so consumers don't need a sibling types package:

```typescript
import type { IUserGroupService } from '@/types';

const groups = context.services.get<IUserGroupService>('user-groups');
// `userId` is a Better Auth account id you already hold — e.g. req.authSession.user.id
if (groups && userId && await groups.isAdmin(userId)) {
    // This account is an admin
}
```

`isAdmin(userId)` answers "is this *account* an admin?" — pass it a Better Auth user id you already hold. For the common "is the *caller* an admin?" question inside a request handler, prefer the synchronous Better Auth predicate `isAdmin(req)` from `@/types`, which reads `req.authSession` directly and needs no account-id plumbing.

**Do not conflate either with route-level admin auth.** The `requiresAdmin: true` flag on `IApiRouteConfig` and the `requireAdmin` middleware admit a request when, in order, (a) the Better Auth session is in the `admin` group, or (b) the request carries `ADMIN_API_TOKEN` via `x-admin-token` / `Authorization: Bearer`. The middleware tags the request with `req.adminVia = 'user' | 'service-token'` and short-circuits failures; `isAdmin(req)` is a pure predicate the handler consults to vary response shape. A typical admin route combines them: protect with `requiresAdmin: true`, then call `isAdmin(req)` inside to render per-operator UI. Plugins that need per-account admin gating must call `IUserGroupService.isAdmin` rather than rolling their own scheme. See [system-auth.md](../system/system-auth.md).

See the [Identity Module README](../../src/backend/modules/identity/README.md#published-service-contracts) for the `IUserGroupService` method table and the `admin`-group semantics.

## Platform-Provided Services: `content`

Core publishes the managed content service as `'content'` (`IContentService`) before any module or plugin starts. A plugin that owns content — an item the platform stores and publishes, such as a post, article, or draft — must use it: implement `IManagedContentType`, register it with `registerType()` from a `watch('content', …)` handler, and call the returned disposer in `disable()`. Every create, read, update, delete, and restore of that content then goes through the service, carrying an `IContentActor` that says who is acting and whether they are a curator. The contract types ship in `@/types`. See [system-content.md](../system/system-content.md) for the model and the author contract.

## Platform-Provided Services: `page-bootstrap`

The pages module publishes `'page-bootstrap'` (`PAGE_BOOTSTRAP_SERVICE`, contract `IPageBootstrapService` in `@/types`) so a plugin can offer a default CMS page that an admin creates from the plugin's Bootstrap tab, such as a page that embeds the plugin's dashboard as a widget with editable text around it. It is the only page access a plugin gets. The full `IPageService` stays off the registry because it can write as a curator, which publishes without review, and edit the list of addresses pages may never take.

Call `createCatalog(items, context.logger)` with your `IPageBootstrapItem` list, then `list()` and `create(id)` from your admin routes. `create` proposes the page as a non-curator, so it always waits in `/system/curation`, and returns a refusal as `{ created: false, reason, message }`; answer it with `PAGE_BOOTSTRAP_REFUSAL_STATUS[reason]`. Use `get()` per request rather than in `init()`, so the plugin still loads on a core that predates the service. A page built around one of your widgets should embed it with `"required": true`, so the page is treated as missing while your plugin is disabled. `trp-whale-alerts` is the reference; the rules are in the [Pages Module README](../../src/backend/modules/pages/README.md#page-bootstrap).

## Platform-Provided Services: `markdown`

Core's markdown module publishes the shared markdown renderer as `'markdown'` (`IMarkdownRendererService`) before any plugin loads. A plugin that shows authored markdown to visitors renders it through `render(markdown, options?)` instead of carrying its own remark and rehype pipeline, so the sanitize rules that make `dangerouslySetInnerHTML` safe are the same everywhere. Use `get()` in `init()`: a module cannot be disabled, so the entry is either present for the life of the process or missing because the plugin is running on a core too old to have it. The `trp-blog` plugin is the reference consumer, and passes `{ demoteHeadings: true }` because its post page owns the `<h1>`. See the [Markdown Module README](../../src/backend/modules/markdown/README.md).

## Further Reading

- [plugins.md](./plugins.md) — Plugin system overview
- [plugins-api-registration.md](./plugins-api-registration.md) — `requiresAdmin` flag and dual-track middleware
- [modules.md](../system/modules/modules.md#module-vs-plugin-decision-matrix) — How the registry shifts the module vs plugin decision
- [modules-architecture.md](../system/modules/modules-architecture.md#service-registry--late-binding-di) — Module-side perspective on the registry
- [Identity Module README](../../src/backend/modules/identity/README.md#published-service-contracts) — `IUserGroupService` reference
