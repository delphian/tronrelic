/// <reference types="vitest" />

/**
 * Tests for the widgets endpoint query shared by the server render and the
 * browser refresh of the core page zones.
 *
 * The two must ask for exactly the same bundle. If the browser left out the
 * language, a translated core page would swap its widgets for the English
 * versions on the first in-page navigation.
 */

import { describe, it, expect } from 'vitest';
import { widgetsRequestPath } from '../widgetsRequestPath';

describe('widgetsRequestPath', () => {
    it('encodes the route and adds nothing else for an English page with no params', () => {
        expect(widgetsRequestPath('/tools', {}, 'en')).toBe('/widgets?route=%2Ftools');
        expect(widgetsRequestPath('/tools', {}, null)).toBe('/widgets?route=%2Ftools');
    });

    it('adds the language for a translated page', () => {
        expect(widgetsRequestPath('/tools', {}, 'zh')).toBe('/widgets?route=%2Ftools&language=zh');
    });

    it('adds route params as encoded JSON when there are any', () => {
        expect(widgetsRequestPath('/about', { slug: 'about' }, 'en'))
            .toBe(`/widgets?route=%2Fabout&params=${encodeURIComponent('{"slug":"about"}')}`);
    });
});
