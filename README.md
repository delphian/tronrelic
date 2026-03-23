# TronRelic

Open-source TRON blockchain analytics platform with real-time monitoring, whale tracking, and extensible plugins.

## Quick Start

```bash
cp .env.example .env
openssl rand -hex 32  # Add to ADMIN_API_TOKEN in .env
# Add TronGrid API keys to .env (get free keys at https://www.trongrid.io/)

npm install
npm run dev
```

**URLs:** Frontend http://localhost:3000 | API http://localhost:4000 | Admin http://localhost:3000/system

**Stop:** Press Ctrl+C to stop dev servers. Run `npm run stop` to stop database containers.

**Requirements:** Node.js 20+, Docker, TronGrid API keys

## License

AGPL-3.0-or-later with plugin exception. Third-party plugins may use any license. See [LICENSE](LICENSE) for details.

## Documentation

**STOP. Before working on any topic below, you MUST click through and read the associated documentation.** These documents contain architectural decisions, required patterns, and constraints that are non-negotiable. Skipping them leads to rejected code, security vulnerabilities, and wasted effort.

### Core

| Document | Purpose |
|----------|---------|
| [Documentation Standards](docs/documentation.md) | Writing style, structure, cross-references |
| [Environment Variables](docs/environment.md) | All backend/frontend configuration options |

### System Architecture

| Document | Purpose |
|----------|---------|
| [System Overview](docs/system/system.md) | Blockchain sync, scheduler, observers, metrics |
| [Backend Modules](docs/system/modules/modules.md) | IModule interface, init/run lifecycle, DI |
| [Database Access](docs/system/system-database.md) | IDatabaseService abstraction, three-tier access |
| [System API Reference](docs/system/system-api.md) | 16+ admin endpoints, authentication |
| [Blockchain Sync](docs/system/system-blockchain-sync-architecture.md) | Block retrieval, enrichment, observer notification |
| [System Dashboard](docs/system/system-dashboard.md) | /system UI, job control, monitoring |
| [Database Migrations](docs/system/system-database-migrations.md) | Schema evolution, transaction support |
| [Logging System](docs/system/system-logging.md) | Pino, MongoDB persistence, log queries |
| [Menu Module](src/backend/modules/menu/README.md) | Navigation management, plugin integration |
| [Pages Module](src/backend/modules/pages/README.md) | CMS, markdown, file uploads |
| [User Module](src/backend/modules/user/README.md) | Identity, wallet linking, preferences |
| [Runtime Configuration](docs/system/system-runtime-config.md) | Universal Docker images, SITE_URL |
| [Scheduler Operations](docs/system/system-scheduler-operations.md) | Job management, cron, troubleshooting |
| [Testing Framework](docs/system/system-testing.md) | Vitest, Mongoose mocks, test isolation |

### Plugin Development

| Document | Purpose |
|----------|---------|
| [Plugin Overview](docs/plugins/plugins.md) | Lifecycle, structure, capabilities |
| [API Registration](docs/plugins/plugins-api-registration.md) | REST routes, middleware, admin endpoints |
| [Blockchain Observers](docs/plugins/plugins-blockchain-observers.md) | Transaction processing, subscriptions |
| [Frontend Context](docs/plugins/plugins-frontend-context.md) | API client, WebSocket, toasts, modals |
| [Page Registration](docs/plugins/plugins-page-registration.md) | Routes, dynamic segments, SSR |
| [Plugin Architecture](docs/plugins/plugins-system-architecture.md) | Loader, manifests, error isolation |
| [WebSocket Subscriptions](docs/plugins/plugins-websocket-subscriptions.md) | Real-time events, rooms, namespacing |
| [Widget Zones](docs/plugins/plugins-widget-zones.md) | Injecting UI into core pages |

### Frontend Development

| Document | Purpose |
|----------|---------|
| [Frontend Overview](docs/frontend/frontend.md) | Next.js 14, modules, SSR + Live Updates |
| [Frontend Architecture](docs/frontend/frontend-architecture.md) | Directory structure, modules vs features |
| [React Components](docs/frontend/react/react.md) | Server/client components, hooks, context |
| [UI System](docs/frontend/ui/ui.md) | Design tokens, SCSS Modules, layout |
| [SCSS Modules](docs/frontend/ui/ui-scss-modules.md) | CSS variables, naming conventions, component styling |
| [Responsive Design](docs/frontend/ui/ui-responsive-design.md) | Container queries, breakpoints |
| [Icons and Feedback](docs/frontend/ui/ui-icons-and-feedback.md) | Lucide icons, animations, state feedback |
| [Accessibility](docs/frontend/ui/ui-accessibility.md) | Semantic HTML, ARIA labels, plugin styling |
| [SSR Hydration](docs/frontend/ui/ui-ssr-hydration.md) | Hydration error prevention, ClientTime |
| [Design Tokens](docs/frontend/ui/ui-design-token-layers.md) | Primitives, semantic tokens, theming |
| [Theme System](docs/frontend/ui/ui-theme.md) | Admin themes, CSS overrides, SSR injection |

### TRON Blockchain

| Document | Purpose |
|----------|---------|
| [TRON Overview](docs/tron/tron.md) | Energy system, transactions, parameters |
| [Chain Parameters](docs/tron/tron-chain-parameters.md) | Service, conversions, caching |

**This is not optional.** Load and read the relevant documents before writing code. The patterns exist because they were learned through costly mistakes. Respect that investment.
