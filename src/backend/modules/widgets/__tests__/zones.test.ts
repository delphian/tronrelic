/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the widget-zone subsystem.
 *
 * Covers descriptor minting and identity tracking (`defineZone`), the
 * runtime registry's auto-population, registration, conflict detection,
 * snapshot shape, and the per-plugin facade's lifecycle window and
 * disposer ledger. Mirrors the hook system test conventions so the two
 * registry pairs read consistently.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService, IZoneDescriptor } from '@/types';
import {
    defineZone,
    forgetZone,
    isKnownZone,
    listKnownZones,
    __resetKnownZonesForTests,
    ZoneRegistry,
    PluginZones,
    RESERVED_PLUGIN_ID
} from '../zones/index.js';

/**
 * Minimal `ISystemLogService` implementation for assertions on warn /
 * info / debug call sites without booting the real Pino-backed logger.
 * Mirrors the mock used by the hook system tests.
 */
class MockLogger implements ISystemLogService {
    public level = 'info';
    public fatal = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public info = vi.fn();
    public debug = vi.fn();
    public trace = vi.fn();
    public child = vi.fn((_bindings: Record<string, unknown>): ISystemLogService => {
        return this;
    });

    public async initialize() {}
    public async saveLog() {}
    public async getLogs() {
        return { logs: [], total: 0, page: 1, limit: 50, totalPages: 0, hasNextPage: false, hasPrevPage: false };
    }
    public async markAsResolved() {}
    public async cleanup() { return 0; }
    public async getStatistics() { return { total: 0, byLevel: {} as any, byService: {}, unresolved: 0 }; }
    public async getLogById() { return null; }
    public async markAsUnresolved() { return null; }
    public async deleteAllLogs() { return 0; }
    public async getStats() { return { total: 0, byLevel: {} as any, resolved: 0, unresolved: 0 }; }
    public async waitUntilInitialized() {}
}

describe('defineZone', () => {
    beforeEach(() => __resetKnownZonesForTests());

    it('produces a frozen descriptor tracked by the runtime', () => {
        const desc = defineZone({
            id: 'test.alpha',
            label: 'Alpha',
            description: 'alpha zone',
            host: 'core'
        });

        expect(desc.id).toBe('test.alpha');
        expect(Object.isFrozen(desc)).toBe(true);
        expect(isKnownZone(desc)).toBe(true);
        expect(listKnownZones().map(d => d.id)).toEqual(['test.alpha']);
    });

    it('defaults layout to vertical when omitted', () => {
        const desc = defineZone({
            id: 'test.layout',
            label: 'Layout default',
            description: 'no layout passed',
            host: 'core'
        });

        expect(desc.layout).toBe('vertical');
    });

    it('preserves explicit layout values', () => {
        const desc = defineZone({
            id: 'test.grid',
            label: 'Grid',
            description: 'grid layout',
            host: 'core',
            layout: 'grid'
        });

        expect(desc.layout).toBe('grid');
    });

    it('rejects duplicate ids', () => {
        defineZone({
            id: 'test.dup',
            label: 'First',
            description: 'first',
            host: 'core'
        });

        expect(() => defineZone({
            id: 'test.dup',
            label: 'Second',
            description: 'second',
            host: 'core'
        })).toThrow(/Duplicate zone descriptor id/);
    });

    it('does not consider a hand-rolled object known', () => {
        const fake: IZoneDescriptor = {
            id: 'test.fake',
            label: 'Fake',
            description: '',
            host: 'core',
            layout: 'vertical'
        };

        expect(isKnownZone(fake)).toBe(false);
    });

    it('listKnownZones returns descriptors sorted by id', () => {
        defineZone({ id: 'test.gamma', label: 'G', description: '', host: 'core' });
        defineZone({ id: 'test.alpha', label: 'A', description: '', host: 'core' });
        defineZone({ id: 'test.beta', label: 'B', description: '', host: 'core' });

        expect(listKnownZones().map(d => d.id)).toEqual(['test.alpha', 'test.beta', 'test.gamma']);
    });
});

