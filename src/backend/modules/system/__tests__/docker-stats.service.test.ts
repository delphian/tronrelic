/**
 * @file docker-stats.service.test.ts
 *
 * Tests for the Docker Engine API client behind the /system console's
 * container metrics.
 *
 * Two properties matter more than the arithmetic here. First, the service must
 * never surface a container's environment: the inspect endpoint returns it in
 * full, the socket proxy cannot strip it, and every database credential in the
 * deployment lives there — so a regression that widened the field whitelist
 * would publish those to the admin browser. Second, every failure mode must
 * degrade to an explained `available: false` rather than throw, because the
 * caller composes this with host metrics that stay valid when Docker does not.
 *
 * Exercises the real `http.request` path against a stub Docker daemon rather
 * than mocking `node:http`, so the URL parsing, timeout wiring and status-code
 * handling are covered as shipped.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';
import * as os from 'os';
import { DockerStatsService } from '../docker-stats.service.js';

/** Secret planted in the stub's inspect payload; must never reach a caller. */
const PLANTED_SECRET = 'MONGO_ROOT_PASSWORD=hunter2-should-never-surface';

/** Requests the stub has served, for asserting call shape and caching. */
let requestLog: string[] = [];

/** Per-test overrides letting a case fail or reshape one endpoint. */
let listStatus = 200;
let inspectStatus = 200;
let includeSelfLabels = true;

let server: http.Server;
let baseUrl: string;

/**
 * Build the container list the stub serves.
 *
 * Includes a stopped container alongside a running one so tests can assert the
 * service skips the stats call for containers that cannot report any.
 *
 * @returns Two container summaries in Docker's list shape.
 */
function listPayload(): unknown[] {
    return [
        {
            Id: 'aaaaaaaaaaaa1111',
            Names: ['/tronrelic-backend'],
            Image: 'ghcr.io/delphian/tronrelic-backend:production',
            State: 'running',
            Labels: { 'com.docker.compose.service': 'backend' }
        },
        {
            Id: 'bbbbbbbbbbbb2222',
            Names: ['/tronrelic-clickhouse'],
            Image: 'clickhouse/clickhouse-server:24.3',
            State: 'exited',
            Labels: { 'com.docker.compose.service': 'clickhouse' }
        }
    ];
}

/**
 * Build an inspect payload, always carrying environment material.
 *
 * The planted secret is the point: it proves the whitelist drops `Config.Env`
 * rather than proving the stub is realistic.
 *
 * @param id - Container id being inspected.
 * @returns Docker's inspect shape for that container.
 */
function inspectPayload(id: string): unknown {
    return {
        Id: id,
        Name: `/${id}`,
        RestartCount: id.startsWith('aaaa') ? 3 : 0,
        State: {
            Status: id.startsWith('aaaa') ? 'running' : 'exited',
            StartedAt: new Date(Date.now() - 3600_000).toISOString(),
            Health: id.startsWith('aaaa') ? { Status: 'healthy' } : undefined
        },
        Config: {
            Image: 'irrelevant',
            Env: ['PATH=/usr/bin', PLANTED_SECRET],
            Labels: includeSelfLabels ? { 'com.docker.compose.project': 'tronrelic' } : {}
        }
    };
}

/**
 * Build a stats payload whose CPU deltas produce a known percentage.
 *
 * The deltas are chosen so the expected result is exact: a 25% CPU delta
 * against the system delta, scaled by 4 online CPUs, is 100%.
 *
 * @returns Docker's single-read stats shape.
 */
function statsPayload(): unknown {
    return {
        cpu_stats: {
            cpu_usage: { total_usage: 2_500_000_000 },
            system_cpu_usage: 40_000_000_000,
            online_cpus: 4
        },
        precpu_stats: {
            cpu_usage: { total_usage: 2_000_000_000 },
            system_cpu_usage: 38_000_000_000
        },
        memory_stats: {
            usage: 600 * 1024 * 1024,
            limit: 2 * 1024 * 1024 * 1024,
            stats: { inactive_file: 100 * 1024 * 1024 }
        }
    };
}

