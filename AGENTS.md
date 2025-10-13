# Project Rules

**Always load and apply the following documentation before answering or changing code:**

- [@AGENTS.md](AGENTS.md)
- [@api-catalog.md](docs/api-catalog.md)
- [@tron-chain-parameters.md](docs/tron/tron-chain-parameters.md)
- [@documentation-guidance.md](docs/documentation-guidance.md)
- [@environment.md](docs/environment.md)
- [@frontend.md](docs/frontend/frontend.md)
- [@frontend-architecture.md](docs/frontend/frontend-architecture.md)
- [@frontend-component-guide.md](docs/frontend/frontend-component-guide.md)
- [@market-fetcher-discovery.md](docs/markets/market-fetcher-discovery.md)
- [@market-system-architecture.md](docs/markets/market-system-architecture.md)
- [@market-system-operations.md](docs/markets/market-system-operations.md)
- [@plugins.md](docs/plugins/plugins.md)
- [@plugins-system-architecture.md](docs/plugins/plugins-system-architecture.md)
- [@plugins-blockchain-observers.md](docs/plugins/plugins-blockchain-observers.md)
- [@plugins-page-registration.md](docs/plugins/plugins-page-registration.md)
- [@plugins-frontend-context.md](docs/plugins/plugins-frontend-context.md)
- [@plugins-api-registration.md](docs/plugins/plugins-api-registration.md)
- [@plugins-database.md](docs/plugins/plugins-database.md)
- [@plugins-websocket-subscriptions.md](docs/plugins/plugins-websocket-subscriptions.md)

## Code Quality
- Dependency Injection via constructor is prefered.
- Do not 'bypass' issues, always design code and fix bugs with best practice solutions.
- Use 4 spaces for tabs, not 2.

## Documentation Rules
- Annotate **every** function, method, and class with a top-level JSDoc block before shipping the change—this includes inner helpers, React hooks, callbacks passed to lifecycle hooks, and any closures declared inside a component. If code adds a new function, it must arrive documented in the same diff; do not wait for reviewers to ask.
- Lead with the **why**: start each doc comment by explaining the purpose or risk addressed, then describe **how** the code achieves it in plain English. Only add code examples when they clarify usage.
- Use `@param` for every parameter and describe why the caller supplies it (not just its type). Use `@returns` to state what the function produces and why a caller needs it.
- Keep parameter/return descriptions focused on intent and behaviour rather than repeating type information verbatim.
## TypeScript Naming Conventions

### Interfaces
- Prefix all interfaces with `I` (e.g., `IPluginContext`, `IObserverRegistry`, `IWebSocketService`)
- This applies to all interfaces consistently, including data structures, service contracts, and type definitions
- Concrete class implementations should not have the `I` prefix (e.g., `class ObserverRegistry implements IObserverRegistry`)

### File Names
- File names must match their primary export exactly, including capitalization
- Interface files: `IPluginContext.ts` exports `IPluginContext`
 - Type files: `IObserverStats.ts` exports `IObserverStats`
- Class files: `ObserverRegistry.ts` exports `class ObserverRegistry`
- This creates a predictable 1:1 mapping between file names and exports
- Do not use suffixes like `.interface.ts` or `.type.ts` - the file name itself should match the export

## Package Architecture
- All packages should use workspace imports (e.g., `@tronrelic/types`, `@tronrelic/plugins`) instead of relative paths
- Frontend and backend both import from workspace packages using the same pattern
- Type packages (`@tronrelic/types`) must have `"composite": true` in tsconfig for project references
- Packages that are imported by other workspaces need project references in consuming workspace tsconfigs
- Plugin types should use direct component types, not async loaders (e.g., `component?: ComponentType<any>`)

### Type Organization Strategy

**@tronrelic/types** is the central repository for all framework-independent core models and interfaces:

- **Primary purpose**: Define all non-dependent core models that can be shared across the entire application
- **Blockchain models**: Especially prioritize blockchain-related models in `@tronrelic/types` to maximize code sharing between frontend and backend
- **Framework independence**: Types must not depend on external libraries (except React types for UI components)
- **Organized structure**: Group related types in folders (e.g., `observer/`, `plugin/`, `transaction/`)
- **One type per file**: Each file exports exactly one interface, type, or utility matching its filename

**When to use @tronrelic/types vs @tronrelic/shared:**
- `@tronrelic/types` - Core interfaces, blockchain models, observer patterns, plugin definitions (framework-independent)
- `@tronrelic/shared` - Runtime data structures for Socket.IO events, API responses, legacy compatibility

**Migration strategy**: As new blockchain models are created or existing models are refactored, move them to `@tronrelic/types` to centralize shared type definitions and reduce duplication between frontend and backend.

## Build and Deployment

### Clean Rebuild Process
When performing a clean rebuild of the entire project, always use the project scripts to ensure proper build order and dependency handling:

1. **Stop all running services first:**
   ```bash
   ./scripts/stop.sh
   ```

2. **Start with clean rebuild flag:**
   ```bash
   ./scripts/start.sh --force-build
   ```

**Available start.sh options:**
- `--force-build` - Removes all build artifacts (dist/, .next/, .tsbuildinfo) and rebuilds everything from scratch
- `--force-docker` - Recreates MongoDB/Redis containers and volumes (use when database state is corrupted)
- `--force` - Full reset: combines --force-build, --force-docker, and reruns ETL pipeline
- `--prod` - Runs frontend in production mode instead of development

**Why this matters:**
The build system has dependencies between packages (types → plugins → backend/frontend). The start.sh script handles the correct build order automatically. Manual `npm run build` commands may compile packages in the wrong order, causing TypeScript resolution errors.

**Never manually build individual packages** unless you understand the dependency graph. Always use `./scripts/start.sh --force-build` for clean rebuilds.

## Playwright Tests
- Always wait 10 minutes for tests to complete.
- Always examine the attachment screenshot if available in results.