describe('ZoneRegistry construction', () => {
    let logger: MockLogger;

    beforeEach(() => {
        __resetKnownZonesForTests();
        logger = new MockLogger();
    });

    it('auto-populates with every descriptor tracked at construction time as core-owned', () => {
        defineZone({ id: 'test.preload-a', label: 'A', description: '', host: 'site' });
        defineZone({ id: 'test.preload-b', label: 'B', description: '', host: 'core' });

        const registry = new ZoneRegistry(logger);

        expect(registry.has('test.preload-a')).toBe(true);
        expect(registry.has('test.preload-b')).toBe(true);
        expect(registry.get('test.preload-a')?.pluginId).toBe(RESERVED_PLUGIN_ID);
        expect(registry.get('test.preload-b')?.pluginId).toBe(RESERVED_PLUGIN_ID);
    });

    it('starts empty when no descriptors have been declared', () => {
        const registry = new ZoneRegistry(logger);
        const snapshot = registry.snapshot();

        const totalZones = snapshot.tracks.reduce((sum, t) => sum + t.zones.length, 0);
        expect(totalZones).toBe(0);
        expect(snapshot.tracks.map(t => t.id)).toEqual(['site', 'core', 'plugin', 'admin']);
    });
});

describe('ZoneRegistry.register', () => {
    let logger: MockLogger;
    let registry: ZoneRegistry;

    beforeEach(() => {
        __resetKnownZonesForTests();
        logger = new MockLogger();
        registry = new ZoneRegistry(logger);
    });

    it('rejects an empty pluginId', () => {
        const desc = defineZone({ id: 'test.alpha', label: 'A', description: '', host: 'core' });

        expect(() => registry.register('', desc)).toThrow(/non-empty pluginId/);
    });

    it('rejects a descriptor not produced by defineZone', () => {
        const fake: IZoneDescriptor = {
            id: 'test.fake',
            label: 'Fake',
            description: '',
            host: 'core',
            layout: 'vertical'
        };

        expect(() => registry.register('my-plugin', fake)).toThrow(/was not produced by defineZone/);
    });

    it('accepts a plugin registration and surfaces it in the snapshot', () => {
        const desc = defineZone({
            id: 'test.plugin-zone',
            label: 'Plugin Zone',
            description: 'declared by a plugin',
            host: 'plugin'
        });

        registry.register('my-plugin', desc);

        expect(registry.has('test.plugin-zone')).toBe(true);
        const record = registry.get('test.plugin-zone');
        expect(record?.pluginId).toBe('my-plugin');
        expect(record?.host).toBe('plugin');
        expect(record?.label).toBe('Plugin Zone');
    });

    it('refuses to overwrite a zone declared by a different plugin', () => {
        const desc = defineZone({ id: 'test.conflict', label: 'C', description: '', host: 'plugin' });
        registry.register('plugin-a', desc);

        expect(() => registry.register('plugin-b', desc)).toThrow(/already declared by 'plugin-a'/);
    });

    it('allows the same plugin to re-register its own zone', () => {
        const desc = defineZone({ id: 'test.reregister', label: 'R', description: '', host: 'plugin' });
        registry.register('plugin-a', desc);

        expect(() => registry.register('plugin-a', desc)).not.toThrow();
    });

    it('returns a disposer that removes the zone', () => {
        const desc = defineZone({ id: 'test.dispose', label: 'D', description: '', host: 'plugin' });
        const dispose = registry.register('my-plugin', desc);

        expect(registry.has('test.dispose')).toBe(true);
        dispose();
        expect(registry.has('test.dispose')).toBe(false);
    });
});

