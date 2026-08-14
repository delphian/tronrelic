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

**Requirements:** Node.js 24+, Docker, TronGrid API keys

## License

AGPL-3.0-or-later with a plugin exception, which means third-party plugins may use any license. See [LICENSE](LICENSE) for details.

## Documentation

**Read the linked documentation before working on any topic below.** These documents record the architectural decisions, required patterns, and constraints the project works to. Skipping them leads to rejected code, security problems, and wasted effort.

### Core

| Document | Purpose |
|----------|---------|
| [Documentation Standards](docs/documentation.md) | Writing style, document structure, and cross-referencing |
| [Environment Variables](docs/environment.md) | Configuration options for the backend and frontend, and the non-obvious behaviors behind them |

### Backend (System Architecture)

Everything under `src/backend/`: modules, blockchain sync, the scheduler, database access, the system API, and the admin dashboard. For the frontend, see [Frontend Development](#frontend-development) below.

| Document | Purpose |
|----------|---------|
| [System Overview](docs/system/system.md) | Blockchain sync, the scheduler, observers, and metrics |
| [Backend Modules](docs/system/modules/modules.md) | The `IModule` interface, the two-phase init and run lifecycle, and dependency injection |
| [Database Access](docs/system/system-database.md) | The `IDatabaseService` abstraction and its three levels of access |
| [System API Reference](docs/system/system-api.md) | The 16-plus admin endpoints and how they authenticate |
| [Blockchain Sync](docs/system/system-blockchain-sync-architecture.md) | Retrieving blocks, enriching transactions, and notifying observers |
| [System Dashboard](docs/system/system-dashboard.md) | The `/system` interface for job control and monitoring |
| [Database Migrations](docs/system/system-database-migrations.md) | Evolving the schema, with transaction support |
| [Logging System](docs/system/system-logging.md) | Pino, persistence to MongoDB, and querying past logs |
| [AI Tool Standard](docs/system/system-ai-tools.md) | The tool contract, capability classes, and the accountability and security rules for tools an AI model can invoke |
| [Menu Module](src/backend/modules/menu/README.md) | Managing navigation and letting plugins contribute entries |
| [Pages Module](src/backend/modules/pages/README.md) | The markdown content management system and file uploads |
| [Identity Module](src/backend/modules/identity/README.md) | Better Auth, user groups, the wallet store, and the account directory |
| [Traffic Module](src/backend/modules/traffic/README.md) | ClickHouse `traffic_events` analytics, the tid and ref cookies, and Google Search Console data |
| [Runtime Configuration](docs/system/system-runtime-config.md) | Serving many domains from one Docker image, and how `SITE_URL` works |
| [Scheduler Operations](docs/system/system-scheduler-operations.md) | Managing jobs, cron schedules, and troubleshooting |
| [Testing Framework](docs/system/system-testing.md) | Vitest, Mongoose mocks, and keeping tests isolated |

### Plugin Development

| Document | Purpose |
|----------|---------|
| [Plugin Overview](docs/plugins/plugins.md) | The five lifecycle states, package structure, and what a plugin can extend |
| [API Registration](docs/plugins/plugins-api-registration.md) | REST routes, middleware, and admin endpoints |
| [Blockchain Observers](docs/plugins/plugins-blockchain-observers.md) | Processing transactions and subscribing to contract types |
| [Frontend Context](docs/plugins/plugins-frontend-context.md) | The API client, WebSocket client, toasts, and modals a plugin receives |
| [Page Registration](docs/plugins/plugins-page-registration.md) | Routes, dynamic segments, and server-side rendering |
| [Plugin Architecture](docs/plugins/plugins-system-architecture.md) | The loader, manifests, and how failures stay isolated |
| [WebSocket Subscriptions](docs/plugins/plugins-websocket-subscriptions.md) | Real-time events, rooms, and namespacing by plugin id |
| [Widget Zones](docs/plugins/plugins-widget-zones.md) | Injecting plugin UI into core pages |

### Frontend Development

| Document | Purpose |
|----------|---------|
| [Frontend Overview](docs/frontend/frontend.md) | Next.js 14, module organization, and the SSR + Live Updates pattern |
| [Frontend Architecture](docs/frontend/frontend-architecture.md) | Directory structure, and choosing between modules and features |
| [React Components](docs/frontend/react/react.md) | Server and client components, hooks, and context |
| [UI System](docs/frontend/ui/ui.md) | Design tokens, SCSS Modules, and layout components |
| [SCSS Modules](docs/frontend/ui/ui-scss-modules.md) | CSS variables, naming conventions, and styling a component |
| [Responsive Design](docs/frontend/ui/ui-responsive-design.md) | Container queries and breakpoints |
| [Icons and Feedback](docs/frontend/ui/ui-icons-and-feedback.md) | Lucide icons, animations, and feedback for state changes |
| [Accessibility](docs/frontend/ui/ui-accessibility.md) | Semantic HTML, ARIA labels, and plugin styling rules |
| [SSR Hydration](docs/frontend/ui/ui-ssr-hydration.md) | Preventing hydration errors, and the `ClientTime` component |
| [Design Tokens](docs/frontend/ui/ui-design-token-layers.md) | Primitives, semantic tokens, and theming |
| [Theme System](docs/frontend/ui/ui-theme.md) | Admin themes, CSS overrides, and injection during server rendering |

### TRON Blockchain

| Document | Purpose |
|----------|---------|
| [TRON Overview](docs/tron/tron.md) | The energy system, transactions, and chain parameters |
| [Chain Parameters](docs/tron/tron-chain-parameters.md) | The parameter service, unit conversions, and caching |

Read the relevant documents before writing code. These patterns come from problems the project has already run into, so following them avoids repeating those problems.
