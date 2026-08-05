/**
 * Docker Engine API client exposing per-container runtime metrics.
 *
 * Why this exists: the admin console's Server section could only report the two
 * subsystems the backend observes from inside its own process — its Node heap
 * and its Redis connection. Every sibling container (Mongo, ClickHouse, the
 * frontend) was invisible, so when the droplet ran hot an operator had no way
 * to tell which container was responsible, and a container stuck in a restart
 * loop showed up only as unexplained downstream errors.
 *
 * How it works: the backend never touches the Docker socket. It speaks the
 * Docker Engine HTTP API to a read-only socket proxy that sits on an isolated
 * compose network and allows GET on /containers only. Handing the raw socket
 * to this container would be equivalent to handing it root on the droplet,
 * which is unacceptable for the process that terminates public traffic and runs
 * plugin code. When DOCKER_API_URL is unset — local development, or any deploy
 * without the proxy — every probe reports unavailable rather than failing.
 *
 * SECURITY: the inspect endpoint (/containers/{id}/json) returns the target
 * container's complete environment, and the proxy has no way to strip it. Only
 * the fields named in `toContainerMetrics` may ever leave this module. Never
 * serialize a raw inspect or list response onto an HTTP response — doing so
 * would publish Mongo, Redis and ClickHouse credentials to the admin browser.
 *
 * @module modules/system/docker-stats.service
 */

import * as http from 'http';
import * as os from 'os';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';

/** Milliseconds a single Docker API call may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * Milliseconds a collected snapshot stays fresh.
 *
 * A stats read costs roughly a second because Docker samples CPU twice to
 * produce a delta, and the console polls every ten seconds from every open
 * admin tab. Caching just below the poll interval keeps concurrent tabs from
 * multiplying that cost onto the daemon.
 */
const CACHE_TTL_MS = 5000;

/**
 * Runtime metrics for one container, restricted to non-sensitive fields.
 *
 * Deliberately a whitelist rather than a projection of the Docker payload:
 * inspect responses carry the container's environment, so an interface that
 * mirrored the API shape would leak credentials the first time someone
 * serialized it.
 */
export interface ContainerMetrics {
    /** Short container id, for correlating with `docker` CLI output. */
    id: string;
    /** Container name with Docker's leading slash removed. */
    name: string;
    /** Compose service name, absent when the container was not started by compose. */
    service: string | null;
    /** Image reference the container was created from. */
    image: string;
    /** Lifecycle state: `running`, `exited`, `restarting`, and so on. */
    state: string;
    /** Healthcheck verdict, or null when the image declares no healthcheck. */
    health: string | null;
    /** Seconds since the container last started; null when it is not running. */
    uptime: number | null;
    /** Times Docker has restarted the container — non-zero signals a crash loop. */
    restartCount: number;
    /** Percent of total host CPU capacity, matching `docker stats`; null when unavailable. */
    cpuPercent: number | null;
    /** Resident bytes excluding reclaimable page cache, matching `docker stats`. */
    memoryUsage: number | null;
    /** Byte ceiling for the container; equals host memory when no limit is set. */
    memoryLimit: number | null;
    /** `memoryUsage` as a percent of `memoryLimit`; null when either is unknown. */
    memoryPercent: number | null;
    /** True for the container running this backend, so the UI can mark it. */
    isSelf: boolean;
}

/**
 * Outcome of a collection sweep.
 *
 * Carries its own failure state instead of throwing so a Docker outage
 * degrades the console's container block alone, leaving the host and process
 * readings that arrive alongside it intact.
 */
export interface DockerStatus {
    /** Whether the sweep produced usable data. */
    available: boolean;
    /** Operator-facing reason the sweep failed; null on success. */
    error: string | null;
    /** Metrics per container, ordered by compose service name. */
    containers: ContainerMetrics[];
}

/** Where the Docker API lives, normalized from the configured URL. */
interface IDockerEndpoint {
    /** Filesystem path when addressing the daemon over a Unix socket. */
    socketPath?: string;
    /** Hostname when addressing the daemon (or a proxy) over TCP. */
    host?: string;
    /** Port when addressing the daemon over TCP. */
    port?: number;
}

/** Container summary fields this module consumes from `GET /containers/json`. */
interface IDockerListEntry {
    Id: string;
    Names: string[];
    Image: string;
    State: string;
    Labels?: Record<string, string>;
}

