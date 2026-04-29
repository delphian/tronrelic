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

Provider plugins publish their service interface (e.g. `IAiAssistantService`, `IAiTool`) as a small types-only sibling package at `packages/types/` inside the provider's repo, named like `@delphian/trp-<plugin>-types`. TronRelic treats these as workspaces of the root `tronrelic` package (see `package.json` `"workspaces": ["src/plugins/*/packages/*"]`), so the root `npm ci` links the package into `/app/node_modules` once and every plugin resolves the import via Node's module walk-up. Consumer plugins declare the types package in *both* `peerDependencies` and `devDependencies` — matching how core types like `@delphian/tronrelic-types` are handled — and import the real interface:

```typescript
import type { IAiAssistantService, IAiTool } from '@delphian/trp-ai-assistant-types';

const ai = context.services.get<IAiAssistantService>('ai-assistant');
if (ai) {
    const tool: IAiTool = { name: 'my-tool', description: '…', inputSchema: { /* … */ }, handler };
    ai.registerTool(tool);
}
```

**Consumers must use `import type` only.** The types package exists purely so the TypeScript compiler sees the real contract — a signature change in the provider then surfaces as a build error in the consumer instead of a silent runtime break. `import type` erases at compile time and leaves no `require`/`import` in emitted JS, so listing the types package creates no runtime dependency on the provider plugin. The runtime lookup still flows through `context.services.get('ai-assistant')` and returns `undefined` when the provider is disabled or uninstalled — graceful degradation is preserved. If a consumer ever needs a runtime value (a constant, a helper) from the provider, promote that code to a package that ships runtime JS and declare a real dependency; do not value-import from a types-only package.

Canonical provider: `trp-ai-assistant/packages/types/`. Canonical consumer: `trp-bazi-fortune/src/backend/backend.ts`.

### Anti-Pattern: Do Not Redeclare the Interface Locally

Tempting alternative: write a "minimal structural adapter" describing only the methods the consumer calls, type registered payloads as `unknown`, avoid the dependency on the provider's types package. Don't. It reproduces the contract *by guessing*, and when the provider changes a method signature, adds a required field to its payload type, or renames an identifier, the consumer compiles green and fails at runtime. The types-only package exists to close that gap — import the real interface, never redeclare it locally.

## Consuming a Service

Two lookup shapes. The choice is about consumer lifetime, not provider identity.

### `get()` — One-Shot Read

Use `get()` when the caller needs the service at a single moment and doesn't care whether it appears or disappears later (an admin route, a one-off migration, diagnostics). Always handle the undefined case:

```typescript
import type { IAiAssistantService } from '@delphian/trp-ai-assistant-types';

const ai = context.services.get<IAiAssistantService>('ai-assistant');
if (ai) {
    const result = await ai.ask('Analyze recent transactions');
    context.logger.info({ text: result.text }, 'ai response');
}
```

### `watch()` — Continuous Presence

Use `watch()` when the caller's behavior depends on the service being present over time — registering peer-facing hooks the moment a provider appears, dropping cached references when it goes away. `watch()` fires `onAvailable` synchronously if the service is already registered at subscription time, re-fires on every subsequent re-registration, and fires `onUnavailable` whenever the provider unregisters. This closes two gaps `get()` cannot: the boot-order race where the consumer's `init()` runs before the provider's, and runtime churn where a provider is disabled and re-enabled by an operator.

```typescript
let unwatchAi: (() => void) | null = null;

init: async (context: IPluginContext) => {
    unwatchAi = context.services.watch<IAiAssistantService>('ai-assistant', {
        onAvailable: (ai) => ai.registerTool(myToolDefinition),
        onUnavailable: () => context.logger.info('ai-assistant gone — tool unregistered')
    });
},

disable: async (context: IPluginContext) => {
    unwatchAi?.();
    unwatchAi = null;
}
```

`watch()` is state-oriented, not event-oriented: the registry models "does this capability exist right now?" as a continuous truth, and `watch()` subscribes the caller to that truth.

**Three rules for handlers:**

- **`onAvailable` must be idempotent** — the registry fires it again on every re-registration.
- **`onUnavailable` is past tense** — the provider's instance is already gone; don't call into it.
- **Always dispose in `disable()`** — the disposer returned from `watch()` prevents the registry from retaining closures that point at torn-down plugin state.

## Platform-Provided Services: `user-groups`

Modules also publish on the registry. `IUserGroupService` (registered as `'user-groups'` by the user module) is the canonical entry point for plugin permission gating. It exposes membership reads and writes (`isMember`, `getUserGroups`, `addMember`, `removeMember`) plus a special `isAdmin(userId)` predicate that resolves through any system-flagged group whose id matches the reserved-admin pattern. The service contract ships with the platform via `@/types`, so consumers don't need a sibling types package:

```typescript
import type { IUserGroupService } from '@/types';

const groups = context.services.get<IUserGroupService>('user-groups');
if (groups && req.userId && await groups.isAdmin(req.userId)) {
    // Render admin-only UI for the cookie-identified visitor
}
```

`isAdmin(userId)` is a per-user predicate keyed off the visitor's UUID — use it whenever a request handler runs in cookie-identified context and the question is "should this person see admin UI?"

**Do not conflate it with route-level admin auth.** The `requiresAdmin: true` flag on `IApiRouteConfig` and the `requireAdmin` middleware run the [admin authentication — dual-track](../../src/backend/modules/user/README.md#admin-authentication--dual-track) flow: a request is admitted when *either* (a) the signed `tronrelic_uid` cookie identifies a Verified user in the `admin` group, *or* (b) the request carries `ADMIN_API_TOKEN` via `x-admin-token` / `Authorization: Bearer`. The middleware tags the request with `req.adminVia = 'user' | 'service-token'` so handlers and audit logs can distinguish the two.

The cookie path overlaps with `groups.isAdmin(req.userId)` — both ask "is this human an admin?" — but the middleware short-circuits the request on failure, while `groups.isAdmin` is a pure predicate the handler consults to vary response shape. A typical admin SPA combines them: protect the route with `requireAdmin` so unauthenticated callers don't reach the handler, then call `groups.isAdmin(req.userId)` inside to make per-user rendering decisions. Plugins that want per-user admin gating must call `IUserGroupService.isAdmin` rather than rolling their own scheme — the JSDoc on the interface explicitly warns against parallel permission models.

See the [User Module README](../../src/backend/modules/user/README.md#user-groups-and-admin-status) for the full method table, reserved-admin slug rules, and cache-invalidation semantics.

## Further Reading

- [plugins.md](./plugins.md) — Plugin system overview
- [plugins-api-registration.md](./plugins-api-registration.md) — `requiresAdmin` flag and dual-track middleware
- [modules.md](../system/modules/modules.md#module-vs-plugin-decision-matrix) — How the registry shifts the module vs plugin decision
- [modules-architecture.md](../system/modules/modules-architecture.md#service-registry--late-binding-di) — Module-side perspective on the registry
- [User Module README](../../src/backend/modules/user/README.md#user-groups-and-admin-status) — `IUserGroupService` reference
