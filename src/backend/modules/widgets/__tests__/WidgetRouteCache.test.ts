/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for WidgetRouteCache.
 *
 * The cache sits between every SSR page render and widget resolution, so a
 * mistake here either repeats the expensive work it exists to avoid or
 * serves stale placements after an operator edit. These tests pin the
 * expiry, request sharing, clearing, error, copy, and size-cap behaviour
 * using an injected clock and a stub resolver, with no MongoDB involved.
 *
 * @module backend/modules/widgets/__tests__/WidgetRouteCache.test
 */

import { describe, it, expect, vi } from 'vitest';
import type { IWidgetData } from '@/types';
import { WidgetRouteCache } from '../placements/WidgetRouteCache.js';

/**
 * Build a minimal widget payload so assertions can tell resolutions apart.
 *
 * @param label - Value placed in the widget's data to identify which
 *   resolution produced it.
 * @returns A one-widget result as the resolver would return it.
 */
function widgetsLabelled(label: string): IWidgetData[] {
    return [{ id: 'test:widget', zone: 'main-after', pluginId: 'test', order: 1, data: { label } }];
}

/**
 * Build a clock the test advances by hand, so expiry can be checked
 * without real waiting.
 *
 * @returns The clock function to inject and an `advance` helper.
 */
function manualClock(): { now: () => number; advance: (ms: number) => void } {
    let current = 1_000_000;
    return {
        now: () => current,
        advance: (ms: number) => {
            current += ms;
        }
    };
}

/**
 * Build a promise the test settles by hand, to hold a resolution open
 * while other calls arrive.
 *
 * @returns The promise plus its resolve and reject functions.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('WidgetRouteCache', () => {
    it('serves a stored result until it expires', async () => {
        const clock = manualClock();
        const cache = new WidgetRouteCache(5000, 10, clock.now);
        const resolve = vi.fn(async () => widgetsLabelled('first'));

        await cache.get('/', {}, resolve);
        clock.advance(4999);
        await cache.get('/', {}, resolve);
        expect(resolve).toHaveBeenCalledTimes(1);

        clock.advance(1);
        await cache.get('/', {}, resolve);
        expect(resolve).toHaveBeenCalledTimes(2);
    });

    it('shares one resolution between concurrent calls for the same route', async () => {
        const cache = new WidgetRouteCache();
        const pending = deferred<IWidgetData[]>();
        const resolve = vi.fn(() => pending.promise);

        const first = cache.get('/', {}, resolve);
        const second = cache.get('/', {}, resolve);
        pending.resolve(widgetsLabelled('shared'));

        await expect(first).resolves.toEqual(widgetsLabelled('shared'));
        await expect(second).resolves.toEqual(widgetsLabelled('shared'));
        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('keys on route and params, ignoring param order', async () => {
        const cache = new WidgetRouteCache();
        const resolve = vi.fn(async () => widgetsLabelled('x'));

        await cache.get('/a', { slug: 'one', page: '2' }, resolve);
        await cache.get('/a', { page: '2', slug: 'one' }, resolve);
        expect(resolve).toHaveBeenCalledTimes(1);

        await cache.get('/a', { slug: 'two', page: '2' }, resolve);
        await cache.get('/b', { slug: 'one', page: '2' }, resolve);
        expect(resolve).toHaveBeenCalledTimes(3);
    });

    it('resolves again after clear()', async () => {
        const cache = new WidgetRouteCache();
        const resolve = vi.fn(async () => widgetsLabelled('x'));

        await cache.get('/', {}, resolve);
        cache.clear();
        await cache.get('/', {}, resolve);
        expect(resolve).toHaveBeenCalledTimes(2);
    });

    it('does not store a resolution that was running when clear() was called', async () => {
        const cache = new WidgetRouteCache();
        const beforeSave = deferred<IWidgetData[]>();
        const resolve = vi
            .fn<() => Promise<IWidgetData[]>>()
            .mockReturnValueOnce(beforeSave.promise)
            .mockResolvedValueOnce(widgetsLabelled('after-save'));

        const running = cache.get('/', {}, resolve);
        cache.clear();
        beforeSave.resolve(widgetsLabelled('before-save'));
        await expect(running).resolves.toEqual(widgetsLabelled('before-save'));

        await expect(cache.get('/', {}, resolve)).resolves.toEqual(widgetsLabelled('after-save'));
        expect(resolve).toHaveBeenCalledTimes(2);
    });

    it('does not store a failed resolution', async () => {
        const cache = new WidgetRouteCache();
        const resolve = vi
            .fn<() => Promise<IWidgetData[]>>()
            .mockRejectedValueOnce(new Error('mongo down'))
            .mockResolvedValueOnce(widgetsLabelled('recovered'));

        await expect(cache.get('/', {}, resolve)).rejects.toThrow('mongo down');
        await expect(cache.get('/', {}, resolve)).resolves.toEqual(widgetsLabelled('recovered'));
        expect(resolve).toHaveBeenCalledTimes(2);
    });

    it('gives each caller its own copy', async () => {
        const cache = new WidgetRouteCache();
        const resolve = vi.fn(async () => widgetsLabelled('original'));

        const first = await cache.get('/', {}, resolve);
        first[0].data = { label: 'changed by caller' };
        first.push(widgetsLabelled('extra')[0]);

        await expect(cache.get('/', {}, resolve)).resolves.toEqual(widgetsLabelled('original'));
    });

    it('drops the oldest route when full', async () => {
        const cache = new WidgetRouteCache(5000, 2);
        const resolve = vi.fn(async () => widgetsLabelled('x'));

        await cache.get('/one', {}, resolve);
        await cache.get('/two', {}, resolve);
        await cache.get('/three', {}, resolve);
        expect(resolve).toHaveBeenCalledTimes(3);

        await cache.get('/three', {}, resolve);
        await cache.get('/two', {}, resolve);
        expect(resolve).toHaveBeenCalledTimes(3);

        await cache.get('/one', {}, resolve);
        expect(resolve).toHaveBeenCalledTimes(4);
    });
});
