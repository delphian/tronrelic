/**
 * @fileoverview Behaviour tests for the localization services: the public
 * snapshot the middleware routes on, the catalog pages render from, the admin
 * rules that keep a language from taking over existing pages, and the intake
 * of keys the frontend reports.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import type { ISystemLogService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { LocalizationService } from '../services/localization.service.js';
import { LocalizationAdminService } from '../services/localization-admin.service.js';
import { TranslationObservationService } from '../services/translation-observation.service.js';
import { LocalizationConflictError, LocalizationNotFoundError, LocalizationValidationError } from '../services/localization-errors.js';
import { KEYS_COLLECTION, LANGUAGES_COLLECTION, ROUTES_COLLECTION, TRANSLATIONS_COLLECTION } from '../database/index.js';

/**
 * Build a logger whose methods are spies, so tests can assert on warnings
 * without a backing log store.
 *
 * @returns A logger stub typed as the full service.
 */
function createLogger(): ISystemLogService {
    const logger = {
        fatal: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        child: vi.fn()
    };
    logger.child.mockReturnValue(logger);
    return logger as unknown as ISystemLogService;
}

/**
 * Store a language document directly, bypassing the admin rules, so a test can
 * start from any state.
 *
 * @param db - Mock database.
 * @param code - Language code.
 * @param enabled - Whether visitors can reach it.
 */
function seedLanguage(db: ReturnType<typeof createMockDatabaseService>, code: string, enabled: boolean): void {
    const now = new Date();
    db.getCollectionData(LANGUAGES_COLLECTION).push({
        code, name: code.toUpperCase(), nativeName: code, direction: 'ltr', enabled, createdAt: now, updatedAt: now
    });
}

/**
 * Store a key document directly.
 *
 * @param db - Mock database.
 * @param key - Key within the `core` namespace.
 * @param sourceChangedAt - When the English source last changed.
 */
function seedKey(db: ReturnType<typeof createMockDatabaseService>, key: string, sourceChangedAt: Date): void {
    db.getCollectionData(KEYS_COLLECTION).push({
        namespace: 'core', key, source: `English ${key}`, routes: ['/markets'], origin: 'observed',
        firstSeenAt: sourceChangedAt, lastSeenAt: sourceChangedAt, sourceChangedAt
    });
}

describe('LocalizationService', () => {
    let db: ReturnType<typeof createMockDatabaseService>;
    let service: LocalizationService;

    beforeEach(() => {
        LocalizationService.resetForTests();
        db = createMockDatabaseService();
        LocalizationService.setDependencies({ database: db, logger: createLogger() });
        service = LocalizationService.getInstance();
    });

    it('lists only enabled languages, and only their codes on each route', async () => {
        seedLanguage(db, 'zh', true);
        seedLanguage(db, 'ru', false);
        db.getCollectionData(ROUTES_COLLECTION).push(
            { _id: new ObjectId(), pattern: '/markets', languages: ['zh', 'ru'], updatedAt: new Date() },
            { _id: new ObjectId(), pattern: '/about', languages: ['ru'], updatedAt: new Date() }
        );

        const config = await service.getPublicConfig();

        expect(config.defaultLanguage).toBe('en');
        expect(config.languages.map(language => language.code)).toEqual(['zh']);
        // /about is published only in a disabled language, so it is not live at all.
        expect(config.routes).toEqual([{ pattern: '/markets', languages: ['zh'] }]);
    });

    it('serves an empty snapshot when nothing is configured, so the site stays English', async () => {
        await expect(service.getPublicConfig()).resolves.toEqual({ defaultLanguage: 'en', languages: [], routes: [] });
    });

    it('keeps serving the cached snapshot until invalidated', async () => {
        await service.getPublicConfig();
        seedLanguage(db, 'zh', true);
        expect((await service.getPublicConfig()).languages).toHaveLength(0);

        service.invalidate();
        expect((await service.getPublicConfig()).languages).toHaveLength(1);
    });

    it('groups a language catalog by namespace and key', async () => {
        db.getCollectionData(TRANSLATIONS_COLLECTION).push(
            { namespace: 'core', key: 'a', language: 'zh', text: '甲', updatedAt: new Date(), updatedBy: null },
            { namespace: 'trp-x', key: 'b', language: 'zh', text: '乙', updatedAt: new Date(), updatedBy: null },
            { namespace: 'core', key: 'a', language: 'ru', text: 'а', updatedAt: new Date(), updatedBy: null }
        );

        const catalog = await service.getCatalog('zh');

        expect(catalog).toEqual({ language: 'zh', entries: { core: { a: '甲' }, 'trp-x': { b: '乙' } } });
    });

    it('returns an empty catalog for the default language without reading storage', async () => {
        const find = vi.spyOn(db.getCollection(TRANSLATIONS_COLLECTION), 'find');
        await expect(service.getCatalog('en')).resolves.toEqual({ language: 'en', entries: {} });
        expect(find).not.toHaveBeenCalled();
    });

    it('translates with placeholders, falling back to the English text', async () => {
        db.getCollectionData(TRANSLATIONS_COLLECTION).push(
            { namespace: 'core', key: 'count', language: 'zh', text: '{count} 个', updatedAt: new Date(), updatedBy: null }
        );
        await expect(service.translate('core', 'count', 'zh', '{count} items', { count: 3 })).resolves.toBe('3 个');
        await expect(service.translate('core', 'other', 'zh', 'Other {name}', { name: 'x' })).resolves.toBe('Other x');
    });
});

