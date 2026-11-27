/// <reference types="vitest" />

/**
 * Breadcrumb structured data tests. Positions must start at 1 and follow the
 * trail's order, which is what Google reads to draw the trail.
 */

import { describe, it, expect } from 'vitest';
import { buildBreadcrumbStructuredData } from '../buildBreadcrumbStructuredData';

describe('buildBreadcrumbStructuredData', () => {
    it('numbers each step from 1 in trail order', () => {
        const data = buildBreadcrumbStructuredData([
            { name: 'Home', url: 'https://tronrelic.com' },
            { name: 'Tools', url: 'https://tronrelic.com/tools' },
            { name: 'Whale Tracker', url: 'https://tronrelic.com/tools/whales' }
        ]);

        expect(data).toEqual({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            'itemListElement': [
                { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://tronrelic.com' },
                { '@type': 'ListItem', 'position': 2, 'name': 'Tools', 'item': 'https://tronrelic.com/tools' },
                { '@type': 'ListItem', 'position': 3, 'name': 'Whale Tracker', 'item': 'https://tronrelic.com/tools/whales' }
            ]
        });
    });

    it('writes nothing for a trail shorter than two steps', () => {
        expect(buildBreadcrumbStructuredData([])).toBeNull();
        expect(buildBreadcrumbStructuredData([{ name: 'Home', url: 'https://tronrelic.com' }])).toBeNull();
    });
});
