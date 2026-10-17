/// <reference types="vitest" />

/**
 * Active-link tests for the tab bar and its Menu panel.
 *
 * A section link has to stay marked on the pages beneath it, while the home
 * link and look-alike paths must not be marked by accident, or the tab bar
 * would highlight two tabs at once.
 */

import { describe, it, expect } from 'vitest';
import { isMenuPathActive } from '../isMenuPathActive';

describe('isMenuPathActive', () => {
    it('marks a section link on the section and on the pages beneath it', () => {
        expect(isMenuPathActive('/resource-markets', '/resource-markets', false)).toBe(true);
        expect(isMenuPathActive('/resource-markets/sohu', '/resource-markets', false)).toBe(true);
    });

    it('does not mark a link whose path is only a prefix of the current path', () => {
        expect(isMenuPathActive('/resource-markets-archive', '/resource-markets', false)).toBe(false);
    });

    it('marks the home link on the home page only', () => {
        expect(isMenuPathActive('/', '/', true)).toBe(true);
        expect(isMenuPathActive('/resource-markets', '/', true)).toBe(false);
    });

    it('compares a localized home link exactly, so /zh does not mark every Chinese page', () => {
        expect(isMenuPathActive('/zh', '/zh', true)).toBe(true);
        expect(isMenuPathActive('/zh/resource-markets', '/zh', true)).toBe(false);
    });
});
