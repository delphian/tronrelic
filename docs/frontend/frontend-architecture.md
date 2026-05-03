# Frontend Architecture

How TronRelic's frontend organizes code and resolves environment values. Mirrors the backend's modular structure: every domain owns a directory, every directory exports a public API.

## Why This Matters

The frontend grew out of a flat `components/` + `store/slices/` + `hooks/` layout. Finding all user-related code meant grepping three trees. Refactoring meant updating dozens of imports. Build-time `NEXT_PUBLIC_*` variables baked URLs into Docker images, blocking the one-image-many-domains deployment model. The architecture below — modules over scattered files, barrels over deep paths, runtime config over build-time inlining — exists to make those problems unrepeatable.

## The Two Rules

**Code organization:** New work goes in `src/frontend/modules/<name>/`. Each module exports through `index.ts`. Consumers import from the module root, never internal paths. Routes in `app/` are thin wrappers that import and render. The legacy `features/` directory is read-only — touch it only to maintain existing code. See [frontend-architecture-modules.md](./frontend-architecture-modules.md).

**Environment access:** Server code calls `getServerConfig()` from `@/lib/serverConfig`. Client code calls `getRuntimeConfig()` from `@/lib/runtimeConfig`. Never read `process.env.*` directly. `NEXT_PUBLIC_*` variables are forbidden — they bake URLs at build time and break the universal Docker image. The legacy `@/lib/config` module is deprecated for the same reason. See [frontend-architecture-runtime-config.md](./frontend-architecture-runtime-config.md).

## Top-Level Layout

```
src/frontend/
├── app/                  # Next.js App Router — thin route wrappers only
├── modules/              # Domain modules (primary pattern)
├── features/             # Legacy page-specific code (read-only)
├── components/
│   ├── ui/               # Generic primitives (Button, Card, Badge)
│   ├── layout/           # App shell (NavBar, Footer)
│   ├── plugins/          # Plugin system components
│   └── socket/           # Socket.IO bridge
├── lib/                  # serverConfig, runtimeConfig, api client
├── store/                # Redux store composition
└── hooks/                # Deprecated — move to modules/
```

## Detail Documents

| Document | Covers |
|----------|--------|
| [frontend-architecture-modules.md](./frontend-architecture-modules.md) | Modules vs features vs components decision matrix, module directory layout, public API barrels, thin route wrappers, component folder conventions, Redux wiring |
| [frontend-architecture-runtime-config.md](./frontend-architecture-runtime-config.md) | `getServerConfig` vs `getRuntimeConfig`, server-only env vars, anti-patterns, why `NEXT_PUBLIC_*` is forbidden, troubleshooting URL failures |

## Related

- [frontend.md](./frontend.md) — Frontend overview and SSR + Live Updates pattern
- [react.md](./react/react.md) — React patterns, server vs client components, hydration
- [ui.md](./ui/ui.md) — Design tokens, SCSS Modules, layout primitives
- [Backend Modules](../system/modules/modules.md) — Backend modular structure (parallel mental model)
- [system-runtime-config.md](../system/system-runtime-config.md) — How SSR injects runtime config into `window.__RUNTIME_CONFIG__`
