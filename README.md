# TronRelic

Real-time TRON blockchain monitoring and whale activity tracking.

## Quick Start

Start all services with one command:

```bash
./scripts/start.sh --npm
```

**Access the application:**
- Frontend: http://localhost:3000
- Backend API: http://localhost:4000
- Admin dashboard: http://localhost:3000/system

**Stop services:**
```bash
./scripts/stop.sh
```

**Alternative options:**
- `./scripts/start.sh --docker` - Run all services in Docker containers
- `./scripts/start.sh --force-build` - Clean rebuild from scratch

**Production deployment:** See [docs/operations/operations.md](docs/operations/operations.md)

## Prerequisites

- Node.js 20+
- Docker (for MongoDB and Redis)
- TronGrid API keys (get 3 free keys from https://www.trongrid.io/)

## Configuration

**Step 1:** Copy environment template
```bash
cp .env.example .env
```

**Step 2:** Generate admin token
```bash
openssl rand -hex 32  # Paste into ADMIN_API_TOKEN in .env
```

**Step 3:** Add your TronGrid API keys to `.env`

**Complete configuration reference:** [docs/environment.md](docs/environment.md)

**Note:** Never commit `.env` files. Private plugins in `packages/plugins/resource-markets` are optional and automatically skipped if not initialized.

## Architecture

```
tronrelic.com-beta/
├── apps/
│   ├── backend/              # Express API + Socket.IO + BullMQ workers
│   │   ├── src/
│   │   │   ├── api/          # HTTP routes, middleware, plugin API mount points
│   │   │   ├── modules/      # Domain services (blockchain, markets, etc.)
│   │   │   ├── database/     # Mongoose models and repositories
│   │   │   └── services/     # Shared infrastructure (cache, queues, adapters)
│   │   └── dist/             # Compiled output
│   │
│   └── frontend/             # Next.js 14 (App Router)
│       ├── app/              # Pages, layouts, and plugin catch-all routes
│       ├── components/       # React components and plugin loader
│       ├── lib/              # Client utilities, registries, and Socket.IO bridge
│       └── .next/            # Build cache (ignored in source control)
│
├── packages/
│   ├── plugins/              # Individual plugin workspaces (backend + frontend code)
│   ├── shared/               # Runtime shared utilities consumed by backend
│   └── types/                # Framework-independent core interfaces and models
│
└── scripts/
    ├── start.sh              # Start all services with incremental builds
    └── stop.sh               # Stop all services and clean up containers
```

## Key Features

- **Plugin system** - Self-contained features with backend + frontend code ([docs/plugins/plugins.md](docs/plugins/plugins.md))
- **Observer pattern** - Blockchain transaction processing without blocking sync
- **Real-time updates** - Socket.IO pushes whale transactions and market data to clients
- **Rate limit protection** - Serial API requests with 200ms throttling across rotating keys
- **Efficient sync** - One API call per block using embedded transaction data (eliminates 1,800x overhead)

## Common Commands

```bash
# Development
npm run dev --workspace apps/backend          # Backend only
npm run dev --workspace apps/frontend         # Frontend only
npm run build:parallel                        # Build all workspaces

# Testing
npm test                                      # Unit tests (vitest)
npm run test:integration                      # Integration tests (Playwright)
npm test -- --watch                          # Watch mode

# Database access
docker exec -it tronrelic-mongo mongosh tronrelic
docker exec -it tronrelic-redis redis-cli

# Logs
tail -f .run/backend.log
tail -f .run/frontend.log
```

**Admin dashboard:** http://localhost:3000/system (requires ADMIN_API_TOKEN)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Port already in use | `./scripts/stop.sh` |
| Slow builds | `./scripts/start.sh --force-build` |
| Stale cache | `rm -rf apps/frontend/.next && ./scripts/start.sh --force-build` |
| Fresh database needed | `./scripts/start.sh --force-docker` |
| Rate limit errors (429) | Verify all 3 `TRONGRID_API_KEY` set in `.env` |
| Block sync stalled | Check admin dashboard, restart with `./scripts/stop.sh && ./scripts/start.sh` |

**Comprehensive troubleshooting:** [docs/operations/operations.md](docs/operations/operations.md)

## Documentation

| Topic | Documentation |
|-------|--------------|
| Environment setup | [docs/environment.md](docs/environment.md) |
| Plugin development | [docs/plugins/plugins.md](docs/plugins/plugins.md) |
| Frontend architecture | [docs/frontend/frontend.md](docs/frontend/frontend.md) |
| System architecture | [docs/system/system.md](docs/system/system.md) |
| TRON blockchain concepts | [docs/tron/tron.md](docs/tron/tron.md) |
| Market system | [docs/markets/markets.md](docs/markets/markets.md) |
| Deployment & operations | [docs/operations/operations.md](docs/operations/operations.md) |
| Documentation standards | [docs/documentation.md](docs/documentation.md) |

## Tech Stack

**Backend:**
- Node.js + TypeScript
- Express + Socket.IO
- MongoDB (Mongoose)
- Redis + BullMQ
- Pino (logging)

**Frontend:**
- Next.js 14 (App Router)
- React + TypeScript
- Redux Toolkit
- Socket.IO client
- TailwindCSS

**Infrastructure:**
- Docker (MongoDB, Redis)
- TronGrid API (blockchain data)
- BullMQ (job queue)

## License

This project is licensed under the **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)** with a plugin exception.

- **TronRelic core:** AGPL-3.0 (you must share modifications if running as a network service)
- **Third-party plugins:** Your choice (plugin exception allows proprietary plugins)
- **Contributors:** Must sign CLA (see [CONTRIBUTING.md](CONTRIBUTING.md))

The CLA's relicensing clause lets the maintainers dual-license or offer commercial terms without renegotiating with every past contributor, keeping hosted and self-managed editions aligned.

See [LICENSE](LICENSE) for full details and plugin exception terms.