describe('ZoneRegistry.disposeForPlugin', () => {
    let logger: MockLogger;
    let registry: ZoneRegistry;

    beforeEach(() => {
        __resetKnownZonesForTests();
        // Pre-declare a core zone so it lives in the registry from construction.
        defineZone({ id: 'test.core', label: 'Core', description: '', host: 'core' });
        logger = new MockLogger();
        registry = new ZoneRegistry(logger);
    });

    it('drops every zone owned by the plugin', () => {
        const a = defineZone({ id: 'test.plugin-a-1', label: 'A1', description: '', host: 'plugin' });
        const b = defineZone({ id: 'test.plugin-a-2', label: 'A2', description: '', host: 'plugin' });
        registry.register('plugin-a', a);
        registry.register('plugin-a', b);

        const removed = registry.disposeForPlugin('plugin-a');

        expect(removed).toBe(2);
        expect(registry.has('test.plugin-a-1')).toBe(false);
        expect(registry.has('test.plugin-a-2')).toBe(false);
    });

    it('forgets disposed zones from KNOWN_ZONES so subsequent defineZone calls mint fresh descriptors', () => {
        const desc = defineZone({ id: 'test.forget', label: 'F', description: '', host: 'plugin' });
        registry.register('plugin-a', desc);

        registry.disposeForPlugin('plugin-a');

        expect(listKnownZones().map(d => d.id)).not.toContain('test.forget');
        const fresh = defineZone({ id: 'test.forget', label: 'F2', description: '', host: 'plugin' });
        expect(fresh).not.toBe(desc);
        expect(fresh.label).toBe('F2');
    });

    it('never removes core-owned zones', () => {
        const removed = registry.disposeForPlugin(RESERVED_PLUGIN_ID);

        expect(removed).toBe(0);
        expect(registry.has('test.core')).toBe(true);
        expect(listKnownZones().map(d => d.id)).toContain('test.core');
    });

    it('returns zero when the plugin owns no zones', () => {
        const removed = registry.disposeForPlugin('phantom-plugin');

        expect(removed).toBe(0);
    });
});

describe('Plugin re-enable cycle', () => {
    let logger: MockLogger;
    let registry: ZoneRegistry;

    beforeEach(() => {
        __resetKnownZonesForTests();
        logger = new MockLogger();
        registry = new ZoneRegistry(logger);
    });

    it('lets a plugin re-declare zones after disposeForPlugin clears them', () => {
        const facade = new PluginZones('plugin-x', registry, logger);
        facade.register({
            id: 'test.re-enable',
            label: 'Re-enable',
            description: '',
            host: 'plugin'
        });
        expect(registry.has('test.re-enable')).toBe(true);

        // Mimic PluginManagerService.disposeZones on plugin disable.
        facade.closeAndDisposeAll();
        registry.disposeForPlugin('plugin-x');

        // Mimic PluginManagerService.rearmZones on the next enable.
        const reFacade = new PluginZones('plugin-x', registry, logger);
        expect(() => reFacade.register({
            id: 'test.re-enable',
            label: 'Re-enable',
            description: '',
            host: 'plugin'
        })).not.toThrow();
        expect(registry.has('test.re-enable')).toBe(true);
        expect(registry.get('test.re-enable')?.pluginId).toBe('plugin-x');
    });

    it('forgets the zone when a single registration disposer fires', () => {
        const facade = new PluginZones('plugin-x', registry, logger);
        const dispose = facade.register({
            id: 'test.single-dispose',
            label: 'D',
            description: '',
            host: 'plugin'
        });

        dispose();

        expect(listKnownZones().map(d => d.id)).not.toContain('test.single-dispose');
        expect(() => defineZone({
            id: 'test.single-dispose',
            label: 'Fresh',
            description: '',
            host: 'plugin'
        })).not.toThrow();
    });

    it('exports forgetZone as a primitive of define-zone', () => {
        defineZone({ id: 'test.manual-forget', label: 'M', description: '', host: 'plugin' });

        expect(forgetZone('test.manual-forget')).toBe(true);
        expect(forgetZone('test.manual-forget')).toBe(false);
        expect(listKnownZones().map(d => d.id)).not.toContain('test.manual-forget');
    });
});

