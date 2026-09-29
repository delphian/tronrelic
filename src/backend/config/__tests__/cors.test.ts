/**
 * @file cors.test.ts
 *
 * Pins which origins may make credentialed requests and open WebSocket
 * connections. The localhost development ports used to be allowed in every
 * environment, so in production any page served from a visitor's own machine
 * could act as that visitor; they are now added only outside production.
 */

import { describe, it, expect } from 'vitest';
import { getAllowedOrigins } from '../cors.js';

describe('getAllowedOrigins', () => {
    it('allows localhost ports outside production', () => {
        const origins = getAllowedOrigins({ SITE_URL: 'http://localhost:3000', NODE_ENV: 'development', ENV: 'development' });

        expect(origins).toContain('http://localhost:3000');
        expect(origins).toContain('http://localhost:4000');
    });

    it.each([
        ['NODE_ENV', { NODE_ENV: 'production' as const, ENV: 'development' as const }],
        ['ENV', { NODE_ENV: 'development' as const, ENV: 'production' as const }]
    ])('drops localhost in production when %s says so, keeping the site and its www variant', (_label, flags) => {
        const origins = getAllowedOrigins({ SITE_URL: 'https://tronrelic.com', ...flags });

        expect(origins).toEqual(['https://tronrelic.com', 'https://www.tronrelic.com']);
    });
});
