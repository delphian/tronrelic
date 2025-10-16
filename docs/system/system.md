# System Architecture Overview

TronRelic's system layer manages the core data pipelines, scheduling, and blockchain synchronization that power all features. Understanding these components is essential for debugging production issues, optimizing performance, and implementing new features that depend on real-time data.

## Who This Document Is For

Backend developers implementing blockchain-aware features, operations engineers troubleshooting production issues, and plugin authors understanding how transaction data flows from the TRON network through TronRelic to observers and the frontend.

## Why This Matters

The system layer handles:

- **Blockchain synchronization** - Fetching thousands of TRON transactions per minute from the network
- **Scheduler management** - Coordinating market data refreshes, chain parameter updates, and alert dispatch
- **Observer notification** - Broadcasting enriched transactions to all subscribed plugins without blocking the sync pipeline
- **Real-time metrics** - Exposing lag, throughput, and error tracking to the `/system` monitoring dashboard

When the system layer fails:

- ❌ New transactions don't get indexed (whale alerts are silent)
- ❌ Market prices become stale (leaderboard shows outdated data)
- ❌ Plugin observers stop receiving events (custom analytics fail)
- ❌ Admin cannot see system health or control jobs

Understanding these components helps you diagnose sync stalls, optimize performance, and confidently deploy changes.

## Core System Components

### Blockchain Sync Architecture

The blockchain sync service retrieves blocks from TronGrid, enriches transactions with market data and energy costs, and notifies all subscribed observers asynchronously. The architecture prioritizes consistency and error isolation over throughput, using serial requests with 200ms throttling to avoid overwhelming the network.

**Key design decisions:**

- **Serial API requests** - One block at a time, preventing burst rate limiting and queue unpredictability
- **200ms per-block throttle** - Sustainable ~5 requests/second leaves headroom for TronGrid limits
- **Rotating API keys** - Distributes load across multiple TronGrid accounts
- **Queue overflow protection** - Caps pending blocks to prevent memory leaks
- **Async observer notification** - Observers process independently without blocking sync

**See [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) for complete details on:**
- Block retrieval strategy and rate limiting rationale
- Transaction enrichment pipeline (parsing, categorization, USD/energy calculations)
- Observer notification flow and async processing patterns
- Blockchain service lifecycle and monitoring metrics
- Performance characteristics and scalability analysis

### Scheduler Operations

The scheduler manages seven built-in jobs that keep the system healthy: market data refreshes, blockchain sync, cache cleanup, alert dispatch, and chain parameter updates. Each job runs on an independent schedule and can be controlled at runtime without requiring backend restarts.

**Critical jobs:**
- `blockchain:sync` - Fetches new TRON blocks every minute
- `markets:refresh` - Updates all energy market prices every 10 minutes
- `chain-parameters:fetch` - Fetches TRON energy costs every 10 minutes

**Safe to disable temporarily:**
- `cache:cleanup` - Only impacts memory usage
- `alerts:*` - Only impacts notifications, not data collection

**See [system-scheduler-operations.md](./system-scheduler-operations.md) for complete details on:**
- Global enable/disable via `ENABLE_SCHEDULER` environment variable
- Per-job configuration and runtime control without restarts
- Complete list of all seven scheduler jobs with schedules and impacts
- System Monitor dashboard UI for job control
- Admin API endpoints for programmatic control
- Cron expression syntax and common modifications
- Comprehensive troubleshooting runbooks for common failure scenarios
- Configuration persistence to MongoDB for durability across restarts

### System Monitoring API

The system monitoring API provides programmatic access to all operational metrics, job control, and infrastructure health checks. All endpoints require admin authentication and support both web dashboard and custom automation workflows.

**Available endpoint categories:**

- **System Overview** - Consolidated snapshot of all metrics in a single request
- **Blockchain Monitoring** - Sync status, transaction stats, processing metrics, manual sync trigger
- **Scheduler Operations** - Job status, health checks, runtime configuration updates
- **Market Monitoring** - Platform status, data freshness, manual refresh trigger
- **System Health** - Database, Redis, and server metrics
- **Configuration** - Environment settings and feature flags
- **WebSocket Monitoring** - Plugin subscription stats and connection tracking

