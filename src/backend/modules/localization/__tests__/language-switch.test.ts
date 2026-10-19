/**
 * @fileoverview Behaviour tests for the language switch counter: which
 * switcher clicks are counted, what they are counted against, and how the
 * stats read folds the daily counters for the Switches tab.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ILocalizationPublicConfig } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { LanguageSwitchService, MAX_SWITCH_STATS_DAYS } from '../services/language-switch.service.js';
import { SWITCH_DAILY_COLLECTION } from '../database/index.js';

/** A snapshot with Chinese live on the blog and Spanish enabled but published nowhere. */
const CONFIG: ILocalizationPublicConfig = {
    defaultLanguage: 'en',
    languages: [
        { code: 'es', name: 'Spanish', nativeName: 'Español', direction: 'ltr' },
        { code: 'zh', name: 'Chinese', nativeName: '中文', direction: 'ltr' }
    ],
    routes: [{ pattern: '/blog/*', languages: ['zh'] }]
};

/** A fixed moment so every test lands on the same UTC day. */
const NOW = new Date('2026-10-19T12:00:00.000Z');

describe('LanguageSwitchService', () => {
    let db: ReturnType<typeof createMockDatabaseService>;
    let service: LanguageSwitchService;

    beforeEach(() => {
        db = createMockDatabaseService();
        service = new LanguageSwitchService({
            database: db,
            localization: { getPublicConfig: async () => CONFIG }
        });
    });

    it('counts a switch against the route pattern that publishes the page', async () => {
        expect(await service.record({ path: '/blog/hello', from: 'en', to: 'zh' }, NOW)).toBe(true);
        expect(await service.record({ path: '/blog/hello', from: 'en', to: 'zh' }, NOW)).toBe(true);

        const rows = db.getCollectionData(SWITCH_DAILY_COLLECTION);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ day: '2026-10-19', from: 'en', to: 'zh', pattern: '/blog/*', count: 2 });
    });

    it('counts a switch back to English against the route the visitor left', async () => {
        expect(await service.record({ path: '/blog/hello', from: 'zh', to: 'en' }, NOW)).toBe(true);
        expect(db.getCollectionData(SWITCH_DAILY_COLLECTION)[0]).toMatchObject({ from: 'zh', to: 'en', pattern: '/blog/*' });
    });

    it('drops the query string and fragment before matching the path', async () => {
        expect(await service.record({ path: '/blog/hello?utm_source=x#top', from: 'en', to: 'zh' }, NOW)).toBe(true);
    });

    it('ignores clicks that are not a real switch on that page', async () => {
        // Same language, automation, a language published nowhere, a disabled
        // language, a path no route covers, and malformed bodies.
        const rejected: unknown[] = [
            { path: '/blog/hello', from: 'zh', to: 'zh' },
            { path: '/blog/hello', from: 'en', to: 'zh', automated: true },
            { path: '/blog/hello', from: 'en', to: 'es' },
            { path: '/blog/hello', from: 'en', to: 'fr' },
            { path: '/markets', from: 'en', to: 'zh' },
            { path: 'blog/hello', from: 'en', to: 'zh' },
            { path: '/blog/hello', from: 'EN', to: 'zh' },
            null,
            'en-zh'
        ];
        for (const body of rejected) {
            expect(await service.record(body, NOW)).toBe(false);
        }
        expect(db.getCollectionData(SWITCH_DAILY_COLLECTION)).toHaveLength(0);
    });

    it('summarises a window with every day present and the busiest entries first', async () => {
        const rows = db.getCollectionData(SWITCH_DAILY_COLLECTION);
        rows.push(
            { day: '2026-10-19', from: 'en', to: 'zh', pattern: '/blog/*', count: 3 },
            { day: '2026-10-17', from: 'en', to: 'zh', pattern: '/markets', count: 2 },
            { day: '2026-10-17', from: 'zh', to: 'en', pattern: '/blog/*', count: 4 },
            // Outside a three-day window.
            { day: '2026-10-16', from: 'en', to: 'zh', pattern: '/blog/*', count: 50 }
        );

        const stats = await service.getStats(3, NOW);

        expect(stats.days).toBe(3);
        expect(stats.windowStart).toBe('2026-10-17');
        expect(stats.windowEnd).toBe('2026-10-19');
        expect(stats.total).toBe(9);
        expect(stats.byDay).toEqual([
            { day: '2026-10-17', count: 6 },
            { day: '2026-10-18', count: 0 },
            { day: '2026-10-19', count: 3 }
        ]);
        expect(stats.byPair).toEqual([
            { from: 'en', to: 'zh', count: 5 },
            { from: 'zh', to: 'en', count: 4 }
        ]);
        expect(stats.byRoute).toEqual([
            { pattern: '/blog/*', count: 7 },
            { pattern: '/markets', count: 2 }
        ]);
    });

    it('clamps the window to between one day and the maximum', async () => {
        expect((await service.getStats(0, NOW)).byDay).toHaveLength(1);
        expect((await service.getStats(10_000, NOW)).days).toBe(MAX_SWITCH_STATS_DAYS);
    });
});
