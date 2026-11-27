/// <reference types="vitest" />

/**
 * Tool page structured data tests. The block must name the same publisher id
 * the root layout declares, and must not claim a publication date, since a
 * tool page's creation date says nothing about its content.
 */

import { describe, it, expect } from 'vitest';
import { buildWebApplicationStructuredData } from '../buildWebApplicationStructuredData';

describe('buildWebApplicationStructuredData', () => {
    it('describes the page as a WebApplication published by the site organization', () => {
        const data = buildWebApplicationStructuredData({
            siteUrl: 'https://tronrelic.com',
            title: 'TRX Whale Tracker',
            description: 'Live whale transfers.',
            path: '/zh/tools/whales',
            dateModified: '2026-11-27T00:00:00.000Z',
            image: '/images/whales.png',
            keywords: ['TRX whale tracker', 'TRON whale alert']
        });

        expect(data).toEqual({
            '@context': 'https://schema.org',
            '@type': 'WebApplication',
            'name': 'TRX Whale Tracker',
            'description': 'Live whale transfers.',
            'url': 'https://tronrelic.com/zh/tools/whales',
            'dateModified': '2026-11-27T00:00:00.000Z',
            'image': 'https://tronrelic.com/images/whales.png',
            'keywords': 'TRX whale tracker, TRON whale alert',
            'publisher': {
                '@type': 'Organization',
                '@id': 'https://tronrelic.com/#organization',
                'name': 'TronRelic',
                'url': 'https://tronrelic.com'
            }
        });
        expect(data).not.toHaveProperty('datePublished');
    });

    it('leaves out the optional fields a page does not have', () => {
        const data = buildWebApplicationStructuredData({
            siteUrl: 'https://tronrelic.com',
            title: 'Stake Calculator',
            path: '/tools/stake-calculator',
            dateModified: '2026-11-27T00:00:00.000Z'
        });

        expect(data).not.toHaveProperty('description');
        expect(data).not.toHaveProperty('image');
        expect(data).not.toHaveProperty('keywords');
    });
});
