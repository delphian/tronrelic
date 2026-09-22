/**
 * @file providers.controller.test.ts
 *
 * Contract tests for the input guards on the providers admin API.
 *
 * Both guards here protect something a 200 response would otherwise hide. The
 * numeric guard stops a non-numeric body value (`null`, `true`, `''`) from
 * coercing into a legal-looking integer — `requestThrottleMs: null` becoming `0`
 * would persist "no pacing at all" and report success. The base-URL guard stops
 * an arbitrary string from becoming the host these clients send stored API keys
 * to. Neither failure is visible in the admin UI after the fact, so they are
 * pinned here rather than left to a reviewer to notice.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { ProviderConfigService } from '../services/provider-config.service.js';
import { ProviderRegistry } from '../services/provider-registry.service.js';
import { ProvidersController } from '../api/providers.controller.js';
import {
    DEFAULT_TRONGRID_CONFIG,
    DEFAULT_TRONSCAN_CONFIG,
    DEFAULT_COINGECKO_CONFIG,
    TRONSCAN_DESCRIPTOR,
    TRONGRID_DESCRIPTOR,
    COINGECKO_DESCRIPTOR
} from '../database/index.js';

/**
 * Minimal ISystemLogService stand-in — these tests assert on stored state and
 * HTTP responses, never on log output.
 *
 * @returns A logger whose methods do nothing.
 */
function createSilentLogger() {
    const noop = () => undefined;
    return { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: () => createSilentLogger() } as never;
}

/**
 * Build a response double that records the status code and JSON body a handler
 * produced, so a test can assert on both without an HTTP server.
 *
 * @returns The Express-shaped response plus the captured status and payload.
 */
function createResponseSpy() {
    const captured: { status: number; body: unknown } = { status: 200, body: undefined };
    const res = {
        status(code: number) {
            captured.status = code;
            return this;
        },
        json(body: unknown) {
            captured.body = body;
            return this;
        }
    };
    return { res: res as unknown as Response, captured };
}

/**
 * Shape a plain body into the sliver of `Request` the handlers read.
 *
 * @param body - JSON body the request carries.
 * @param id - Route param `id` for the generic vendor routes.
 * @returns A request double.
 */
function requestWith(body: unknown, id?: string): Request {
    return { body, params: id ? { id } : {} } as unknown as Request;
}

