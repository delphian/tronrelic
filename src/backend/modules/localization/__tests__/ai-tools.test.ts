/**
 * @fileoverview Tests for the localization module's `localization-get-status`
 * AI tool.
 *
 * Three concerns matter here. The tool must stay read-only and classified so
 * the MCP safety floor admits it. Its views must report what the admin tabs
 * report, minus the fields that should never reach a model (the per-language
 * prompt text, each key's visitor-supplied path list, and who saved a
 * translation). And every argument the model sends must be re-validated, with
 * an error the model can correct from rather than a silent fallback.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IAiTool, IAiToolRegistry, IServiceRegistry, ISystemLogService } from '@/types';
import { AI_TOOL_NAMES, PROVIDER_ID, buildLocalizationStatusTool, registerLocalizationAiTools } from '../ai-tools.js';
import type { ILocalizationToolReads } from '../ai-tools.js';

/**
 * Build read stubs returning one recognizable language, route, key, and
 * switch summary, so a view that calls the wrong read fails on its shape.
 *
 * @returns Stubbed reads, each a spy.
 */
function createReads() {
    return {
        listLanguages: vi.fn(async () => [{
            code: 'zh',
            name: 'Chinese (Simplified)',
            nativeName: '简体中文',
            direction: 'ltr' as const,
            translationPrompt: 'TRON is always 波场',
            enabled: true,
            createdAt: '2026-09-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
            translated: 900,
            stale: 12,
            missing: 300,
            publishedRoutes: { translated: 850, stale: 5, missing: 15 }
        }]),
        listRoutes: vi.fn(async () => [{
            id: '6a0000000000000000000001',
            pattern: '/resource-markets/*',
            languages: ['zh', 'vi'],
            updatedAt: '2026-10-01T00:00:00.000Z',
            keyCount: 420,
            missingByLanguage: { zh: 3, vi: 120 }
        }]),
        listTranslations: vi.fn(async (_query: unknown) => ({
            total: 1,
            rows: [{
                namespace: 'core',
                key: 'widgets.rawHtml.copyright',
                source: 'x'.repeat(400),
                routes: ['/address/visitor-supplied-path'],
                origin: 'observed' as const,
                firstSeenAt: '2026-09-01T00:00:00.000Z',
                lastSeenAt: '2026-11-01T00:00:00.000Z',
                sourceChangedAt: '2026-09-01T00:00:00.000Z',
                language: 'zh',
                translation: null,
                status: 'missing' as const
            }]
        })),
        getSwitchStats: vi.fn(async (days: number) => ({
            days,
            windowStart: '2026-10-03',
            windowEnd: '2026-11-01',
            total: 4,
            byDay: [],
            byPair: [],
            byRoute: []
        })),
        getPublicConfig: vi.fn(async () => ({
            defaultLanguage: 'en',
            languages: [],
            routes: [
                { pattern: '/resource-markets/*', languages: ['zh', 'vi'] },
                { pattern: '/about', languages: ['zh'] }
            ]
        }))
    };
}