/** Inspect fields this module consumes. Env is deliberately absent — see the module note. */
interface IDockerInspectEntry {
    Id: string;
    Name: string;
    RestartCount?: number;
    State?: {
        Status?: string;
        StartedAt?: string;
        Health?: { Status?: string };
    };
    Config?: {
        Image?: string;
        Labels?: Record<string, string>;
    };
}

/** CPU and memory counters this module consumes from `GET /containers/{id}/stats`. */
interface IDockerStatsEntry {
    cpu_stats?: {
        cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
        system_cpu_usage?: number;
        online_cpus?: number;
    };
    precpu_stats?: {
        cpu_usage?: { total_usage?: number };
        system_cpu_usage?: number;
    };
    memory_stats?: {
        usage?: number;
        limit?: number;
        stats?: Record<string, number>;
    };
}

/** A collected sweep plus the moment it was taken, backing the TTL cache. */
interface ICachedStatus {
    status: DockerStatus;
    collectedAt: number;
}

/**
 * Reads container metrics through an allowlisting Docker socket proxy.
 *
 * Instantiated per `SystemMonitorService` rather than as a singleton because it
 * holds no shared state beyond a short-lived cache, and constructor injection
 * of the endpoint keeps it testable without touching process environment.
 */
export class DockerStatsService {
    private readonly endpoint: IDockerEndpoint | null;
    private readonly configError: string | null;
    private cached: ICachedStatus | null = null;
    private inFlight: Promise<DockerStatus> | null = null;
    private composeProject: string | null = null;

    /**
     * Resolve the configured Docker API location once, at construction.
     *
     * Parsing here rather than per request means a malformed URL surfaces as a
     * stable, explanatory status on every poll instead of an exception thrown
     * from deep inside a request handler.
     *
     * @param apiUrl - Docker API location; omitted, the service reports unavailable.
     */
    constructor(apiUrl: string | undefined = env.DOCKER_API_URL) {
        let endpoint: IDockerEndpoint | null = null;
        let configError: string | null = null;

        if (!apiUrl) {
            configError = 'DOCKER_API_URL is not configured';
        } else {
            try {
                endpoint = parseDockerUrl(apiUrl);
            } catch (error) {
                configError = error instanceof Error ? error.message : 'Invalid DOCKER_API_URL';
                logger.warn({ error, apiUrl }, 'Unable to parse DOCKER_API_URL; container metrics disabled');
            }
        }

        this.endpoint = endpoint;
        this.configError = configError;
    }

    /**
     * Collect metrics for every container in this deployment.
     *
     * Serves a cached sweep when one is fresh and collapses concurrent callers
     * onto a single in-flight collection, so several admin tabs polling at once
     * cost the daemon one sweep rather than one each.
     *
     * @returns Container metrics, or an unavailable status explaining why not.
     */
    async getStatus(): Promise<DockerStatus> {
        let result: Promise<DockerStatus>;

        if (!this.endpoint) {
            result = Promise.resolve({
                available: false,
                error: this.configError ?? 'Docker API unavailable',
                containers: []
            });
        } else if (this.cached && Date.now() - this.cached.collectedAt < CACHE_TTL_MS) {
            result = Promise.resolve(this.cached.status);
        } else if (this.inFlight) {
            result = this.inFlight;
        } else {
            this.inFlight = this.collect()
                .then(status => {
                    this.cached = { status, collectedAt: Date.now() };
                    return status;
                })
                .finally(() => {
                    this.inFlight = null;
                });
            result = this.inFlight;
        }

        return result;
    }

