/// <reference types="vitest" />

/**
 * Page picker option tests for `/system/widgets`.
 *
 * The picker reads the admin view of the `main` menu, which contains every
 * node. A page hidden from navigation still renders widget zones, so it must
 * be offered. A disabled node, and everything under it, must not be.
 */

import { describe, it, expect } from 'vitest';
import type { MenuNodeSerialized } from '@/shared';
import { pageOptionsFromMenu } from '../pageOptions';

/**
 * Build a menu node with the fields the picker reads, so each test states
 * only what makes its case different.
 *
 * @param overrides - Fields that differ from an enabled, shown root leaf
 * @returns A serialized menu node
 */
function node(overrides: Partial<MenuNodeSerialized>): MenuNodeSerialized {
    return { _id: overrides.url ?? 'id', label: 'Page', order: 0, enabled: true, children: [], ...overrides };
}

describe('pageOptionsFromMenu', () => {
    it('offers a hidden category and its children', () => {
        const roots = [
            node({
                url: '/tools',
                label: 'Tools',
                hidden: true,
                children: [node({ url: '/tools/converter', label: 'Converter' })]
            })
        ];

        expect(pageOptionsFromMenu(roots).map((o) => o.value)).toEqual(['/tools', '/tools/converter']);
    });

    it('skips a disabled node and everything under it', () => {
        const roots = [
            node({
                url: '/archive',
                enabled: false,
                children: [node({ url: '/archive/old' })]
            }),
            node({ url: '/markets' })
        ];

        expect(pageOptionsFromMenu(roots).map((o) => o.value)).toEqual(['/markets']);
    });
});