describe('ProvidersController — input guards', () => {
    let mockDb: ReturnType<typeof createMockDatabaseService>;
    let controller: ProvidersController;

    beforeEach(() => {
        mockDb = createMockDatabaseService();
        ProviderConfigService.resetInstance();
        ProviderConfigService.setDependencies(mockDb, createSilentLogger());
        ProviderRegistry.resetInstance();
        const registry = ProviderRegistry.getInstance();
        const test = async () => ({ ok: true, message: 'ok' });
        registry.registerVendor({ descriptor: TRONSCAN_DESCRIPTOR, defaults: DEFAULT_TRONSCAN_CONFIG, testConnection: test, isEnabled: async () => true });
        registry.registerVendor({ descriptor: TRONGRID_DESCRIPTOR, defaults: DEFAULT_TRONGRID_CONFIG, testConnection: test, isEnabled: async () => false });
        registry.registerVendor({ descriptor: COINGECKO_DESCRIPTOR, defaults: DEFAULT_COINGECKO_CONFIG, testConnection: test, isEnabled: async () => true });
        controller = new ProvidersController(
            ProviderConfigService.getInstance(),
            registry,
            {} as never,
            createSilentLogger()
        );
    });

    afterEach(() => {
        mockDb.clear();
        ProviderConfigService.resetInstance();
        ProviderRegistry.resetInstance();
        vi.restoreAllMocks();
    });

    describe('generic vendor routes', () => {
        it('lists every registered vendor with its descriptor and masked config', async () => {
            const { res, captured } = createResponseSpy();

            await controller.listProviders(requestWith({}), res);

            expect(captured.status).toBe(200);
            const providers = (captured.body as { providers: Array<{ id: string; config: Record<string, unknown> }> }).providers;
            expect(providers.map((provider) => provider.id)).toEqual(['tronscan', 'trongrid', 'coingecko']);
            expect(providers[0].config).toMatchObject({ apiKey: '', apiKeyConfigured: false, enabled: true });
            expect(providers[1].config).toMatchObject({ apiKeys: [], apiKeyCount: 0 });
        });

        it('answers 404 for an unknown vendor', async () => {
            const { res, captured } = createResponseSpy();
            await controller.getProviderConfig(requestWith({}, 'nope'), res);
            expect(captured.status).toBe(404);
        });

        it('stores a new secret, masks it on read, ignores a masked echo, and clears on the sentinel', async () => {
            const first = createResponseSpy();
            await controller.updateProviderConfig(requestWith({ apiKey: 'cg-secret-key-1234' }, 'coingecko'), first.res);
            expect(first.captured.status).toBe(200);
            expect((first.captured.body as { config: Record<string, unknown> }).config).toMatchObject({ apiKey: '****1234', apiKeyConfigured: true });
            expect((await ProviderConfigService.getInstance().getCoinGeckoConfig()).apiKey).toBe('cg-secret-key-1234');

            await controller.updateProviderConfig(requestWith({ apiKey: '****1234', enabled: false }, 'coingecko'), createResponseSpy().res);
            const afterEcho = await ProviderConfigService.getInstance().getCoinGeckoConfig();
            expect(afterEcho.apiKey).toBe('cg-secret-key-1234');
            expect(afterEcho.enabled).toBe(false);

            await controller.updateProviderConfig(requestWith({ apiKey: '__clear__' }, 'coingecko'), createResponseSpy().res);
            expect((await ProviderConfigService.getInstance().getCoinGeckoConfig()).apiKey).toBeUndefined();
        });

        it('rejects a value outside a select field\'s options and a non-boolean switch, naming the field', async () => {
            const select = createResponseSpy();
            await controller.updateProviderConfig(requestWith({ keyTier: 'platinum' }, 'coingecko'), select.res);
            expect(select.captured.status).toBe(400);
            expect((select.captured.body as { error: string }).error).toContain('keyTier');

            const bool = createResponseSpy();
            await controller.updateProviderConfig(requestWith({ enabled: 'yes' }, 'tronscan'), bool.res);
            expect(bool.captured.status).toBe(400);
            expect((bool.captured.body as { error: string }).error).toContain('enabled');
            expect((await ProviderConfigService.getInstance().getTronScanConfig()).enabled).toBe(true);
        });

        it('refuses to save a custom vendor through the generic route', async () => {
            const { res, captured } = createResponseSpy();
            await controller.updateProviderConfig(requestWith({ enabled: true }, 'trongrid'), res);
            expect(captured.status).toBe(400);
            expect((await ProviderConfigService.getInstance().getTronGridConfig()).enabled).toBe(false);
        });
    });

    describe('TronGrid numeric fields', () => {
        it.each([
            ['null', null],
            ['true', true],
            ['an empty string', ''],
            ['whitespace', '   '],
            ['an array', []]
        ])('rejects a throttle sent as %s rather than coercing it to 0', async (_label, value) => {
            const { res, captured } = createResponseSpy();

            await controller.updateTronGridConfig(requestWith({ requestThrottleMs: value }), res);

            expect(captured.status).toBe(400);
            expect((captured.body as { error: string }).error).toContain('requestThrottleMs');
            const stored = await ProviderConfigService.getInstance().getTronGridConfig();
            expect(stored.requestThrottleMs).toBe(DEFAULT_TRONGRID_CONFIG.requestThrottleMs);
        });

        it('accepts an in-range number and a numeric string', async () => {
            const first = createResponseSpy();
            await controller.updateTronGridConfig(requestWith({ requestThrottleMs: 0 }), first.res);
            expect(first.captured.status).toBe(200);
            expect((await ProviderConfigService.getInstance().getTronGridConfig()).requestThrottleMs).toBe(0);

            const second = createResponseSpy();
            await controller.updateTronGridConfig(requestWith({ maxQueueSize: '250' }), second.res);
            expect(second.captured.status).toBe(200);
            expect((await ProviderConfigService.getInstance().getTronGridConfig()).maxQueueSize).toBe(250);
        });

        it('rejects an out-of-range value and names the field', async () => {
            const { res, captured } = createResponseSpy();

            await controller.updateTronGridConfig(requestWith({ requestTimeoutMs: 500 }), res);

            expect(captured.status).toBe(400);
            expect((captured.body as { error: string }).error).toContain('requestTimeoutMs');
        });
    });

    describe('base URL validation', () => {
        it.each([
            ['a bare hostname', 'api.trongrid.io'],
            ['a scheme-relative URL', '//api.trongrid.io'],
            ['a non-HTTP scheme', 'ftp://api.trongrid.io'],
            ['a javascript: URL', 'javascript:alert(1)'],
            ['a file: URL', 'file:///etc/passwd'],
            ['nothing but slashes', '///']
        ])('refuses %s on the TronGrid config', async (_label, baseUrl) => {
            const { res, captured } = createResponseSpy();

            await controller.updateTronGridConfig(requestWith({ baseUrl }), res);

            expect(captured.status).toBe(400);
            expect((captured.body as { error: string }).error).toContain('baseUrl');
            expect((await ProviderConfigService.getInstance().getTronGridConfig()).baseUrl)
                .toBe(DEFAULT_TRONGRID_CONFIG.baseUrl);
        });

        it('refuses the same input on the TronScan config through the generic route', async () => {
            const { res, captured } = createResponseSpy();

            await controller.updateProviderConfig(requestWith({ baseUrl: 'ftp://apilist.tronscanapi.com' }, 'tronscan'), res);

            expect(captured.status).toBe(400);
            expect((captured.body as { error: string }).error).toContain('baseUrl');
            expect((await ProviderConfigService.getInstance().getTronScanConfig()).baseUrl)
                .toBe(DEFAULT_TRONSCAN_CONFIG.baseUrl);
        });

        it('accepts an absolute HTTP(S) URL and strips its trailing slashes', async () => {
            const { res, captured } = createResponseSpy();

            await controller.updateTronGridConfig(requestWith({ baseUrl: 'http://tron-node.internal:8090//' }), res);

            expect(captured.status).toBe(200);
            expect((await ProviderConfigService.getInstance().getTronGridConfig()).baseUrl)
                .toBe('http://tron-node.internal:8090');
        });
    });

    describe('block receipt switch', () => {
        it.each([
            ['the string "true"', 'true'],
            ['the number 1', 1],
            ['null', null]
        ])('refuses %s rather than reading it as on', async (_label, value) => {
            // Anything but a real boolean is refused, because a truthy body value
            // accepted behind a 200 would double the deployment's upstream call
            // rate with nothing in the form to show it had happened.
            const { res, captured } = createResponseSpy();

            await controller.updateTronGridConfig(requestWith({ fetchBlockReceipts: value }), res);

            expect(captured.status).toBe(400);
            expect((captured.body as { error: string }).error).toContain('fetchBlockReceipts');
            expect((await ProviderConfigService.getInstance().getTronGridConfig()).fetchBlockReceipts).toBe(false);
        });

        it('persists a real boolean in both directions', async () => {
            const on = createResponseSpy();
            await controller.updateTronGridConfig(requestWith({ fetchBlockReceipts: true }), on.res);
            expect(on.captured.status).toBe(200);
            expect((await ProviderConfigService.getInstance().getTronGridConfig()).fetchBlockReceipts).toBe(true);

            const off = createResponseSpy();
            await controller.updateTronGridConfig(requestWith({ fetchBlockReceipts: false }), off.res);
            expect(off.captured.status).toBe(200);
            expect((await ProviderConfigService.getInstance().getTronGridConfig()).fetchBlockReceipts).toBe(false);
        });

        it('leaves the switch alone when the request does not mention it', async () => {
            await controller.updateTronGridConfig(requestWith({ fetchBlockReceipts: true }), createResponseSpy().res);

            const { res, captured } = createResponseSpy();
            await controller.updateTronGridConfig(requestWith({ requestThrottleMs: 250 }), res);

            expect(captured.status).toBe(200);
            expect((await ProviderConfigService.getInstance().getTronGridConfig()).fetchBlockReceipts).toBe(true);
        });
    });
});
