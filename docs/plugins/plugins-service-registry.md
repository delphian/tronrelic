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
    context.services.register('ai-assistant', myService);
},
disable: async (context: IPluginContext) => {
    context.services.unregister('ai-assistant');
}
```

## Sharing the Contract — Types-Only Sibling Package

Provider plugins publish their service interface as a small types-only sibling package at `packages/types/` inside the provider's repo, named like `@delphian/trp-<plugin>-types`, published to the registry (GitHub Packages). A consumer declares that published, versioned package in its own `dependencies` — exactly as it declares the core `@delphian/tronrelic-types` contract — and installs it like any third-party package, so the contract resolves from the consumer's own `node_modules`, identically in the monorepo and in a standalone build. Use `dependencies`, not `devDependencies`: the build installs plugins with `--omit=dev`, which prunes a build-time type declared as dev. The `import type`-only rule (below) keeps this off the runtime graph — the cost is just the tiny types package on disk. Per the [coupling invariant](./plugins.md#plugins-couple-only-through-published-contracts), the monorepo is not a dependency channel: a consumer never reaches the provider's in-tree source and never relies on workspace hoisting to resolve the contract. Import the real interface:

```typescript
import type { IXPosterService } from '@delphian/trp-x-poster-types';

const xposter = context.services.get<IXPosterService>('x-poster');
if (xposter) {
    const ready = await xposter.isConfigured();
}
```

**Platform-wide contracts live in core, not a sibling package.** A service interface that many plugins consume belongs in `@delphian/tronrelic-types`, not in one plugin's sibling package. The AI tool contracts (`IAiTool`, `IAiAssistantService`) and the `'ai-tools'` registry (`IAiToolRegistry`) are core for exactly this reason — every tool-providing plugin and the AI provider need them — so a tool provider imports them from `@delphian/tronrelic-types` and registers tools on the core `'ai-tools'` registry, never on a provider's sibling package. The sibling-package pattern is for a contract specific to one plugin that only some peers consume, like `IXPosterService` above.

**Consumers must use `import type` only.** The types package exists purely so the TypeScript compiler sees the real contract — a signature change in the provider then surfaces as a build error in the consumer instead of a silent runtime break. `import type` erases at compile time and leaves no `require`/`import` in emitted JS, so listing the types package creates no runtime dependency on the provider plugin. The runtime lookup still flows through `context.services.get('x-poster')` and returns `undefined` when the provider is disabled or uninstalled — graceful degradation is preserved. If a consumer ever needs a runtime value (a constant, a helper) from the provider, promote that code to a package that ships runtime JS and declare a real dependency; do not value-import from a types-only package.

Canonical sibling-package provider: `trp-x-poster` (publishes `IXPosterService` as `@delphian/trp-x-poster-types`). Canonical consumers: `trp-bazi-fortune/src/backend/backend.ts` watches the core `'ai-assistant'` service for AI queries; tool providers like `trp-telegram-bot` watch the core `'ai-tools'` registry to register tools.

### Anti-Pattern: Do Not Redeclare the Interface Locally

Tempting alternative: write a "minimal structural adapter" describing only the methods the consumer calls, type registered payloads as `unknown`, avoid the dependency on the provider's types package. Don't. It reproduces the contract *by guessing*, and when the provider changes a method signature, adds a required field to its payload type, or renames an identifier, the consumer compiles green and fails at runtime. The types-only package exists to close that gap — import the real interface, never redeclare it locally.

## Consuming a Service

Two lookup shapes. The choice is about consumer lifetime, not provider identity.

### `get()` — One-Shot Read

Use `get()` when the caller needs the service at a single moment and doesn't care whether it appears or disappears later (an admin route, a one-off migration, diagnostics). Always handle the undefined case:

```typescript
import type { IAiAssistantService } from '@delphian/tronrelic-types';

const ai = context.services.get<IAiAssistantService>('ai-assistant');
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

## Further Reading

- [plugins.md](./plugins.md) — Plugin system overview
- [plugins-api-registration.md](./plugins-api-registration.md) — `requiresAdmin` flag and dual-track middleware
- [modules.md](../system/modules/modules.md#module-vs-plugin-decision-matrix) — How the registry shifts the module vs plugin decision
- [modules-architecture.md](../system/modules/modules-architecture.md#service-registry--late-binding-di) — Module-side perspective on the registry
- [Identity Module README](../../src/backend/modules/identity/README.md#published-service-contracts) — `IUserGroupService` reference
