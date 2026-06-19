# Project Rules

**Always load and apply these foundational documents first:**

- [@environment.md](docs/environment.md) - Environment variable reference
- [@tron.md](docs/tron/tron.md) - TRON blockchain concepts overview
- [@frontend.md](docs/frontend/frontend.md) - Frontend system overview
- [@plugins.md](docs/plugins/plugins.md) - Plugin system overview
- [@system.md](docs/system/system.md) - System architecture overview
- [@documentation.md](docs/documentation.md) - Documentation standards and writing conventions

**Note:** These summary documents link to detailed implementation guides. Load additional detailed documentation as needed based on your specific task (e.g., load `frontend-architecture.md` when working on frontend file organization, load `plugins-blockchain-observers.md` when implementing transaction observers).

## Code Quality
- Dependency Injection via constructor is prefered.
- Do not 'bypass' issues, always design code and fix bugs with best practice solutions.
- Use 4 spaces for tabs, not 2.

## TypeScript Naming Conventions

### File Names
- File names must match their primary export exactly, including capitalization
- Interface files: `IPluginContext.ts` exports `IPluginContext`
 - Type files: `IObserverStats.ts` exports `IObserverStats`
- Class files: `ObserverRegistry.ts` exports `class ObserverRegistry`
- This creates a predictable 1:1 mapping between file names and exports
- Do not use suffixes like `.interface.ts` or `.type.ts` - the file name itself should match the export

## Package Architecture
- Frontend and backend both import core types from the workspace package using the same pattern
- Type packages (`@/types`) must have `"composite": true` in tsconfig for project references
- Packages that are imported by other workspaces need project references in consuming workspace tsconfigs
- Plugin types should use direct component types, not async loaders (e.g., `component?: ComponentType<any>`)

### Type Organization Strategy

**@/types** is the central repository for all framework-independent core models and interfaces:

- **Primary purpose**: Define all non-dependent core models that can be shared across the entire application
- **Blockchain models**: Especially prioritize blockchain-related models in `@/types` to maximize code sharing between frontend and backend
- **Framework independence**: Types must not depend on external libraries (except React types for UI components)
- **Organized structure**: Group related types in folders (e.g., `observer/`, `plugin/`, `transaction/`)
- **One type per file**: Each file exports exactly one interface, type, or utility matching its filename

**Migration strategy**: As new blockchain models are created or existing models are refactored, move them to `@/types` to centralize shared type definitions and reduce duplication between frontend and backend.

## Build and Deployment

### Development Workflow

Start the development environment with a single command:

```bash
npm run dev
```

This starts database containers (MongoDB, Redis, ClickHouse), waits for them to be healthy, then runs backend and frontend in the foreground. Press Ctrl+C to stop.

**Available npm scripts:**
- `npm run dev` - Start everything (databases + dev servers)
- `npm run stop` - Stop database containers
- `npm run clean` - Remove build artifacts (dist/, .next/, .tsbuildinfo)
- `npm run reset` - Stop containers AND delete data volumes

### Clean Rebuild Process

When you need a fresh start:

```bash
npm run stop      # Stop database containers
npm run clean     # Remove build artifacts
npm run dev       # Start fresh
```

To also reset database data:

```bash
npm run reset     # Stop containers and delete volumes
npm run dev       # Start with empty databases
```
