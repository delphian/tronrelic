/**
 * @file provider-config.trongrid.test.ts
 *
 * Contract tests for the staged TronGrid half of ProviderConfigService: defaults
 * before anything is saved, masking of the rotating key pool, the key add/remove
 * rules, and the guarantee that a config save cannot touch stored keys.
 *
 * These are the paths where a mistake costs a secret — a save that accepted a
 * masked echo, or a remove that dropped the wrong position, would silently
 * corrupt the pool the eventual switchover depends on — so they are pinned here
 * rather than left to the admin UI to reveal.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { ProviderConfigService, ProviderConfigValidationError } from '../services/provider-config.service.js';
import { DEFAULT_TRONGRID_CONFIG, MAX_TRONGRID_API_KEYS, TRONGRID_CONFIG_KEY } from '../database/index.js';

/**
 * Minimal ISystemLogService stand-in: the service only ever emits info lines, and
 * the test asserts on stored state rather than on logging.
 *
 * @returns A logger whose methods do nothing.
 */
function createSilentLogger() {
    const noop = () => undefined;
    return { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: () => createSilentLogger() } as never;
}

describe('ProviderConfigService — TronGrid', () => {
    let mockDb: ReturnType<typeof createMockDatabaseService>;
    let service: ProviderConfigService;

    beforeEach(() => {
        mockDb = createMockDatabaseService();
        ProviderConfigService.resetInstance();
        ProviderConfigService.setDependencies(mockDb, createSilentLogger());
        service = ProviderConfigService.getInstance();
    });

    afterEach(() => {
        mockDb.clear();
        ProviderConfigService.resetInstance();
    });

    it('returns defaults, disabled and keyless, before anything is saved', async () => {
        const config = await service.getTronGridConfig();
        expect(config).toEqual(DEFAULT_TRONGRID_CONFIG);
        expect(config.enabled).toBe(false);
        expect(config.apiKeys).toEqual([]);
    });

    it('masks every stored key to its last four characters', async () => {
        await service.addTronGridApiKey('aaaaaaaa-1111');
        const masked = await service.addTronGridApiKey('bbbbbbbb-2222');

        expect(masked.apiKeys).toEqual(['****1111', '****2222']);
        expect(masked.apiKeyCount).toBe(2);
        // The raw keys stay behind the service; only the backend view sees them.
        expect((await service.getTronGridConfig()).apiKeys).toEqual(['aaaaaaaa-1111', 'bbbbbbbb-2222']);
    });

    it('refuses a blank key, a duplicate, and one key past the ceiling', async () => {
        await expect(service.addTronGridApiKey('   ')).rejects.toBeInstanceOf(ProviderConfigValidationError);

        await service.addTronGridApiKey('key-one');
        await expect(service.addTronGridApiKey('key-one')).rejects.toBeInstanceOf(ProviderConfigValidationError);

        for (let index = 1; index < MAX_TRONGRID_API_KEYS; index += 1) {
            await service.addTronGridApiKey(`filler-${index}`);
        }
        await expect(service.addTronGridApiKey('one-too-many')).rejects.toBeInstanceOf(ProviderConfigValidationError);
    });

    it('removes the key at the given rotation position and rejects positions that do not exist', async () => {
        await service.addTronGridApiKey('key-a');
        await service.addTronGridApiKey('key-b');
        await service.addTronGridApiKey('key-c');

        const masked = await service.removeTronGridApiKey(1);
        expect(masked.apiKeys).toEqual(['****ey-a', '****ey-c']);

        await expect(service.removeTronGridApiKey(5)).rejects.toBeInstanceOf(ProviderConfigValidationError);
        await expect(service.removeTronGridApiKey(-1)).rejects.toBeInstanceOf(ProviderConfigValidationError);
    });

    it('leaves stored keys untouched when the non-secret fields are saved', async () => {
        await service.addTronGridApiKey('survives-the-save');

        await service.saveTronGridConfig({
            enabled: true,
            baseUrl: 'https://nile.trongrid.io',
            requestThrottleMs: 350
        });

        const config = await service.getTronGridConfig();
        expect(config.apiKeys).toEqual(['survives-the-save']);
        expect(config.enabled).toBe(true);
        expect(config.baseUrl).toBe('https://nile.trongrid.io');
        expect(config.requestThrottleMs).toBe(350);
        // Untouched fields keep their defaults rather than being reset.
        expect(config.maxQueueSize).toBe(DEFAULT_TRONGRID_CONFIG.maxQueueSize);
    });

    it('normalizes a stored blob whose apiKeys is not an array', async () => {
        // A hand-edited or older blob could carry a bare string here; iterating it
        // character by character would hand single letters to the key rotator.
        await mockDb.set(TRONGRID_CONFIG_KEY, { baseUrl: 'https://api.trongrid.io', apiKeys: 'not-an-array' });

        const config = await service.getTronGridConfig();
        expect(config.apiKeys).toEqual([]);
    });
});