describe('ZoneRegistry.snapshot', () => {
    let logger: MockLogger;

    beforeEach(() => {
        __resetKnownZonesForTests();
        logger = new MockLogger();
    });

    it('groups zones by host and emits every host track even when empty', () => {
        defineZone({ id: 'test.site', label: 'S', description: '', host: 'site' });
        defineZone({ id: 'test.core', label: 'C', description: '', host: 'core' });
        const registry = new ZoneRegistry(logger);

        const snapshot = registry.snapshot();

        const siteTrack = snapshot.tracks.find(t => t.id === 'site');
        const coreTrack = snapshot.tracks.find(t => t.id === 'core');
        const pluginTrack = snapshot.tracks.find(t => t.id === 'plugin');
        const adminTrack = snapshot.tracks.find(t => t.id === 'admin');

        expect(siteTrack?.zones.map(z => z.id)).toEqual(['test.site']);
        expect(coreTrack?.zones.map(z => z.id)).toEqual(['test.core']);
        expect(pluginTrack?.zones).toEqual([]);
        expect(adminTrack?.zones).toEqual([]);
    });

    it('sorts zones within a track by id', () => {
        defineZone({ id: 'test.zeta', label: 'Z', description: '', host: 'core' });
        defineZone({ id: 'test.alpha', label: 'A', description: '', host: 'core' });
        defineZone({ id: 'test.beta', label: 'B', description: '', host: 'core' });
        const registry = new ZoneRegistry(logger);

        const snapshot = registry.snapshot();
        const coreTrack = snapshot.tracks.find(t => t.id === 'core');

        expect(coreTrack?.zones.map(z => z.id)).toEqual(['test.alpha', 'test.beta', 'test.zeta']);
    });

    it('serializes registeredAt as an ISO-8601 string', () => {
        defineZone({ id: 'test.time', label: 'T', description: '', host: 'core' });
        const registry = new ZoneRegistry(logger);

        const record = registry.get('test.time');

        expect(record?.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
});

describe('PluginZones facade', () => {
    let logger: MockLogger;
    let registry: ZoneRegistry;

    beforeEach(() => {
        __resetKnownZonesForTests();
        logger = new MockLogger();
        registry = new ZoneRegistry(logger);
    });

    it('tags zone declarations with the plugin id', () => {
        const facade = new PluginZones('plugin-x', registry, logger);

        facade.register({
            id: 'test.facade-tagged',
            label: 'Tagged',
            description: '',
            host: 'plugin'
        });

        expect(registry.get('test.facade-tagged')?.pluginId).toBe('plugin-x');
    });

    it('refuses to register after seal()', () => {
        const facade = new PluginZones('plugin-x', registry, logger);
        facade.seal();

        expect(() => facade.register({
            id: 'test.after-seal',
            label: 'X',
            description: '',
            host: 'plugin'
        })).toThrow(/lifecycle window closed/);
    });

    it('refuses to register after closeAndDisposeAll()', () => {
        const facade = new PluginZones('plugin-x', registry, logger);
        facade.closeAndDisposeAll();

        expect(() => facade.register({
            id: 'test.after-close',
            label: 'X',
            description: '',
            host: 'plugin'
        })).toThrow(/lifecycle window closed/);
    });

    it('seal() is idempotent and does not dispose registrations', () => {
        const facade = new PluginZones('plugin-x', registry, logger);
        facade.register({
            id: 'test.survives-seal',
            label: 'S',
            description: '',
            host: 'plugin'
        });
        facade.seal();
        facade.seal();

        expect(registry.has('test.survives-seal')).toBe(true);
    });

    it('closeAndDisposeAll() drops every zone the facade owns and returns the count', () => {
        const facade = new PluginZones('plugin-x', registry, logger);
        facade.register({ id: 'test.bulk-1', label: '1', description: '', host: 'plugin' });
        facade.register({ id: 'test.bulk-2', label: '2', description: '', host: 'plugin' });
        facade.register({ id: 'test.bulk-3', label: '3', description: '', host: 'plugin' });

        const removed = facade.closeAndDisposeAll();

        expect(removed).toBe(3);
        expect(registry.has('test.bulk-1')).toBe(false);
        expect(registry.has('test.bulk-2')).toBe(false);
        expect(registry.has('test.bulk-3')).toBe(false);
    });

    it('individual disposers do not double-dispose during closeAndDisposeAll', () => {
        const facade = new PluginZones('plugin-x', registry, logger);
        const dispose = facade.register({
            id: 'test.double-dispose',
            label: 'D',
            description: '',
            host: 'plugin'
        });

        dispose();
        const removed = facade.closeAndDisposeAll();

        // The first dispose removed the entry from the facade's set, so the
        // bulk dispose finds nothing left to drop.
        expect(removed).toBe(0);
        expect(registry.has('test.double-dispose')).toBe(false);
    });
});
