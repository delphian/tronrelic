# TronRelic

Real-time TRON blockchain monitoring and whale activity tracking.

# Project Rules

**Always load and apply the following documentation before answering or changing code:**

- [@AGENTS.md](AGENTS.md)
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
- [@operations.md](docs/operations/operations.md)
- [@operations-server-info.md](docs/operations/operations-server-info.md)
- [@operations-workflows.md](docs/operations/operations-workflows.md)
- [@operations-remote-access.md](docs/operations/operations-remote-access.md)

## Quick Start

### Option 1: Docker (Recommended for Production)

```bash
# Development mode
npm run docker:up

# Production mode
npm run docker:up:prod
```

Services will be available at:
- **Backend**: http://localhost:4000
- **Frontend**: http://localhost:3000
- **System Monitor**: http://localhost:3000/system (requires admin token)

**Docker commands:**
```bash
npm run docker:build          # Build Docker images (dev)
npm run docker:build:prod     # Build Docker images (production)
npm run docker:up             # Start containers (dev)
npm run docker:up:prod        # Start containers (production)
npm run docker:down           # Stop containers
npm run docker:logs           # View all logs
npm run docker:logs:backend   # View backend logs only
npm run docker:logs:frontend  # View frontend logs only
npm run docker:rebuild        # Clean rebuild (no cache)
npm run docker:clean          # Remove containers and volumes
```

See [docs/operations/operations.md](docs/operations/operations.md) for detailed operations guide.

### Option 2: Local Development

```bash
./scripts/start.sh
```

**Options:**
```bash
./scripts/start.sh                 # Smart incremental builds (only rebuilds changed files)
./scripts/start.sh --force-build   # Full rebuild (clears caches and rebuilds from scratch)
./scripts/start.sh --force-docker  # Recreate MongoDB/Redis containers
./scripts/start.sh --prod          # Run frontend in production mode (defaults to dev)
./scripts/start.sh --force         # Full reset (combines all of the above)
```

**Performance optimizations:**
- **Smart incremental builds** - Only rebuilds workspaces with changed source files
- **TypeScript incremental compilation** - Uses `.tsbuildinfo` cache for 5-10x faster rebuilds
- **Lazy dependency loading** - Skips `npm install` when dependencies haven't changed
- **Parallel builds** - Backend and frontend compile simultaneously when both need rebuilding
- **Next.js Turbopack** - Dev mode uses `--turbo` for faster hot reloads

**Stop services:**
```bash
./scripts/stop.sh
```

## Prerequisites

- **Node.js** 20+
- **Docker** (for MongoDB and Redis containers)
- **TronGrid API Keys** (3 recommended for rate limit distribution)

## Configuration

### Security Checklist

Before running the application, generate secure secrets:

```bash
# Generate ADMIN_API_TOKEN (required for system monitoring)
openssl rand -hex 32

# Generate TELEGRAM_WEBHOOK_SECRET (if using Telegram integration)
openssl rand -hex 32

# For production Docker deployments, also generate:
openssl rand -hex 32  # MONGO_ROOT_PASSWORD
openssl rand -hex 32  # REDIS_PASSWORD
```

**IMPORTANT:** Never commit `.env` files to version control. The `.gitignore` is configured to exclude them, but always verify before pushing.

### Unified Environment Configuration

**TronRelic uses a single `.env` file in the project root for both Docker and local development.**

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Example configuration:

```bash
# Required - Generate with: openssl rand -hex 32
ADMIN_API_TOKEN=<paste-generated-token-here>

# Required - Get from https://www.trongrid.io/
TRONGRID_API_KEY=<your-key-1>
TRONGRID_API_KEY_2=<your-key-2>
TRONGRID_API_KEY_3=<your-key-3>

# Backend Configuration (works for both Docker and local)
NODE_ENV=development
PORT=4000
ENABLE_SCHEDULER=true
ENABLE_WEBSOCKETS=true
MONGODB_URI=mongodb://127.0.0.1:27017/tronrelic
REDIS_URL=redis://127.0.0.1:6379
REDIS_NAMESPACE=tronrelic

# Frontend Configuration
NEXT_PUBLIC_API_URL=http://localhost:4000/api
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Production only - Database security (leave blank for development)
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=<paste-generated-token-here>
REDIS_PASSWORD=<paste-generated-token-here>
```

**How it works:**
- **Local development** (`./scripts/start.sh`): Uses `.env` directly
- **Docker Compose**: Uses `.env` with service-specific overrides in `docker-compose.yml`
- Database URIs use `localhost` for local, Docker Compose overrides with service names (`mongodb`, `redis`)

### Admin Authentication

The system monitor endpoint (`/system`) requires authentication. Send the `ADMIN_API_TOKEN` using either:

- **Recommended:** `x-admin-token` header
- **Alternative:** `Authorization: Bearer <token>` header

**Note:** Query parameter authentication (`?token=...`) is intentionally not supported for security reasons.

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