**See [system-api.md](./system-api.md) for complete details on:**
- Authentication requirements and header formats
- All 16+ API endpoints with request/response examples
- Field-by-field documentation of response structures
- Practical usage examples with curl and JavaScript
- Common operations (health checks, job control, data refresh)
- Troubleshooting API issues
- Building custom monitoring scripts

### System Monitoring Dashboard

The web-based monitoring dashboard provides real-time visibility into all system operations through a tabbed interface. Built on top of the system monitoring API, it offers point-and-click job control, live metric displays, and manual operation triggers.

**See [system-monitoring-dashboard.md](./system-monitoring-dashboard.md) for complete details on:**
- Accessing the dashboard at `/system` with admin token authentication
- Overview tab with at-a-glance health indicators
- Blockchain, Scheduler, Markets, Health, and Config tabs
- Live auto-refresh behavior and manual refresh controls
- Job enable/disable toggles and schedule modification
- Manual sync and refresh trigger buttons
- Visual status indicators and error displays

## Quick Reference

### Monitoring System Health

Access the system monitoring dashboard at `/system` (requires `ADMIN_API_TOKEN`):

1. **Blockchain Status** - Current block, network block, lag, processing rate
2. **Scheduled Jobs** - Enabled/disabled state, last run status, duration
3. **API Queue** - Pending requests, error rates, rate limit warnings

### Common Operations

**Check scheduler status:**
```bash
curl -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  http://localhost:4000/api/admin/system/scheduler/status
```

**Enable a job:**
```bash
curl -X PATCH \
  -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}' \
  http://localhost:4000/api/admin/system/scheduler/job/blockchain:sync
```

**Modify job schedule (every 10 minutes instead of 5):**
```bash
curl -X PATCH \
  -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"schedule": "*/10 * * * *"}' \
  http://localhost:4000/api/admin/system/scheduler/job/markets:refresh
```

### Troubleshooting Checklist

| Symptom | First Check | Documentation |
|---------|------------|-----------------|
| Blockchain data stale | Is `blockchain:sync` job enabled? | [system-scheduler-operations.md](./system-scheduler-operations.md#troubleshooting) |
| Market prices outdated | Is `markets:refresh` job enabled? | [system-scheduler-operations.md](./system-scheduler-operations.md#troubleshooting) |
| High API queue depth | Check TronGrid API key errors | [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md#block-overflow-protection) |
| Scheduler not running | Is `ENABLE_SCHEDULER=true`? | [system-scheduler-operations.md](./system-scheduler-operations.md#troubleshooting) |
| Jobs run too frequently | Modify schedule in `/system` | [system-scheduler-operations.md](./system-scheduler-operations.md#cron-expression-syntax) |

## Further Reading

**Detailed documentation:**
- [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) - Complete technical overview of block retrieval, transaction enrichment, observer notification, and performance characteristics
- [system-scheduler-operations.md](./system-scheduler-operations.md) - Scheduler control, job management, troubleshooting, and configuration persistence
- [system-api.md](./system-api.md) - Complete API reference with all endpoints, authentication, request/response formats, and usage examples
- [system-monitoring-dashboard.md](./system-monitoring-dashboard.md) - Web dashboard UI guide with tab-by-tab feature documentation

**Related topics:**
- [plugins/plugins-blockchain-observers.md](../plugins/plugins-blockchain-observers.md) - How to build observers that react to transactions
- [markets/market-system-architecture.md](../markets/market-system-architecture.md) - How market data is fetched and normalized
- [tron/tron-chain-parameters.md](../tron/tron-chain-parameters.md) - How chain parameters are fetched and cached
- [environment.md](../environment.md) - `ENABLE_SCHEDULER` and `TRONGRID_API_KEY` configuration
