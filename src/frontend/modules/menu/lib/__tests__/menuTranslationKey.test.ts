/// <reference types="vitest" />

/**
 * Translation key tests for menu item labels and descriptions.
 *
 * The key must stay the same across backend restarts, so it comes from the
 * item's URL rather than its id, and it must match the format the backend's
 * observation intake accepts, or every menu key would be refused.
 */

import { describe, it, expect } from 'vitest';
import { menuTranslationKey } from '../menuTranslationKey';

/** The key format `POST /api/localization/observations` accepts. */
const BACKEND_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

describe('menuTranslationKey', () => {
    it('keys an item with a URL by namespace and URL, never by label', () => {
        const key = menuTranslationKey('main', { url: '/resource-markets', label: 'Markets' });
        expect(key).toBe('menu.main.url::resource-markets');
        expect(menuTranslationKey('main', { url: '/resource-markets', label: 'Energy Markets' })).toBe(key);
    });

    it('keeps the namespace in the key so two menus can label one URL differently', () => {
        expect(menuTranslationKey('footer', { url: '/about', label: 'About' }))
            .not.toBe(menuTranslationKey('main', { url: '/about', label: 'About' }));
    });

    it('keeps URLs that differ only by slash and underscore apart', () => {
        expect(menuTranslationKey('main', { url: '/a/b', label: 'X' }))
            .not.toBe(menuTranslationKey('main', { url: '/a_b', label: 'X' }));
    });

    it('falls back to the label for an item with no URL', () => {
        expect(menuTranslationKey('main', { label: ' Tools ' })).toBe('menu.main.label:tools');
    });

    it('gives the description its own key beside the label key', () => {
        const node = { url: '/tools', label: 'Tools' };
        expect(menuTranslationKey('main', node, 'description')).toBe('menu.main.url::tools.description');
    });

    it('keeps the description suffix when a long URL hits the length cap', () => {
        const node = { url: `/${'x'.repeat(400)}`, label: 'Long' };
        const labelKey = menuTranslationKey('main', node);
        const descriptionKey = menuTranslationKey('main', node, 'description');
        expect(descriptionKey.endsWith('.description')).toBe(true);
        expect(descriptionKey).not.toBe(labelKey);
    });

    it('produces keys the backend accepts for query strings, spaces, non-Latin text, and long URLs', () => {
        const nodes = [
            { url: '/system/widgets?tab=placements', label: 'Placements' },
            { url: 'https://example.com/a b', label: 'External' },
            { label: '工具' },
            { url: `/${'x'.repeat(400)}`, label: 'Long' }
        ];
        for (const node of nodes) {
            expect(menuTranslationKey('main', node)).toMatch(BACKEND_KEY_PATTERN);
            expect(menuTranslationKey('main', node, 'description')).toMatch(BACKEND_KEY_PATTERN);
        }
    });
});