describe('localization AI tool', () => {
    let reads: ReturnType<typeof createReads>;
    let tool: IAiTool;

    beforeEach(() => {
        reads = createReads();
        tool = buildLocalizationStatusTool(reads as unknown as ILocalizationToolReads);
    });

    describe('classification', () => {
        it('is named after the module and classified as a free, reversible, non-secret read', () => {
            // Those four properties are what the MCP safety floor checks, so a
            // change to any of them changes who the tool can be granted to.
            expect(tool.name).toBe(AI_TOOL_NAMES.status);
            expect(tool.name.startsWith('localization-')).toBe(true);
            expect(tool.capability?.sideEffect).toBe('read');
            expect(tool.capability?.reversible).toBe(true);
            expect(tool.capability?.spendsMoney).toBeFalsy();
            expect(tool.capability?.sensitivity).toBe('internal');
            expect(tool.capability?.surfacesUntrustedContent).toBe(true);
        });
    });

    describe('views', () => {
        it('defaults to languages, with both progress figures and the served route count', async () => {
            const result = await tool.handler({}) as { view: string; languages: Array<Record<string, unknown>> };
            expect(result.view).toBe('languages');
            const zh = result.languages[0]!;
            expect(zh.siteWide).toEqual({ translated: 900, stale: 12, missing: 300 });
            expect(zh.publishedRoutes).toEqual({ translated: 850, stale: 5, missing: 15 });
            expect(zh.servedRoutes).toBe(2);
            // The prompt text is operator guidance for the Suggest buttons;
            // only whether one exists is reported.
            expect(zh.hasTranslationPrompt).toBe(true);
            expect(zh).not.toHaveProperty('translationPrompt');
        });

        it('pages the routes view and reports the whole inventory size', async () => {
            const result = await tool.handler({ view: 'routes', limit: 1 }) as { total: number; hasMore: boolean; routes: unknown[] };
            expect(result.total).toBe(1);
            expect(result.hasMore).toBe(false);
            expect(result.routes).toHaveLength(1);
        });

        it('passes the requested window to the switch statistics', async () => {
            const result = await tool.handler({ view: 'switches', days: 7 }) as { days: number; total: number };
            expect(reads.getSwitchStats).toHaveBeenCalledWith(7);
            expect(result.total).toBe(4);
        });

        it('passes key filters through and strips path lists and long text', async () => {
            const result = await tool.handler({
                view: 'keys',
                language: 'zh',
                status: 'missing',
                route: '/resource-markets/*',
                namespace: 'resource-markets',
                limit: 10
            }) as { keys: Array<Record<string, unknown>> };

            expect(reads.listTranslations).toHaveBeenCalledWith({
                language: 'zh',
                status: 'missing',
                route: '/resource-markets/*',
                namespace: 'resource-markets',
                limit: 10,
                offset: 0
            });
            const row = result.keys[0]!;
            // A key's reported paths come from visitor URLs, so they never
            // reach the model.
            expect(row).not.toHaveProperty('routes');
            expect(row.sourceTruncated).toBe(true);
            expect(String(row.source).length).toBeLessThanOrEqual(301);
            expect(row.translation).toBeNull();
        });
    });

    describe('input validation', () => {
        it('rejects an unknown view', async () => {
            await expect(tool.handler({ view: 'everything' })).rejects.toThrow(/view/);
        });

        it('requires a well-formed language for the keys view', async () => {
            await expect(tool.handler({ view: 'keys' })).rejects.toThrow(/language/);
            await expect(tool.handler({ view: 'keys', language: 'Chinese!' })).rejects.toThrow(/language/);
        });

        it('rejects key filters on views that would not apply them', async () => {
            // Ignoring them would let the model narrate every language as if
            // the list had been narrowed to the one it asked about.
            await expect(tool.handler({ view: 'languages', language: 'zh' })).rejects.toThrow(/only to view "keys"/);
            await expect(tool.handler({ view: 'routes', days: 7 })).rejects.toThrow(/only to view "switches"/);
        });

        it('rejects an invalid status, route pattern, namespace, offset, or window', async () => {
            await expect(tool.handler({ view: 'keys', language: 'zh', status: 'done' })).rejects.toThrow(/status/);
            await expect(tool.handler({ view: 'keys', language: 'zh', route: 'no-slash' })).rejects.toThrow(/route/);
            await expect(tool.handler({ view: 'keys', language: 'zh', namespace: 'Bad Name' })).rejects.toThrow(/namespace/);
            await expect(tool.handler({ view: 'keys', language: 'zh', offset: -1 })).rejects.toThrow(/offset/);
            await expect(tool.handler({ view: 'switches', days: 400 })).rejects.toThrow(/days/);
        });

        it('clamps an oversized limit instead of honouring it', async () => {
            const result = await tool.handler({ view: 'keys', language: 'zh', limit: 5000 }) as { limit: number };
            expect(result.limit).toBe(50);
        });
    });

    describe('registration', () => {
        it('registers under the localization provider whenever the registry appears', () => {
            const registered: Array<{ tool: IAiTool; provider: string }> = [];
            const registry = {
                registerTool: vi.fn((t: IAiTool, provider: string) => { registered.push({ tool: t, provider }); }),
                unregisterTool: vi.fn(() => true)
            } as unknown as IAiToolRegistry;
            const serviceRegistry = {
                watch: vi.fn((_name: string, handlers: { onAvailable: (r: IAiToolRegistry) => void }) => {
                    handlers.onAvailable(registry);
                    handlers.onAvailable(registry);
                    return () => undefined;
                })
            } as unknown as IServiceRegistry;
            const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as unknown as ISystemLogService;

            registerLocalizationAiTools(serviceRegistry, reads as unknown as ILocalizationToolReads, logger);

            expect(serviceRegistry.watch).toHaveBeenCalledWith('ai-tools', expect.anything());
            // Re-availability unregisters first, so the second registration
            // never trips the duplicate-name guard.
            expect(registry.unregisterTool).toHaveBeenCalledTimes(2);
            expect(registered.map(entry => entry.provider)).toEqual([PROVIDER_ID, PROVIDER_ID]);
        });
    });
});