beforeAll(async () => {
    server = http.createServer((req, res) => {
        const url = req.url ?? '';
        requestLog.push(url);

        const send = (status: number, body: unknown) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
        };

        if (url.startsWith('/containers/json')) {
            send(listStatus, listStatus === 200 ? listPayload() : { message: 'boom' });
        } else if (/^\/containers\/[^/]+\/stats/.test(url)) {
            send(200, statsPayload());
        } else if (/^\/containers\/[^/]+\/json/.test(url)) {
            const id = url.split('/')[2];
            send(inspectStatus, inspectStatus === 200 ? inspectPayload(id) : { message: 'boom' });
        } else {
            send(404, { message: 'not found' });
        }
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Stub Docker daemon failed to bind a port');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
    requestLog = [];
    listStatus = 200;
    inspectStatus = 200;
    includeSelfLabels = true;
});

describe('DockerStatsService configuration', () => {
    it('reports unavailable without contacting anything when no API URL is configured', async () => {
        const status = await new DockerStatsService(undefined).getStatus();

        expect(status.available).toBe(false);
        expect(status.error).toMatch(/DOCKER_API_URL is not configured/);
        expect(status.containers).toEqual([]);
        expect(requestLog).toHaveLength(0);
    });

    it('reports unavailable rather than throwing when the API URL is malformed', async () => {
        const status = await new DockerStatsService('ftp://docker').getStatus();

        expect(status.available).toBe(false);
        expect(status.error).toBeTruthy();
        expect(requestLog).toHaveLength(0);
    });
});

describe('DockerStatsService collection', () => {
    it('derives CPU, memory and uptime for a running container', async () => {
        const status = await new DockerStatsService(baseUrl).getStatus();

        expect(status.available).toBe(true);
        expect(status.error).toBeNull();

        const backend = status.containers.find(c => c.service === 'backend');
        expect(backend).toBeDefined();
        // (2.5e9 - 2.0e9) / (40e9 - 38e9) * 4 cores * 100 = 100%
        expect(backend?.cpuPercent).toBeCloseTo(100, 6);
        // usage minus inactive_file, matching `docker stats`
        expect(backend?.memoryUsage).toBe(500 * 1024 * 1024);
        expect(backend?.memoryLimit).toBe(2 * 1024 * 1024 * 1024);
        expect(backend?.memoryPercent).toBeCloseTo(24.41, 1);
        expect(backend?.restartCount).toBe(3);
        expect(backend?.health).toBe('healthy');
        expect(backend?.uptime).toBeGreaterThanOrEqual(3599);
        expect(backend?.id).toHaveLength(12);
    });

    it('skips the stats call for a container that is not running', async () => {
        const status = await new DockerStatsService(baseUrl).getStatus();

        const clickhouse = status.containers.find(c => c.service === 'clickhouse');
        expect(clickhouse?.state).toBe('exited');
        expect(clickhouse?.cpuPercent).toBeNull();
        expect(clickhouse?.memoryUsage).toBeNull();
        expect(clickhouse?.uptime).toBeNull();
        expect(requestLog.some(url => url.includes('bbbbbbbbbbbb2222/stats'))).toBe(false);
    });

    it('scopes the list to the compose project discovered from its own container', async () => {
        await new DockerStatsService(baseUrl).getStatus();

        const listCall = requestLog.find(url => url.startsWith('/containers/json'));
        expect(listCall).toBeDefined();
        expect(decodeURIComponent(listCall!)).toContain('com.docker.compose.project=tronrelic');
        expect(requestLog[0]).toBe(`/containers/${os.hostname()}/json`);
    });

    it('lists every container when the compose project cannot be resolved', async () => {
        includeSelfLabels = false;
        await new DockerStatsService(baseUrl).getStatus();

        const listCall = requestLog.find(url => url.startsWith('/containers/json'));
        expect(listCall).toBe('/containers/json?all=true');
    });

    it('sorts containers by compose service name', async () => {
        const status = await new DockerStatsService(baseUrl).getStatus();

        expect(status.containers.map(c => c.service)).toEqual(['backend', 'clickhouse']);
    });
});

describe('DockerStatsService secret containment', () => {
    it('never exposes container environment variables in the returned payload', async () => {
        const status = await new DockerStatsService(baseUrl).getStatus();

        const serialized = JSON.stringify(status);
        expect(serialized).not.toContain(PLANTED_SECRET);
        expect(serialized).not.toContain('MONGO_ROOT_PASSWORD');
        expect(serialized).not.toContain('Env');
    });
});

describe('DockerStatsService degradation', () => {
    it('reports unavailable with the status code when the list call fails', async () => {
        listStatus = 500;
        const status = await new DockerStatsService(baseUrl).getStatus();

        expect(status.available).toBe(false);
        expect(status.error).toMatch(/500/);
        expect(status.containers).toEqual([]);
    });

    it('still reports a container when only its inspect call fails', async () => {
        const service = new DockerStatsService(baseUrl);
        // Let project discovery succeed, then fail the per-container inspects.
        await service.getStatus();
        inspectStatus = 500;

        // A fresh instance re-resolves the project against the failing endpoint,
        // so exercise the fallback path deliberately.
        const status = await new DockerStatsService(baseUrl).getStatus();

        expect(status.available).toBe(true);
        const backend = status.containers.find(c => c.service === 'backend');
        expect(backend).toBeDefined();
        expect(backend?.restartCount).toBe(0);
        expect(backend?.health).toBeNull();
        expect(backend?.uptime).toBeNull();
        // Stats are independent of inspect, so they still arrive.
        expect(backend?.cpuPercent).toBeCloseTo(100, 6);
    });
});

describe('DockerStatsService caching', () => {
    it('serves a repeat call from cache instead of re-querying the daemon', async () => {
        const service = new DockerStatsService(baseUrl);
        await service.getStatus();
        const callsAfterFirst = requestLog.length;

        const second = await service.getStatus();

        expect(requestLog).toHaveLength(callsAfterFirst);
        expect(second.available).toBe(true);
    });

    it('collapses concurrent callers onto a single collection', async () => {
        const service = new DockerStatsService(baseUrl);

        const [a, b, c] = await Promise.all([
            service.getStatus(),
            service.getStatus(),
            service.getStatus()
        ]);

        expect(a).toBe(b);
        expect(b).toBe(c);
        expect(requestLog.filter(url => url.startsWith('/containers/json'))).toHaveLength(1);
    });
});
