# System

`SystemMonitorService` probes MongoDB, Redis, the Node process, the host droplet, and blockchain sync state for the admin monitoring endpoints and dashboard. `DockerStatsService` adds per-container metrics through a read-only Docker socket proxy.

## Source map

| File | Responsibility |
|---|---|
| `system-monitor.service.ts` | Mongo/Redis/ClickHouse probes, process metrics, host metrics, blockchain snapshots |
| `docker-stats.service.ts` | Docker Engine API client — per-container CPU, memory, health, restarts |
| `system-monitor.controller.ts` | HTTP handlers; routes mounted by `api/routes/system.router.ts` |
| `pipeline-health.ts` | Pure rules behind `GET /blockchain/pipeline`: the ingest-lag, feed-lag, and receipt-coverage tones, and `resolvePipelineHealth()`, which returns `healthy`, `degraded`, or `stalled` with plain-English reasons. Thresholds derive from the deployment's buffer target and backfill entry lag |

## Pipeline status

`SystemMonitorService.getPipelineStatus()` builds the `/system` Pipeline tab's payload (`IPipelineStatus`) from the blockchain module's `PipelineTelemetry`, the running emitter and committer, the `blockchain:sync` job's own scheduler state, the TronGrid receipts switch, and the sync state document. **It never calls TronGrid.** `getBlockchainSyncStatus()` asks TronGrid for the chain head on every request through the queue block sync shares, so a console polling it competed with sync and slowed down most when TronGrid was struggling. Lags here are measured from each block's own header timestamp instead, the same way sync classifies a block as live work. Payload reference: [system-api-blockchain.md](../../../../docs/system/system-api-blockchain.md#get-blockchainpipeline--pipeline-payload).

## Container metrics contract

`DOCKER_API_URL` unset disables container metrics; the probe returns `available: false` with a reason and every other reading is unaffected.

### Collection runs on a timer, not on the request

`getStatus()` returns the last snapshot immediately. It does not sweep the daemon while a request waits. A sweep costs roughly two seconds, because Docker samples CPU twice to produce a delta and every container is measured, and `/health/infrastructure` is polled continuously by the console's Server section.

The service previously kept a five-second freshness window against a ten-second poll. The window expired before every poll, so it never once served a request and each poll blocked for the full sweep. That is the fault this arrangement removes, and it is why the timing constants relate the way they do.

| Constant | Value | Role |
|---|---|---|
| `REFRESH_INTERVAL_MS` | 10s | How often the background timer collects. One sweep per interval regardless of how many admin tabs are open. |
| `IDLE_TIMEOUT_MS` | 60s | How long without a request before collection stops, so an unwatched deployment stops querying the daemon. |
| `MAX_SNAPSHOT_AGE_MS` | 20s | Backstop for when the timer was not running. **Must stay longer than the refresh interval** — setting it below restores the original fault. |

The first caller after an idle period waits for a collection, because there is no usable snapshot and an empty Server section is worse than a slow one. The timer is unreferenced, so it cannot by itself hold the process open, and `stop()` halts it for a shutdown path or a test.

**Two rules govern `docker-stats.service.ts`:**

The backend must never hold the Docker socket. Unrestricted Docker API access is equivalent to root on the host, and this process terminates public traffic and runs plugin code. Production reaches an allowlisting proxy (`CONTAINERS=1`, `POST` disabled) over an `internal` compose network joined only by the proxy and the backend.

The field whitelist in `toContainerMetrics` is a security control, not a convenience. Docker's inspect endpoint returns each container's full environment — which is where `MONGO_ROOT_PASSWORD`, `REDIS_PASSWORD` and `CLICKHOUSE_PASSWORD` live — and the proxy cannot strip it. Never widen that whitelist and never serialize a raw Docker response onto an HTTP response. `docker-stats.service.test.ts` asserts this by planting a secret in a stub inspect payload and failing if it appears in the output.

## Canonical documentation

- [system-api.md](../../../../docs/system/system-api.md) — admin API gateway: auth, conventions, links to per-domain detail docs
- [system-api-overview.md](../../../../docs/system/system-api-overview.md) — health probe payloads, including `/health/infrastructure`
- [system-dashboard.md](../../../../docs/system/system-dashboard.md) — `/system/system` dashboard page that renders these probes
- [environment.md](../../../../docs/environment.md) — `DOCKER_API_URL` deployment and security notes
