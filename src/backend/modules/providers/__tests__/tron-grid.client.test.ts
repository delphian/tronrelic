/**
 * @file tron-grid.client.test.ts
 *
 * Contract tests for the TronGrid connectivity probe's bounds.
 *
 * The probe backs a button an operator watches. Run serially at the configured
 * timeout, a full ten-key pool against a host that blackholes packets would hold
 * the request for twenty minutes — the browser gives up first and the operator
 * gets a spinner instead of the per-key diagnosis the endpoint exists to
 * provide. Concurrency and the timeout cap are what keep the answer inside a
 * human's patience, so both are pinned here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../lib/http-client.js', () => ({
    httpClient: { post: vi.fn() }
}));

import { httpClient } from '../../../lib/http-client.js';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { ProviderConfigService } from '../services/provider-config.service.js';
import { TronGridProviderClient } from '../clients/tron-grid.client.js';

/**
 * Minimal ISystemLogService stand-in; the probe only ever warns on failure.
 *
 * @returns A logger whose methods do nothing.
 */
function createSilentLogger() {
    const noop = () => undefined;
    return { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: () => createSilentLogger() } as never;
}

/** A `/wallet/getnowblock` reply shaped the way the probe reads it. */
const NOW_BLOCK_REPLY = { data: { block_header: { raw_data: { number: 70_000_000 } } } };

describe('TronGridProviderClient.testConnection', () => {
    let mockDb: ReturnType<typeof createMockDatabaseService>;
    const post = httpClient.post as unknown as ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        mockDb = createMockDatabaseService();
        ProviderConfigService.resetInstance();
        ProviderConfigService.setDependencies(mockDb, createSilentLogger());
        TronGridProviderClient.resetInstance();
        TronGridProviderClient.setDependencies(createSilentLogger());
        post.mockReset();
    });

    afterEach(() => {
        mockDb.clear();
        ProviderConfigService.resetInstance();
        TronGridProviderClient.resetInstance();
    });

    it('caps each probe below the configured timeout and issues them concurrently', async () => {
        const service = ProviderConfigService.getInstance();
        await service.addTronGridApiKey('key-aaaa');
        await service.addTronGridApiKey('key-bbbb');
        await service.addTronGridApiKey('key-cccc');
        await service.saveTronGridConfig({ requestTimeoutMs: 120_000 });

        // Every probe parks until released, so the number of calls made while
        // they are all still pending is the concurrency the client achieved.
        const release: Array<() => void> = [];
        post.mockImplementation(() => new Promise((resolve) => {
            release.push(() => resolve(NOW_BLOCK_REPLY));
        }));

        const pending = TronGridProviderClient.getInstance().testConnection();

        // All three calls are outstanding before any of them is released, which
        // a serial loop could never manage.
        await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(3));
        release.forEach((fn) => fn());

        const result = await pending;
        expect(result.ok).toBe(true);
        expect(result.keyResults).toHaveLength(3);
        for (const call of post.mock.calls) {
            expect(call[2].timeout).toBe(15_000);
        }
    });

    it('keeps a shorter configured timeout instead of raising it to the cap', async () => {
        await ProviderConfigService.getInstance().saveTronGridConfig({ requestTimeoutMs: 5_000 });
        post.mockResolvedValue(NOW_BLOCK_REPLY);

        await TronGridProviderClient.getInstance().testConnection();

        expect(post.mock.calls[0][2].timeout).toBe(5_000);
    });

    it('reports the failing count without repeating the key scope', async () => {
        const service = ProviderConfigService.getInstance();
        await service.addTronGridApiKey('key-good');
        await service.addTronGridApiKey('key-dead');
        post
            .mockResolvedValueOnce(NOW_BLOCK_REPLY)
            .mockRejectedValueOnce(Object.assign(new Error('denied'), { response: { status: 401 } }));

        const result = await TronGridProviderClient.getInstance().testConnection();

        expect(result.ok).toBe(false);
        expect(result.message).toBe('1 of 2 probes failed (2 keys).');
    });
});
