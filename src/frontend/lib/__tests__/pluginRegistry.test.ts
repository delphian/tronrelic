/**
 * Plugin registry contract tests.
 *
 * Locks in the failure-isolation guarantees that the x-poster widget rollout
 * exposed as missing — a single malformed plugin module used to take down
 * SSR for every route. These tests assert the registry skips bad entries
 * with a logged error instead of throwing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IPlugin } from '@/types';
import { pluginRegistry } from '../pluginRegistry';

function makePlugin(id: string, overrides: Partial<IPlugin> = {}): IPlugin {
    return {
        manifest: {
            id,
            title: `Plugin ${id}`,
            version: '1.0.0',
            description: 'test plugin'
        },
        ...overrides
    } as IPlugin;
}

describe('pluginRegistry.bootstrap failure isolation', () => {
    let errorSpy: ReturnType<typeof vi.fn<typeof console.error>>;

    beforeEach(() => {
        pluginRegistry.clear();
        errorSpy = vi.fn<typeof console.error>();
        vi.spyOn(console, 'error').mockImplementation(errorSpy);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        pluginRegistry.clear();
    });

    it('registers a well-formed plugin', () => {
        const plugin = makePlugin('good', {
            menuItems: [{ label: 'Good', href: '/good', order: 10 }]
        });
        pluginRegistry.bootstrap([plugin]);
        expect(pluginRegistry.getAllPlugins()).toHaveLength(1);
        expect(pluginRegistry.getMenuItems()).toHaveLength(1);
    });

    it('skips a plugin with no manifest and continues with the rest', () => {
        const good = makePlugin('good');
        const broken = { menuItems: [{ label: 'oops', href: '/x' }] } as unknown as IPlugin;
        pluginRegistry.bootstrap([good, broken]);
        expect(pluginRegistry.getAllPlugins().map(p => p.manifest.id)).toEqual(['good']);
        expect(errorSpy).toHaveBeenCalled();
    });

    it('skips undefined entries instead of throwing on .menuItems access', () => {
        const good = makePlugin('good');
        // Simulates the exact regression: a generated registry that
        // produced `undefined` at one index. The bug used to crash here.
        const plugins = [good, undefined as unknown as IPlugin];
        expect(() => pluginRegistry.bootstrap(plugins)).not.toThrow();
        expect(pluginRegistry.getAllPlugins()).toHaveLength(1);
        expect(errorSpy).toHaveBeenCalled();
    });

    it('skips a plugin whose manifest id is empty', () => {
        const broken = makePlugin('');
        const good = makePlugin('good');
        pluginRegistry.bootstrap([broken, good]);
        expect(pluginRegistry.getAllPlugins().map(p => p.manifest.id)).toEqual(['good']);
        expect(errorSpy).toHaveBeenCalled();
    });

    it('isolates a plugin whose menuItems iterator throws', () => {
        const good = makePlugin('good');
        const throwy = makePlugin('throwy');
        Object.defineProperty(throwy, 'menuItems', {
            get() {
                throw new Error('exploded');
            }
        });
        expect(() => pluginRegistry.bootstrap([good, throwy])).not.toThrow();
        // The good plugin still registers; the throwy one is dropped.
        expect(pluginRegistry.getAllPlugins().map(p => p.manifest.id)).toEqual(['good']);
        expect(errorSpy).toHaveBeenCalled();
    });
});