    /**
     * Perform one uncached sweep: list containers, then inspect and measure each.
     *
     * Failures are converted into an unavailable status rather than rethrown
     * because the caller composes this with host metrics that remain valid when
     * Docker is unreachable.
     *
     * @returns The sweep outcome, successful or explained.
     */
    private async collect(): Promise<DockerStatus> {
        let status: DockerStatus;

        try {
            const selfId = os.hostname();
            const project = await this.resolveComposeProject(selfId);
            const query = project
                ? `?all=true&filters=${encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${project}`] }))}`
                : '?all=true';

            const entries = await this.request<IDockerListEntry[]>(`/containers/json${query}`);
            const containers = await Promise.all(
                entries.map(entry => this.describeContainer(entry, selfId))
            );

            containers.sort((a, b) => (a.service ?? a.name).localeCompare(b.service ?? b.name));
            status = { available: true, error: null, containers };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Docker API request failed';
            logger.warn({ error }, 'Failed to collect Docker container metrics');
            status = { available: false, error: message, containers: [] };
        }

        return status;
    }

    /**
     * Determine which compose project this deployment belongs to.
     *
     * Inspecting our own container and reading its compose label avoids making
     * the project name a configuration value that would silently drift from the
     * deploy directory. Cached because it cannot change while the process runs.
     *
     * @param selfId - This container's id, taken from the hostname.
     * @returns The compose project name, or null to fall back to listing everything.
     */
    private async resolveComposeProject(selfId: string): Promise<string | null> {
        if (this.composeProject === null) {
            try {
                const self = await this.request<IDockerInspectEntry>(`/containers/${selfId}/json`);
                this.composeProject = self.Config?.Labels?.['com.docker.compose.project'] ?? '';
            } catch (error) {
                logger.debug({ error }, 'Could not resolve compose project; listing all containers');
                this.composeProject = '';
            }
        }

        return this.composeProject === '' ? null : this.composeProject;
    }

    /**
     * Build the whitelisted metric record for one container.
     *
     * Inspect and stats are fetched together because neither alone answers the
     * operator's question: inspect explains whether a container is healthy and
     * how often it has restarted, stats explain what it is currently consuming.
     * Either may fail independently without discarding the other's data.
     *
     * @param entry - Summary from the container list.
     * @param selfId - This container's id, used to flag the backend's own row.
     * @returns Metrics safe to serialize to the admin client.
     */
    private async describeContainer(entry: IDockerListEntry, selfId: string): Promise<ContainerMetrics> {
        const [inspect, stats] = await Promise.all([
            this.request<IDockerInspectEntry>(`/containers/${entry.Id}/json`).catch(() => null),
            entry.State === 'running'
                ? this.request<IDockerStatsEntry>(`/containers/${entry.Id}/stats?stream=false`).catch(() => null)
                : Promise.resolve(null)
        ]);

        return toContainerMetrics(entry, inspect, stats, selfId);
    }

    /**
     * Issue one Docker API request and decode its JSON body.
     *
     * Uses `node:http` rather than `fetch` so a Unix socket path and a TCP host
     * are served by the same code path — undici needs a custom dispatcher for
     * socket transport, which would fork this method in two for no benefit.
     *
     * @param path - API path including any query string.
     * @returns The decoded response body.
     */
    private request<T>(path: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const request = http.request(
                {
                    ...this.endpoint,
                    path,
                    method: 'GET',
                    timeout: REQUEST_TIMEOUT_MS,
                    headers: { Host: 'docker', Accept: 'application/json' }
                },
                response => {
                    const chunks: Buffer[] = [];
                    response.on('data', chunk => chunks.push(chunk));
                    response.on('end', () => {
                        const body = Buffer.concat(chunks).toString('utf8');
                        const statusCode = response.statusCode ?? 0;

                        if (statusCode < 200 || statusCode >= 300) {
                            reject(new Error(`Docker API ${path} responded ${statusCode}`));
                            return;
                        }

                        try {
                            resolve(JSON.parse(body) as T);
                        } catch {
                            reject(new Error(`Docker API ${path} returned malformed JSON`));
                        }
                    });
                }
            );

            request.on('timeout', () => {
                request.destroy(new Error(`Docker API ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`));
            });
            request.on('error', reject);
            request.end();
        });
    }
}

/**
 * Normalize a configured Docker API URL into connection options.
 *
 * Accepting both `unix://` and `http://` lets the same code serve production —
 * where a proxy is reached over TCP — and a developer pointing straight at the
 * local socket, without a second configuration switch.
 *
 * @param apiUrl - Raw value from configuration.
 * @returns Connection options for `http.request`.
 */