### Plugin Architecture
- **Subscription-based plugins** - Features subscribe to blockchain events, schedules, and HTTP routes (see [docs/plugins/plugins.md](docs/plugins/plugins.md))
- **Colocated backend + frontend** - Single directory per feature with full-stack code
- **Observer pattern** for blockchain transaction processing (see [docs/plugins/plugins-blockchain-observers.md](docs/plugins/plugins-blockchain-observers.md))

### Blockchain Sync
- **Serial API requests** with 200ms rate limiting across 3 rotating API keys
- **Queue overflow protection** (max 100 pending requests)
- **Singleton TronGrid client** prevents duplicate instances and memory waste
- **BullMQ job processing** with 2-minute lock duration for transaction-heavy blocks
- **Fresh install optimization** - starts from current block instead of block 0

### Real-Time Updates
- **Socket.IO** for live whale transactions and market updates
- **WebSocket bridge** connects Redux store to server events
- **System monitoring** dashboard with live blockchain sync status

### Rate Limiting Strategy
- **1 API call per block** (uses embedded transaction data from `getBlockByNumber`)
- **No transaction info fetching** for individual transactions (eliminates 1,800x API overhead)
- **Global request queue** enforces serial execution across all services
- **~5 requests/second** sustained rate with burst protection

## Development

### Manual Service Control

```bash
# Backend only
npm run dev --workspace apps/backend

# Frontend only
npm run dev --workspace apps/frontend

# Build individual workspaces
npm run build --workspace apps/backend     # Incremental build with cache
npm run build --workspace apps/frontend
npm run build --workspace packages/shared

# Build all workspaces (parallel)
npm run build:parallel                     # Backend + frontend in parallel

# Type checking (skipped during dev builds for speed)
npm run typecheck --workspaces

# Linting (skipped during dev builds for speed)
npm run lint --workspaces
```

### Build Performance

**Typical build times:**
- **First build:** 3-5 minutes (cold start, no cache)
- **Incremental rebuild (1 file changed):** 10-30 seconds
- **No changes:** Instant (skips build entirely)
- **Force rebuild:** 3-5 minutes (clears all caches)

**Build optimization features:**
- TypeScript incremental compilation preserves `.tsbuildinfo` cache
- Smart file change detection using `find -newer`
- Parallel workspace builds when multiple need rebuilding
- Next.js skips type checking and linting during dev (run separately)

### Logs

Logs are stored in `.run/` directory (cleared on each start):
- `.run/backend.log`
- `.run/frontend.log`

Tail logs while services run:
```bash
tail -f .run/backend.log
tail -f .run/frontend.log
```

### Database Access

MongoDB and Redis run in Docker containers:

```bash
# MongoDB shell
docker exec -it tronrelic-mongo mongosh tronrelic

# Redis CLI
docker exec -it tronrelic-redis redis-cli

# View queue status
docker exec tronrelic-redis redis-cli LLEN "tronrelic:block-sync:wait"
```

## System Monitoring

Access the admin dashboard at http://localhost:3000/system with your `ADMIN_TOKEN`.

**Metrics available:**
- Blockchain sync status and lag
- Transaction indexing statistics
- Block processing performance
- API queue depth and errors
- Scheduler job status

## Troubleshooting

### Port Already in Use
```bash
./scripts/stop.sh  # Kills processes on ports 3000 and 4000
```

### Slow Builds
```bash
# Use incremental builds (default behavior)
./scripts/start.sh  # Only rebuilds changed files

# Force clean rebuild if incremental build is broken
./scripts/start.sh --force-build
```

### Stale Next.js Cache
```bash
rm -rf apps/frontend/.next
./scripts/start.sh --force-build
```

### TypeScript Incremental Cache Corruption
```bash
rm -f apps/backend/.tsbuildinfo packages/shared/tsconfig.tsbuildinfo
./scripts/start.sh --force-build
```

### Fresh Database
```bash
./scripts/start.sh --force-docker  # Deletes MongoDB/Redis volumes
```

### Rate Limit Errors (429)
- Check that all 3 `TRONGRID_API_KEY` variables are set in `.env`
- Verify queue isn't overflowing: `docker exec tronrelic-redis redis-cli LLEN "tronrelic:block-sync:wait"`
- Review `.run/backend.log` for queue overflow errors

### Block Processing Stalled
- Check BullMQ failed jobs: `docker exec tronrelic-redis redis-cli ZCARD "tronrelic:block-sync:failed"`
- Clear stalled jobs: `docker exec tronrelic-redis redis-cli DEL $(docker exec tronrelic-redis redis-cli keys "tronrelic:block-sync:block-*")`
- Restart: `./scripts/stop.sh && ./scripts/start.sh`

## Testing

```bash
# Run Playwright tests
npm run test:system --workspace apps/backend

# Specific test
npx playwright test tests/system.spec.ts
```

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

MIT
