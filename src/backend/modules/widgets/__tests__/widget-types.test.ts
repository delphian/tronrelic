/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the widget-type subsystem.
 *
 * Mirrors the zone-subsystem tests: descriptor minting and identity
 * tracking, runtime-registry register/dispose/conflict/snapshot
 * semantics, per-plugin facade lifecycle window and disposer ledger,
 * and the disable→re-enable cycle that exercises `forgetWidgetType`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService, IWidgetType } from '@/types';
import {
    defineWidgetType,
    forgetWidgetType,
    isKnownWidgetType,
    listKnownWidgetTypes,
    __resetKnownWidgetTypesForTests,
    WidgetTypeRegistry,
    PluginWidgetTypes,
    RESERVED_PLUGIN_ID
} from '../widget-types/index.js';

class MockLogger implements ISystemLogService {
    public level = 'info';
    public fatal = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public info = vi.fn();
    public debug = vi.fn();
    public trace = vi.fn();
    public child = vi.fn((_b: Record<string, unknown>): ISystemLogService => this);
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

const noopFetcher = async () => ({});

describe('defineWidgetType', () => {
    beforeEach(() => __resetKnownWidgetTypesForTests());

    it('produces a frozen descriptor tracked by the runtime', () => {
        const desc = defineWidgetType({
            id: 'test.alpha',
            label: 'Alpha',
            description: 'alpha widget',
            defaultDataFetcher: noopFetcher
        });

        expect(desc.id).toBe('test.alpha');
        expect(Object.isFrozen(desc)).toBe(true);
        expect(isKnownWidgetType(desc)).toBe(true);
        expect(listKnownWidgetTypes().map(d => d.id)).toEqual(['test.alpha']);
    });

    it('rejects duplicate ids', () => {
        defineWidgetType({ id: 'test.dup', label: 'A', description: '', defaultDataFetcher: noopFetcher });

        expect(() => defineWidgetType({
            id: 'test.dup',
            label: 'B',
            description: '',
            defaultDataFetcher: noopFetcher
        })).toThrow(/Duplicate widget-type descriptor id/);
    });

    it('does not consider a hand-rolled object known', () => {
        const fake: IWidgetType = {
            id: 'test.fake',
            label: 'Fake',
            description: '',
            defaultDataFetcher: noopFetcher
        };

        expect(isKnownWidgetType(fake)).toBe(false);
    });

    it('listKnownWidgetTypes returns descriptors sorted by id', () => {
        defineWidgetType({ id: 'test.gamma', label: 'G', description: '', defaultDataFetcher: noopFetcher });
        defineWidgetType({ id: 'test.alpha', label: 'A', description: '', defaultDataFetcher: noopFetcher });
        defineWidgetType({ id: 'test.beta', label: 'B', description: '', defaultDataFetcher: noopFetcher });

        expect(listKnownWidgetTypes().map(d => d.id)).toEqual(['test.alpha', 'test.beta', 'test.gamma']);
    });
});

describe('WidgetTypeRegistry.register', () => {
    let logger: MockLogger;
    let registry: WidgetTypeRegistry;

    beforeEach(() => {
        __resetKnownWidgetTypesForTests();
        logger = new MockLogger();
        registry = new WidgetTypeRegistry(logger);
    });

    it('rejects an empty pluginId', () => {
        const desc = defineWidgetType({ id: 'test.alpha', label: 'A', description: '', defaultDataFetcher: noopFetcher });

        expect(() => registry.register('', desc)).toThrow(/non-empty pluginId/);
    });

    it('rejects a descriptor not produced by defineWidgetType', () => {
        const fake: IWidgetType = {
            id: 'test.fake',
            label: 'Fake',
            description: '',
            defaultDataFetcher: noopFetcher
        };

        expect(() => registry.register('plugin-a', fake)).toThrow(/was not produced by defineWidgetType/);
    });

    it('accepts a plugin registration and exposes the descriptor via get', () => {
        const desc = defineWidgetType({
            id: 'test.plugin-type',
            label: 'Plugin Type',
            description: 'declared by a plugin',
            defaultDataFetcher: noopFetcher
        });

        registry.register('plugin-a', desc);

        expect(registry.has('test.plugin-type')).toBe(true);
        expect(registry.get('test.plugin-type')).toBe(desc);
    });

    it('exposes plugin ownership via getOwnerPluginId', () => {
        const desc = defineWidgetType({
            id: 'test.owned',
            label: 'Owned',
            description: '',
            defaultDataFetcher: noopFetcher
        });
        registry.register('plugin-a', desc);

        expect(registry.getOwnerPluginId('test.owned')).toBe('plugin-a');
        expect(registry.getOwnerPluginId('test.unregistered')).toBeUndefined();
    });

    it('refuses to overwrite a type declared by a different plugin', () => {
        const desc = defineWidgetType({ id: 'test.conflict', label: 'C', description: '', defaultDataFetcher: noopFetcher });
        registry.register('plugin-a', desc);

        expect(() => registry.register('plugin-b', desc)).toThrow(/already declared by 'plugin-a'/);
    });

    it('allows the same plugin to re-register its own type', () => {
        const desc = defineWidgetType({ id: 'test.reregister', label: 'R', description: '', defaultDataFetcher: noopFetcher });
        registry.register('plugin-a', desc);

        expect(() => registry.register('plugin-a', desc)).not.toThrow();
    });

    it('returns a disposer that removes the type and forgets it from the cache', () => {
        const desc = defineWidgetType({ id: 'test.dispose', label: 'D', description: '', defaultDataFetcher: noopFetcher });
        const dispose = registry.register('plugin-a', desc);

        expect(registry.has('test.dispose')).toBe(true);
        dispose();
        expect(registry.has('test.dispose')).toBe(false);
        expect(listKnownWidgetTypes().map(d => d.id)).not.toContain('test.dispose');
    });
});

describe('WidgetTypeRegistry.disposeForPlugin', () => {
    let logger: MockLogger;
    let registry: WidgetTypeRegistry;

    beforeEach(() => {
        __resetKnownWidgetTypesForTests();
        logger = new MockLogger();
        registry = new WidgetTypeRegistry(logger);
    });

    it('drops every type owned by the plugin and forgets them from the cache', () => {
        const a = defineWidgetType({ id: 'test.plugin-a-1', label: 'A1', description: '', defaultDataFetcher: noopFetcher });
        const b = defineWidgetType({ id: 'test.plugin-a-2', label: 'A2', description: '', defaultDataFetcher: noopFetcher });
        registry.register('plugin-a', a);
        registry.register('plugin-a', b);

        const removed = registry.disposeForPlugin('plugin-a');

        expect(removed).toBe(2);
        expect(registry.has('test.plugin-a-1')).toBe(false);
        expect(registry.has('test.plugin-a-2')).toBe(false);
        expect(listKnownWidgetTypes().map(d => d.id)).toEqual([]);
    });

    it('refuses to dispose core-owned types via disposeForPlugin', () => {
        defineWidgetType({ id: 'test.core', label: 'C', description: '', defaultDataFetcher: noopFetcher });
        // Core registration would be performed by a hypothetical core
        // module (none today); we simulate it here.
        registry.register(RESERVED_PLUGIN_ID, registry.get('test.core') ?? defineWidgetType({ id: 'test.core-2', label: '', description: '', defaultDataFetcher: noopFetcher }));

        const removed = registry.disposeForPlugin(RESERVED_PLUGIN_ID);
        expect(removed).toBe(0);
    });

    it('returns zero when the plugin owns no types', () => {
        const removed = registry.disposeForPlugin('phantom-plugin');
        expect(removed).toBe(0);
    });
});

describe('WidgetTypeRegistry.snapshot', () => {
    let logger: MockLogger;
    let registry: WidgetTypeRegistry;

    beforeEach(() => {
        __resetKnownWidgetTypesForTests();
        logger = new MockLogger();
        registry = new WidgetTypeRegistry(logger);
    });

    it('groups types by plugin id and sorts groups + members', () => {
        const aFoo = defineWidgetType({ id: 'plugin-a:foo', label: 'A foo', description: '', defaultDataFetcher: noopFetcher });
        const aBar = defineWidgetType({ id: 'plugin-a:bar', label: 'A bar', description: '', defaultDataFetcher: noopFetcher });
        const bBaz = defineWidgetType({ id: 'plugin-b:baz', label: 'B baz', description: '', defaultDataFetcher: noopFetcher });
        registry.register('plugin-a', aFoo);
        registry.register('plugin-a', aBar);
        registry.register('plugin-b', bBaz);

        const snapshot = registry.snapshot();

        expect(snapshot.groups.map(g => g.pluginId)).toEqual(['plugin-a', 'plugin-b']);
        expect(snapshot.groups[0].types.map(t => t.id)).toEqual(['plugin-a:bar', 'plugin-a:foo']);
        expect(snapshot.groups[1].types.map(t => t.id)).toEqual(['plugin-b:baz']);
    });

    it('serializes registeredAt as an ISO-8601 string', () => {
        const desc = defineWidgetType({ id: 'test.time', label: 'T', description: '', defaultDataFetcher: noopFetcher });
        registry.register('plugin-a', desc);

        const snapshot = registry.snapshot();
        const record = snapshot.groups[0].types[0];

        expect(record.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
});

describe('PluginWidgetTypes facade', () => {
    let logger: MockLogger;
    let registry: WidgetTypeRegistry;

    beforeEach(() => {
        __resetKnownWidgetTypesForTests();
        logger = new MockLogger();
        registry = new WidgetTypeRegistry(logger);
    });

    it('tags type declarations with the plugin id', () => {
        const facade = new PluginWidgetTypes('plugin-x', registry, logger);

        facade.register({
            id: 'test.facade-tagged',
            label: 'Tagged',
            description: '',
            defaultDataFetcher: noopFetcher
        });

        expect(registry.snapshot().groups[0].pluginId).toBe('plugin-x');
    });

    it('refuses to register after seal()', () => {
        const facade = new PluginWidgetTypes('plugin-x', registry, logger);
        facade.seal();

        expect(() => facade.register({
            id: 'test.after-seal',
            label: '',
            description: '',
            defaultDataFetcher: noopFetcher
        })).toThrow(/lifecycle window closed/);
    });

    it('seal() is idempotent and does not dispose registrations', () => {
        const facade = new PluginWidgetTypes('plugin-x', registry, logger);
        facade.register({
            id: 'test.survives-seal',
            label: 'S',
            description: '',
            defaultDataFetcher: noopFetcher
        });
        facade.seal();
        facade.seal();

        expect(registry.has('test.survives-seal')).toBe(true);
    });

    it('closeAndDisposeAll() drops every type the facade owns', () => {
        const facade = new PluginWidgetTypes('plugin-x', registry, logger);
        facade.register({ id: 'test.bulk-1', label: '1', description: '', defaultDataFetcher: noopFetcher });
        facade.register({ id: 'test.bulk-2', label: '2', description: '', defaultDataFetcher: noopFetcher });

        const removed = facade.closeAndDisposeAll();

        expect(removed).toBe(2);
        expect(registry.has('test.bulk-1')).toBe(false);
        expect(registry.has('test.bulk-2')).toBe(false);
    });
});

describe('Plugin re-enable cycle', () => {
    let logger: MockLogger;
    let registry: WidgetTypeRegistry;

    beforeEach(() => {
        __resetKnownWidgetTypesForTests();
        logger = new MockLogger();
        registry = new WidgetTypeRegistry(logger);
    });

    it('lets a plugin re-declare types after disposeForPlugin clears them', () => {
        const facade = new PluginWidgetTypes('plugin-x', registry, logger);
        facade.register({
            id: 'test.re-enable',
            label: 'Re-enable',
            description: '',
            defaultDataFetcher: noopFetcher
        });
        expect(registry.has('test.re-enable')).toBe(true);

        facade.closeAndDisposeAll();
        registry.disposeForPlugin('plugin-x');

        const reFacade = new PluginWidgetTypes('plugin-x', registry, logger);
        expect(() => reFacade.register({
            id: 'test.re-enable',
            label: 'Re-enable',
            description: '',
            defaultDataFetcher: noopFetcher
        })).not.toThrow();
        expect(registry.has('test.re-enable')).toBe(true);
    });

    it('exports forgetWidgetType as a primitive', () => {
        defineWidgetType({
            id: 'test.manual-forget',
            label: 'M',
            description: '',
            defaultDataFetcher: noopFetcher
        });

        expect(forgetWidgetType('test.manual-forget')).toBe(true);
        expect(forgetWidgetType('test.manual-forget')).toBe(false);
        expect(listKnownWidgetTypes().map(d => d.id)).not.toContain('test.manual-forget');
    });
});
