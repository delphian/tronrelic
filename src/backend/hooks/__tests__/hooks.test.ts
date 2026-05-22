/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the backend hook system.
 *
 * Covers the four invocation archetypes (observer / series / waterfall /
 * bail), descriptor declaration enforcement, per-plugin handler caps,
 * priority and tie-break ordering, the plugin-scoped facade's lifecycle
 * window, and the introspection snapshot. The shared mock logger mirrors
 * the one used in `service-registry.test.ts` so the conventions stay
 * consistent across the registry pair.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService } from '@/types';
import { HookAbortError } from '@/types';
import {
    HookRegistry,
    PluginHooks,
    HOOKS,
    defineHook,
    isKnownDescriptor,
    listKnownDescriptors,
    invokeObserver,
    invokeSeries,
    invokeWaterfall,
    invokeBail,
    invokeHook
} from '../index.js';
import { __resetKnownDescriptorsForTests } from '../define-hook.js';

/**
 * Minimal `ISystemLogService` implementation for assertions on warn /
 * info / debug call sites without booting the real Pino-backed logger.
 * Mirrors the mock used by `service-registry.test.ts` so the shape stays
 * consistent across the registry pair.
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

describe('defineHook', () => {
    beforeEach(() => __resetKnownDescriptorsForTests());

    it('produces a frozen descriptor tracked by the runtime', () => {
        const desc = defineHook<{ a: number }, void, 'observer'>({
            id: 'test.alpha',
            kind: 'observer',
            phase: 'ssr.page',
            order: 10,
            description: 'alpha'
        });

        expect(desc.id).toBe('test.alpha');
        expect(Object.isFrozen(desc)).toBe(true);
        expect(isKnownDescriptor(desc)).toBe(true);
        expect(listKnownDescriptors().map(d => d.id)).toEqual(['test.alpha']);
    });

    it('rejects duplicate ids', () => {
        defineHook<{ a: number }, void, 'observer'>({
            id: 'test.dup',
            kind: 'observer',
            phase: 'ssr.page',
            order: 10,
            description: 'first'
        });
        expect(() => defineHook<{ a: number }, void, 'observer'>({
            id: 'test.dup',
            kind: 'observer',
            phase: 'ssr.page',
            order: 20,
            description: 'second'
        })).toThrow(/Duplicate hook descriptor id/);
    });

    it('does not consider a hand-rolled object known', () => {
        const fake = {
            id: 'test.fake', kind: 'observer', phase: 'ssr.page', order: 0, description: ''
        } as const;
        expect(isKnownDescriptor(fake as never)).toBe(false);
    });
});

describe('HookRegistry registration', () => {
    let logger: MockLogger;
    let registry: HookRegistry;

    beforeEach(() => {
        __resetKnownDescriptorsForTests();
        logger = new MockLogger();
        registry = new HookRegistry(logger);
    });

    it('rejects registration against an undeclared descriptor', () => {
        const fake = {
            id: 'test.unknown', kind: 'observer', phase: 'ssr.page', order: 0, description: ''
        } as const;
        expect(() => registry.register('plg', fake as never, (() => {}) as never)).toThrow(/was not produced by defineHook/);
    });

    it('registers a handler and returns a working disposer', async () => {
        const desc = defineHook<number, void, 'observer'>({
            id: 'test.obs', kind: 'observer', phase: 'ssr.page', order: 0, description: 'd'
        });
        const handler = vi.fn();
        const dispose = registry.register('plg', desc, handler);

        await invokeObserver(desc, registry.getHandlers(desc), 7, logger);
        expect(handler).toHaveBeenCalledWith(7);

        dispose();
        handler.mockClear();
        await invokeObserver(desc, registry.getHandlers(desc), 8, logger);
        expect(handler).not.toHaveBeenCalled();
    });

    it('enforces the per-plugin handler cap', () => {
        const desc = defineHook<number, void, 'series'>({
            id: 'test.cap', kind: 'series', phase: 'http.api', order: 0, description: 'd', maxHandlersPerPlugin: 2
        });
        registry.register('plg', desc, () => {});
        registry.register('plg', desc, () => {});
        expect(() => registry.register('plg', desc, () => {})).toThrow(/handler cap of 2/);
    });

    it('disposeForPlugin removes only that plugin\'s handlers', () => {
        const desc = defineHook<number, void, 'observer'>({
            id: 'test.bulk', kind: 'observer', phase: 'ssr.page', order: 0, description: 'd'
        });
        registry.register('plg-a', desc, () => {});
        registry.register('plg-b', desc, () => {});
        expect(registry.getHandlers(desc)).toHaveLength(2);

        const removed = registry.disposeForPlugin('plg-a');
        expect(removed).toBe(1);
        const remaining = registry.getHandlers(desc);
        expect(remaining).toHaveLength(1);
        expect(remaining[0].pluginId).toBe('plg-b');
    });
});

describe('Handler ordering', () => {
    let logger: MockLogger;
    let registry: HookRegistry;

    beforeEach(() => {
        __resetKnownDescriptorsForTests();
        logger = new MockLogger();
        registry = new HookRegistry(logger);
    });

    it('orders by priority then by registration timestamp', async () => {
        const desc = defineHook<number[], void, 'series'>({
            id: 'test.order', kind: 'series', phase: 'http.api', order: 0, description: 'd'
        });
        const trace: string[] = [];
        registry.register('plg', desc, () => { trace.push('low'); }, { priority: 50 });
        registry.register('plg', desc, () => { trace.push('mid-first'); }, { priority: 100 });
        registry.register('plg', desc, () => { trace.push('mid-second'); }, { priority: 100 });
        registry.register('plg', desc, () => { trace.push('high'); }, { priority: 10 });

        await invokeSeries(desc, registry.getHandlers(desc), [], logger);
        expect(trace).toEqual(['high', 'low', 'mid-first', 'mid-second']);
    });
});

describe('invokeObserver', () => {
    let logger: MockLogger;
    let registry: HookRegistry;

    beforeEach(() => {
        __resetKnownDescriptorsForTests();
        logger = new MockLogger();
        registry = new HookRegistry(logger);
    });

    it('runs handlers in parallel and isolates rejections', async () => {
        const desc = defineHook<number, void, 'observer'>({
            id: 'test.obs.iso', kind: 'observer', phase: 'observer.dispatch', order: 0, description: 'd'
        });
        const calls: string[] = [];
        registry.register('plg-a', desc, async () => { calls.push('a'); });
        registry.register('plg-b', desc, async () => { throw new Error('boom'); });
        registry.register('plg-c', desc, async () => { calls.push('c'); });

        await invokeObserver(desc, registry.getHandlers(desc), 1, logger);
        expect(calls.sort()).toEqual(['a', 'c']);
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ hookId: 'test.obs.iso', pluginId: 'plg-b', kind: 'observer' }),
            'Hook handler rejected'
        );
    });
});

describe('invokeSeries', () => {
    let logger: MockLogger;
    let registry: HookRegistry;

    beforeEach(() => {
        __resetKnownDescriptorsForTests();
        logger = new MockLogger();
        registry = new HookRegistry(logger);
    });

    it('runs sequentially and continues past non-abort throws', async () => {
        const desc = defineHook<string[], void, 'series'>({
            id: 'test.ser.cont', kind: 'series', phase: 'http.api', order: 0, description: 'd'
        });
        const trace: string[] = [];
        registry.register('plg', desc, () => { trace.push('one'); });
        registry.register('plg', desc, () => { throw new Error('non-abort'); });
        registry.register('plg', desc, () => { trace.push('three'); });

        await invokeSeries(desc, registry.getHandlers(desc), [], logger);
        expect(trace).toEqual(['one', 'three']);
        expect(logger.warn).toHaveBeenCalled();
    });

    it('halts the pipeline on HookAbortError and propagates it', async () => {
        const desc = defineHook<string[], void, 'series'>({
            id: 'test.ser.abort', kind: 'series', phase: 'http.api', order: 0, description: 'd'
        });
        const trace: string[] = [];
        registry.register('plg', desc, () => { trace.push('one'); });
        registry.register('plg', desc, () => { throw new HookAbortError('halt', { code: 401 }); });
        registry.register('plg', desc, () => { trace.push('three'); });

        await expect(
            invokeSeries(desc, registry.getHandlers(desc), [], logger)
        ).rejects.toBeInstanceOf(HookAbortError);
        expect(trace).toEqual(['one']);
    });
});

describe('invokeWaterfall', () => {
    let logger: MockLogger;
    let registry: HookRegistry;

    beforeEach(() => {
        __resetKnownDescriptorsForTests();
        logger = new MockLogger();
        registry = new HookRegistry(logger);
    });

    it('threads return values across handlers', async () => {
        const desc = defineHook<{ ctx: string }, ReadonlyArray<string>, 'waterfall'>({
            id: 'test.wf.thread', kind: 'waterfall', phase: 'ssr.page', order: 0, description: 'd'
        });
        registry.register('plg', desc, (_input, current) => [...current, 'one']);
        registry.register('plg', desc, (_input, current) => [...current, 'two']);

        const result = await invokeWaterfall(desc, registry.getHandlers(desc), { ctx: 'x' }, [], logger);
        expect(result).toEqual(['one', 'two']);
    });

    it('leaves the value unchanged on non-abort throws', async () => {
        const desc = defineHook<{ ctx: string }, ReadonlyArray<string>, 'waterfall'>({
            id: 'test.wf.iso', kind: 'waterfall', phase: 'ssr.page', order: 0, description: 'd'
        });
        registry.register('plg', desc, (_input, current) => [...current, 'one']);
        registry.register('plg', desc, () => { throw new Error('boom'); });
        registry.register('plg', desc, (_input, current) => [...current, 'three']);

        const result = await invokeWaterfall(desc, registry.getHandlers(desc), { ctx: 'x' }, [], logger);
        expect(result).toEqual(['one', 'three']);
        expect(logger.warn).toHaveBeenCalled();
    });
});

describe('invokeBail', () => {
    let logger: MockLogger;
    let registry: HookRegistry;

    beforeEach(() => {
        __resetKnownDescriptorsForTests();
        logger = new MockLogger();
        registry = new HookRegistry(logger);
    });

    it('returns the first non-undefined answer and skips the rest', async () => {
        const desc = defineHook<string, number, 'bail'>({
            id: 'test.bail.first', kind: 'bail', phase: 'http.api', order: 0, description: 'd'
        });
        const after = vi.fn();
        registry.register('plg', desc, () => undefined);
        registry.register('plg', desc, () => 42);
        registry.register('plg', desc, () => { after(); return 99; });

        const result = await invokeBail(desc, registry.getHandlers(desc), 'x', logger);
        expect(result).toBe(42);
        expect(after).not.toHaveBeenCalled();
    });

    it('returns undefined when no handler answers', async () => {
        const desc = defineHook<string, number, 'bail'>({
            id: 'test.bail.none', kind: 'bail', phase: 'http.api', order: 0, description: 'd'
        });
        registry.register('plg', desc, () => undefined);
        registry.register('plg', desc, () => undefined);

        const result = await invokeBail(desc, registry.getHandlers(desc), 'x', logger);
        expect(result).toBeUndefined();
    });
});

describe('invokeHook dispatch', () => {
    let logger: MockLogger;
    let registry: HookRegistry;

    beforeEach(() => {
        __resetKnownDescriptorsForTests();
        logger = new MockLogger();
        registry = new HookRegistry(logger);
    });

    it('routes by descriptor kind', async () => {
        const series = defineHook<number[], void, 'series'>({
            id: 'test.dispatch.series', kind: 'series', phase: 'http.api', order: 0, description: 'd'
        });
        const waterfall = defineHook<number, number, 'waterfall'>({
            id: 'test.dispatch.wf', kind: 'waterfall', phase: 'ssr.page', order: 0, description: 'd'
        });

        const seriesTrace: number[] = [];
        registry.register('plg', series, (acc) => { acc.push(1); });
        registry.register('plg', waterfall, (input, current) => current + input);

        await invokeHook(series, registry.getHandlers(series), seriesTrace, logger);
        expect(seriesTrace).toEqual([1]);

        const wfResult = await invokeHook(waterfall, registry.getHandlers(waterfall), 3, 10, logger);
        expect(wfResult).toBe(13);
    });

    it('HookRegistry.invoke throws when a waterfall is called without a seed', async () => {
        const wf = defineHook<number, number, 'waterfall'>({
            id: 'test.dispatch.wf-noseed', kind: 'waterfall', phase: 'ssr.page', order: 0, description: 'd'
        });
        // The overload set forbids omitting the seed for waterfall, but
        // the runtime guard exists for callers that route around
        // TypeScript (JS, `any`-typed glue, dynamic dispatch). Cast to
        // any so the type system lets the call through.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const untyped = registry.invoke as any;
        // Synchronous throw before a promise is returned — assert on the
        // throw itself, not on .rejects.
        expect(() => untyped.call(registry, wf, 0)).toThrow(/waterfall and requires a seed/);
    });
});

describe('PluginHooks facade', () => {
    let logger: MockLogger;
    let registry: HookRegistry;

    beforeEach(() => {
        __resetKnownDescriptorsForTests();
        logger = new MockLogger();
        registry = new HookRegistry(logger);
    });

    it('tags registrations with the plugin id', () => {
        const desc = defineHook<number, void, 'observer'>({
            id: 'test.facade.tag', kind: 'observer', phase: 'observer.dispatch', order: 0, description: 'd'
        });
        const facade = new PluginHooks('plg-x', registry, logger);
        facade.register(desc, () => {});

        const handlers = registry.getHandlers(desc);
        expect(handlers).toHaveLength(1);
        expect(handlers[0].pluginId).toBe('plg-x');
    });

    it('closeAndDisposeAll drops every handler the facade owns', () => {
        const desc = defineHook<number, void, 'observer'>({
            id: 'test.facade.dispose', kind: 'observer', phase: 'observer.dispatch', order: 0, description: 'd'
        });
        const facade = new PluginHooks('plg-x', registry, logger);
        facade.register(desc, () => {});
        facade.register(desc, () => {});
        expect(registry.getHandlers(desc)).toHaveLength(2);

        const count = facade.closeAndDisposeAll();
        expect(count).toBe(2);
        expect(registry.getHandlers(desc)).toHaveLength(0);
    });

    it('seal closes the lifecycle window without disposing handlers', () => {
        const desc = defineHook<number, void, 'observer'>({
            id: 'test.facade.seal', kind: 'observer', phase: 'observer.dispatch', order: 0, description: 'd'
        });
        const facade = new PluginHooks('plg-x', registry, logger);
        facade.register(desc, () => {});
        expect(registry.getHandlers(desc)).toHaveLength(1);

        facade.seal();

        // Handlers stay registered after seal — only the window flips.
        expect(registry.getHandlers(desc)).toHaveLength(1);
        // Subsequent register() throws because the window is closed.
        expect(() => facade.register(desc, () => {})).toThrow(/lifecycle window closed/);
    });

    it('refuses registration after close', () => {
        const desc = defineHook<number, void, 'observer'>({
            id: 'test.facade.closed', kind: 'observer', phase: 'observer.dispatch', order: 0, description: 'd'
        });
        const facade = new PluginHooks('plg-x', registry, logger);
        facade.closeAndDisposeAll();
        expect(() => facade.register(desc, () => {})).toThrow(/lifecycle window closed/);
    });

    it('exposes the central HOOKS registry as a readonly property', async () => {
        const { HOOKS } = await import('../registry.js');
        const facade = new PluginHooks('plg-x', registry, logger);
        expect(facade.HOOKS).toBe(HOOKS);
        expect(facade.HOOKS.ssr.headFragments.id).toBe('ssr.headFragments');
        expect(facade.HOOKS.ssr.htmlAttributes.id).toBe('ssr.htmlAttributes');
    });
});

describe('HookRegistry.snapshot', () => {
    let logger: MockLogger;
    let registry: HookRegistry;

    beforeEach(() => {
        __resetKnownDescriptorsForTests();
        logger = new MockLogger();
        registry = new HookRegistry(logger);
    });

    it('returns every declared hook organized by phase, including empty ones', () => {
        const filled = defineHook<number, void, 'observer'>({
            id: 'snap.filled', kind: 'observer', phase: 'observer.dispatch', order: 50, description: 'has handlers'
        });
        defineHook<number, void, 'series'>({
            id: 'snap.empty', kind: 'series', phase: 'http.api', order: 20, description: 'no handlers'
        });
        registry.register('plg', filled, () => {}, { priority: 30 });

        const snap = registry.snapshot();
        const tracks = Object.fromEntries(snap.tracks.map(t => [t.id, t]));
        expect(tracks['observer.dispatch'].hooks).toHaveLength(1);
        expect(tracks['observer.dispatch'].hooks[0].handlers).toHaveLength(1);
        expect(tracks['observer.dispatch'].hooks[0].handlers[0].pluginId).toBe('plg');
        expect(tracks['observer.dispatch'].hooks[0].handlers[0].priority).toBe(30);
        expect(tracks['http.api'].hooks).toHaveLength(1);
        expect(tracks['http.api'].hooks[0].handlers).toHaveLength(0);
        expect(tracks['http.api'].hooks[0].shortCircuit).toBe(true);
    });

    it('reports shortCircuit=true for every archetype that can propagate HookAbortError', () => {
        const obs = defineHook<number, void, 'observer'>({
            id: 'snap.kind.observer', kind: 'observer', phase: 'observer.dispatch', order: 10, description: 'd'
        });
        const ser = defineHook<number, void, 'series'>({
            id: 'snap.kind.series', kind: 'series', phase: 'observer.dispatch', order: 20, description: 'd'
        });
        const water = defineHook<number, number, 'waterfall'>({
            id: 'snap.kind.waterfall', kind: 'waterfall', phase: 'observer.dispatch', order: 30, description: 'd'
        });
        const bail = defineHook<number, number, 'bail'>({
            id: 'snap.kind.bail', kind: 'bail', phase: 'observer.dispatch', order: 40, description: 'd'
        });

        const snap = registry.snapshot();
        const byId = Object.fromEntries(
            snap.tracks.flatMap(t => t.hooks).map(h => [h.id, h.shortCircuit])
        );
        expect(byId[obs.id]).toBe(false);
        expect(byId[ser.id]).toBe(true);
        expect(byId[water.id]).toBe(true);
        expect(byId[bail.id]).toBe(true);
    });
});

/**
 * Structural assertions against the production HOOKS registry. These
 * tests do not depend on the runtime known-descriptor tracking (which
 * other suites reset) — they assert that the const objects exported
 * from `registry.ts` carry the expected contract fields. A change to
 * a production seam's id, kind, phase, or order is intentionally
 * caught here so consumers and the admin UI stay in sync.
 */
describe('HOOKS registry — production seams', () => {
    it('declares ssr.htmlAttributes as a waterfall under ssr.page at order 100', () => {
        expect(HOOKS.ssr.htmlAttributes.id).toBe('ssr.htmlAttributes');
        expect(HOOKS.ssr.htmlAttributes.kind).toBe('waterfall');
        expect(HOOKS.ssr.htmlAttributes.phase).toBe('ssr.page');
        expect(HOOKS.ssr.htmlAttributes.order).toBe(100);
    });

    it('declares ssr.headFragments as a waterfall under ssr.page at order 200', () => {
        expect(HOOKS.ssr.headFragments.id).toBe('ssr.headFragments');
        expect(HOOKS.ssr.headFragments.kind).toBe('waterfall');
        expect(HOOKS.ssr.headFragments.phase).toBe('ssr.page');
        expect(HOOKS.ssr.headFragments.order).toBe(200);
    });

    it('orders htmlAttributes before headFragments so the timeline matches HTML output order', () => {
        expect(HOOKS.ssr.htmlAttributes.order).toBeLessThan(HOOKS.ssr.headFragments.order);
    });
});
