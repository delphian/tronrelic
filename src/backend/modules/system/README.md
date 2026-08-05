# System

`SystemMonitorService` probes MongoDB, Redis, the Node process, the host droplet, and blockchain sync state for the admin monitoring endpoints and dashboard. `DockerStatsService` adds per-container metrics through a read-only Docker socket proxy.

## Source map

| File | Responsibility |
|---|---|
| `system-monitor.service.ts` | Mongo/Redis/ClickHouse probes, process metrics, host metrics, blockchain snapshots |
| `docker-stats.service.ts` | Docker Engine API client — per-container CPU, memory, health, restarts |
| `system-monitor.controller.ts` | HTTP handlers; routes mounted by `api/routes/system.router.ts` |

## Container metrics contract

`DOCKER_API_URL` unset disables container metrics; the probe returns `available: false` with a reason and every other reading is unaffected.

**Two rules govern `docker-stats.service.ts`:**

The backend must never hold the Docker socket. Unrestricted Docker API access is equivalent to root on the host, and this process terminates public traffic and runs plugin code. Production reaches an allowlisting proxy (`CONTAINERS=1`, `POST` disabled) over an `internal` compose network joined only by the proxy and the backend.

The field whitelist in `toContainerMetrics` is a security control, not a convenience. Docker's inspect endpoint returns each container's full environment — which is where `MONGO_ROOT_PASSWORD`, `REDIS_PASSWORD` and `CLICKHOUSE_PASSWORD` live — and the proxy cannot strip it. Never widen that whitelist and never serialize a raw Docker response onto an HTTP response. `docker-stats.service.test.ts` asserts this by planting a secret in a stub inspect payload and failing if it appears in the output.

## Canonical documentation

- [system-api.md](../../../../docs/system/system-api.md) — admin API gateway: auth, conventions, links to per-domain detail docs
- [system-api-overview.md](../../../../docs/system/system-api-overview.md) — health probe payloads, including `/health/infrastructure`
- [system-dashboard.md](../../../../docs/system/system-dashboard.md) — `/system/system` dashboard page that renders these probes
- [environment.md](../../../../docs/environment.md) — `DOCKER_API_URL` deployment and security notes