function parseDockerUrl(apiUrl: string): IDockerEndpoint {
    let endpoint: IDockerEndpoint;

    if (apiUrl.startsWith('unix://')) {
        endpoint = { socketPath: apiUrl.slice('unix://'.length) };
    } else {
        const parsed = new URL(apiUrl.replace(/^tcp:\/\//, 'http://'));
        if (parsed.protocol !== 'http:') {
            throw new Error(`DOCKER_API_URL must use unix://, tcp:// or http:// (received ${parsed.protocol})`);
        }
        endpoint = { host: parsed.hostname, port: Number(parsed.port) || 2375 };
    }

    return endpoint;
}

/**
 * Assemble one container's whitelisted metrics from the three Docker payloads.
 *
 * Kept as a free function so the field whitelist — the control that stops
 * container environments reaching the browser — is a single reviewable unit
 * rather than logic spread across the service.
 *
 * @param entry - Container list summary.
 * @param inspect - Inspect payload, or null when that call failed.
 * @param stats - Stats payload, or null when the container is stopped or the call failed.
 * @param selfId - Id of the container running this process.
 * @returns The metric record for this container.
 */
function toContainerMetrics(
    entry: IDockerListEntry,
    inspect: IDockerInspectEntry | null,
    stats: IDockerStatsEntry | null,
    selfId: string
): ContainerMetrics {
    const startedAt = inspect?.State?.StartedAt;
    const startedMs = startedAt ? Date.parse(startedAt) : NaN;
    const memoryUsage = readMemoryUsage(stats);
    const memoryLimit = stats?.memory_stats?.limit ?? null;

    return {
        id: entry.Id.slice(0, 12),
        name: entry.Names[0]?.replace(/^\//, '') ?? entry.Id.slice(0, 12),
        service: entry.Labels?.['com.docker.compose.service'] ?? null,
        image: entry.Image,
        state: entry.State,
        health: inspect?.State?.Health?.Status ?? null,
        uptime:
            entry.State === 'running' && !Number.isNaN(startedMs)
                ? Math.max(0, Math.floor((Date.now() - startedMs) / 1000))
                : null,
        restartCount: inspect?.RestartCount ?? 0,
        cpuPercent: readCpuPercent(stats),
        memoryUsage,
        memoryLimit,
        memoryPercent:
            memoryUsage !== null && memoryLimit ? (memoryUsage / memoryLimit) * 100 : null,
        isSelf: entry.Id.startsWith(selfId) || selfId.startsWith(entry.Id.slice(0, 12))
    };
}

/**
 * Derive CPU percent the way `docker stats` does.
 *
 * Docker reports cumulative nanosecond counters, so a percentage only exists
 * relative to the previous sample the daemon took; `stream=false` supplies that
 * prior sample as `precpu_stats`. Scaling by the online CPU count means the
 * figure shares a denominator with the host CPU reading beside it in the UI,
 * and can legitimately exceed 100 on a multi-core host.
 *
 * @param stats - Stats payload, or null when unavailable.
 * @returns Percent of total host CPU capacity, or null when it cannot be derived.
 */
function readCpuPercent(stats: IDockerStatsEntry | null): number | null {
    let percent: number | null = null;

    const total = stats?.cpu_stats?.cpu_usage?.total_usage;
    const preTotal = stats?.precpu_stats?.cpu_usage?.total_usage;
    const system = stats?.cpu_stats?.system_cpu_usage;
    const preSystem = stats?.precpu_stats?.system_cpu_usage;

    if (total !== undefined && preTotal !== undefined && system !== undefined && preSystem !== undefined) {
        const cpuDelta = total - preTotal;
        const systemDelta = system - preSystem;
        const onlineCpus =
            stats?.cpu_stats?.online_cpus ?? stats?.cpu_stats?.cpu_usage?.percpu_usage?.length ?? 1;

        if (cpuDelta >= 0 && systemDelta > 0) {
            percent = (cpuDelta / systemDelta) * onlineCpus * 100;
        }
    }

    return percent;
}

/**
 * Derive the memory figure `docker stats` shows.
 *
 * Raw `memory_stats.usage` counts reclaimable page cache, which makes an idle
 * container look near its limit and turns the UI's memory column into noise.
 * Subtracting inactive file cache matches the CLI and reflects what the
 * container would actually keep under pressure.
 *
 * @param stats - Stats payload, or null when unavailable.
 * @returns Bytes in use, or null when unavailable.
 */
function readMemoryUsage(stats: IDockerStatsEntry | null): number | null {
    let usage: number | null = null;
    const raw = stats?.memory_stats?.usage;

    if (raw !== undefined) {
        const inactiveFile =
            stats?.memory_stats?.stats?.inactive_file ??
            stats?.memory_stats?.stats?.total_inactive_file ??
            0;
        usage = Math.max(0, raw - inactiveFile);
    }

    return usage;
}
