/**
 * Contract tests for safe-plugin-load.
 *
 * The generated backend registry calls loadFromPluginLoaders to materialize
 * every discovered plugin without letting one broken plugin crash the rest of
 * startup. These tests pin the failure-isolation behavior so it cannot
 * silently regress.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IPlugin } from '@/types';
import {
    loadFromPluginLoaders,
    isMinimalIPlugin,
    type IPluginLoadFailure
} from '../safe-plugin-load';

function pluginWith(id: string): IPlugin {
    return {
        manifest: {
            id,
            title: `Plugin ${id}`,
            version: '1.0.0',
            description: 'test'
        }
    } as IPlugin;
}

describe('isMinimalIPlugin', () => {
    it('accepts a minimum-valid plugin', () => {
        expect(isMinimalIPlugin(pluginWith('ok'))).toBe(true);
    });

    it('rejects null', () => {
        expect(isMinimalIPlugin(null)).toBe(false);
    });

    it('rejects undefined', () => {
        expect(isMinimalIPlugin(undefined)).toBe(false);
    });

    it('rejects an object with no manifest', () => {
        expect(isMinimalIPlugin({})).toBe(false);
    });

    it('rejects a manifest with empty id', () => {
        expect(isMinimalIPlugin({ manifest: { id: '', title: 'x' } })).toBe(false);
    });

    it('rejects a non-string id', () => {
        expect(isMinimalIPlugin({ manifest: { id: 42, title: 'x' } })).toBe(false);
    });
});

describe('loadFromPluginLoaders', () => {
    it('returns every successfully-loaded plugin in input order', async () => {
        const a = pluginWith('a');
        const b = pluginWith('b');
        const result = await loadFromPluginLoaders(
            [() => Promise.resolve(a), () => Promise.resolve(b)],
            () => undefined
        );
        expect(result.map(p => p.manifest.id)).toEqual(['a', 'b']);
    });

    it('drops a loader whose promise rejects', async () => {
        const a = pluginWith('a');
        const failures: IPluginLoadFailure[] = [];
        const result = await loadFromPluginLoaders(
            [
                () => Promise.resolve(a),
                () => Promise.reject(new Error('boom')),
                () => Promise.resolve(pluginWith('c'))
            ],
            f => failures.push(f)
        );
        expect(result.map(p => p.manifest.id)).toEqual(['a', 'c']);
        expect(failures).toHaveLength(1);
        expect(failures[0].index).toBe(1);
        expect((failures[0].reason as Error).message).toBe('boom');
    });

    it('drops a loader that resolves to a malformed value', async () => {
        const failures: IPluginLoadFailure[] = [];
        const result = await loadFromPluginLoaders(
            [
                () => Promise.resolve(pluginWith('ok')),
                () => Promise.resolve(undefined),
                () => Promise.resolve({ manifest: null }),
                () => Promise.resolve({ manifest: { id: '' } })
            ],
            f => failures.push(f)
        );
        expect(result.map(p => p.manifest.id)).toEqual(['ok']);
        expect(failures.map(f => f.index)).toEqual([1, 2, 3]);
    });

    it('logs to console.error when no onFailure callback is provided', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const result = await loadFromPluginLoaders([
                () => Promise.resolve(pluginWith('ok')),
                () => Promise.reject(new Error('nope'))
            ]);
            expect(result.map(p => p.manifest.id)).toEqual(['ok']);
            expect(errorSpy).toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('returns empty array when every loader fails', async () => {
        const failures: IPluginLoadFailure[] = [];
        const result = await loadFromPluginLoaders(
            [
                () => Promise.reject(new Error('a')),
                () => Promise.reject(new Error('b'))
            ],
            f => failures.push(f)
        );
        expect(result).toEqual([]);
        expect(failures).toHaveLength(2);
    });

    it('returns empty array on empty input', async () => {
        const result = await loadFromPluginLoaders([], () => undefined);
        expect(result).toEqual([]);
    });
});