describe('LocalizationAdminService', () => {
    let db: ReturnType<typeof createMockDatabaseService>;
    let onChange: ReturnType<typeof vi.fn<() => void>>;
    let knownPaths: string[];
    let admin: LocalizationAdminService;

    beforeEach(() => {
        db = createMockDatabaseService();
        onChange = vi.fn<() => void>();
        knownPaths = [];
        admin = new LocalizationAdminService({
            database: db,
            logger: createLogger(),
            listKnownPaths: async () => knownPaths,
            onChange
        });
    });

    it('adds a language disabled, and refuses the default language and malformed codes', async () => {
        const language = await admin.createLanguage({ code: 'zh', name: 'Chinese', nativeName: '中文' }, 'admin');
        expect(language).toMatchObject({ code: 'zh', enabled: false, direction: 'ltr' });

        await expect(admin.createLanguage({ code: 'en', name: 'English', nativeName: 'English' }, 'admin'))
            .rejects.toBeInstanceOf(LocalizationValidationError);
        await expect(admin.createLanguage({ code: 'ZH_cn', name: 'x', nativeName: 'x' }, 'admin'))
            .rejects.toBeInstanceOf(LocalizationValidationError);
    });

    it('refuses to enable a code that existing pages already use as their address', async () => {
        seedLanguage(db, 'id', false);
        knownPaths = ['/markets', '/id/verify', '/id'];

        await expect(admin.updateLanguage('id', { enabled: true }, 'admin')).rejects.toBeInstanceOf(LocalizationConflictError);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('enables a free code and clears the read-side snapshot', async () => {
        seedLanguage(db, 'zh', false);
        knownPaths = ['/markets', '/zhuyin-tools'];

        const language = await admin.updateLanguage('zh', { enabled: true }, 'admin');

        expect(language.enabled).toBe(true);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('validates route patterns and the languages a route names', async () => {
        seedLanguage(db, 'zh', true);

        await expect(admin.createRoute({ pattern: 'markets', languages: ['zh'] }, 'admin'))
            .rejects.toBeInstanceOf(LocalizationValidationError);
        await expect(admin.createRoute({ pattern: '/markets', languages: ['ru'] }, 'admin'))
            .rejects.toBeInstanceOf(LocalizationValidationError);

        const route = await admin.createRoute({ pattern: '/blog/*/', languages: ['zh', 'zh'] }, 'admin');
        expect(route).toMatchObject({ pattern: '/blog/*', languages: ['zh'] });
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('saves a translation only for a known key in a configured language', async () => {
        seedLanguage(db, 'zh', true);
        seedKey(db, 'title', new Date());

        await expect(admin.saveTranslation({ namespace: 'core', key: 'missing', language: 'zh', text: 'x' }, 'admin'))
            .rejects.toBeInstanceOf(LocalizationNotFoundError);
        await expect(admin.saveTranslation({ namespace: 'core', key: 'title', language: 'fr', text: 'x' }, 'admin'))
            .rejects.toBeInstanceOf(LocalizationNotFoundError);

        const translation = await admin.saveTranslation({ namespace: 'core', key: 'title', language: 'zh', text: '标题' }, 'admin');
        expect(translation).toMatchObject({ key: 'title', language: 'zh', text: '标题', updatedBy: 'admin' });
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('reports each key as missing, stale, or translated for a language', async () => {
        seedLanguage(db, 'zh', true);
        const earlier = new Date('2026-01-01T00:00:00Z');
        const later = new Date('2026-02-01T00:00:00Z');
        seedKey(db, 'current', earlier);
        seedKey(db, 'changed', later);
        seedKey(db, 'untranslated', earlier);
        db.getCollectionData(TRANSLATIONS_COLLECTION).push(
            { namespace: 'core', key: 'current', language: 'zh', text: '现', updatedAt: later, updatedBy: 'admin' },
            // Saved before the English source changed, so it may be out of date.
            { namespace: 'core', key: 'changed', language: 'zh', text: '旧', updatedAt: earlier, updatedBy: 'admin' }
        );

        const page = await admin.listTranslations({ language: 'zh' });
        const statusByKey = Object.fromEntries(page.rows.map(row => [row.key, row.status]));
        expect(statusByKey).toEqual({ changed: 'stale', current: 'translated', untranslated: 'missing' });

        const stale = await admin.listTranslations({ language: 'zh', status: 'stale' });
        expect(stale.total).toBe(1);

        const [summary] = await admin.listLanguages();
        expect(summary).toMatchObject({ code: 'zh', translated: 1, stale: 1, missing: 1 });
    });

    it('counts the untranslated keys rendered on each published route', async () => {
        seedLanguage(db, 'zh', true);
        seedKey(db, 'title', new Date());
        db.getCollectionData(ROUTES_COLLECTION).push(
            { _id: new ObjectId(), pattern: '/markets', languages: ['zh'], updatedAt: new Date() },
            { _id: new ObjectId(), pattern: '/about', languages: ['zh'], updatedAt: new Date() }
        );

        const routes = await admin.listRoutes();
        const byPattern = Object.fromEntries(routes.map(route => [route.pattern, route]));
        expect(byPattern['/markets']).toMatchObject({ keyCount: 1, missingByLanguage: { zh: 1 } });
        expect(byPattern['/about']).toMatchObject({ keyCount: 0, missingByLanguage: { zh: 0 } });
    });
});

describe('TranslationObservationService', () => {
    let db: ReturnType<typeof createMockDatabaseService>;
    let logger: ISystemLogService;
    let observations: TranslationObservationService;

    beforeEach(() => {
        db = createMockDatabaseService();
        logger = createLogger();
        observations = new TranslationObservationService({
            database: db,
            logger,
            listKnownNamespaces: () => ['core', 'trp-markets']
        });
    });

    it('stores a reported key with its English source and the path it was seen on', async () => {
        const result = await observations.record([
            { namespace: 'trp-markets', key: 'title', source: 'Energy Markets', path: '/markets?x=1' }
        ]);

        expect(result).toEqual({ accepted: 1, rejected: 0 });
        expect(db.getCollectionData(KEYS_COLLECTION)[0]).toMatchObject({
            namespace: 'trp-markets', key: 'title', source: 'Energy Markets', routes: ['/markets'], origin: 'observed'
        });
    });

    it('drops reports from unknown namespaces and malformed entries', async () => {
        const result = await observations.record([
            { namespace: 'not-a-plugin', key: 'title', source: 'x', path: '/' },
            { namespace: 'core', key: 'bad key!', source: 'x', path: '/' },
            { namespace: 'core', key: 'ok', source: '', path: '/' },
            { namespace: 'core', key: 'ok', source: 'x', path: 'relative' },
            'not an object'
        ]);

        expect(result).toEqual({ accepted: 0, rejected: 5 });
        expect(db.getCollectionData(KEYS_COLLECTION)).toHaveLength(0);
    });

    it('moves sourceChangedAt forward when the English text changes, so translations show as stale', async () => {
        const original = new Date('2026-01-01T00:00:00Z');
        db.getCollectionData(KEYS_COLLECTION).push({
            namespace: 'core', key: 'title', source: 'Old text', routes: [], origin: 'observed',
            firstSeenAt: original, lastSeenAt: original, sourceChangedAt: original
        });

        await observations.record([{ namespace: 'core', key: 'title', source: 'New text', path: '/' }]);

        const stored = db.getCollectionData(KEYS_COLLECTION)[0];
        expect(stored.source).toBe('New text');
        expect(stored.sourceChangedAt.getTime()).toBeGreaterThan(original.getTime());
    });

    it('logs a missing translation once per language and key', async () => {
        const report = { namespace: 'core', key: 'title', source: 'Title', path: '/markets', missingIn: 'zh' };

        await observations.record([report]);
        await observations.record([report]);
        await observations.record([{ ...report, missingIn: 'ru' }]);

        expect(logger.warn).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ language: 'zh', namespace: 'core', key: 'title' }),
            expect.stringContaining('Missing translation')
        );
    });
});
