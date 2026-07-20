/**
 * Tests for the traffic module's AI tool registrations.
 *
 * Two concerns dominate here. First, privacy: the new-visitor tool must strip
 * the tid and subnet hash before any row reaches a model — that projection is
 * the entire reason the tool is safe to expose, so a regression must fail the
 * suite loudly rather than silently widen the surface. Second, input handling:
 * the schema is a hint to the model, not a guarantee, so every handler must
 * reject malformed arguments with a message the model can correct from.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IAiTool, IAiToolRegistry, IServiceRegistry, ISystemLogService } from '@/types';
import { registerTrafficAiTools, listOwnAiTools, AI_TOOL_NAMES, PROVIDER_ID } from '../ai-tools.js';
import type { GscService } from '../services/gsc.service.js';
import type { TrafficService } from '../services/traffic.service.js';

/**
 * Build a TrafficService double whose reads return recognizable sentinels, so a
 * handler that calls the wrong service method fails on the returned shape.
 *
 * @returns A partial TrafficService cast to the full type for injection.
 */
function createTrafficServiceStub() {
    return {
        isEnabled: vi.fn(() => true),
        getOverviewTrend: vi.fn(async () => ({ current: { visitors: 10 } })),
        getLiveVisitorCount: vi.fn(async () => 3),
        getEngagementMetrics: vi.fn(async () => ({ bounceRate: 0.4 })),
        getTrafficSources: vi.fn(async () => [{ source: 'google.com', visitors: 5, count: 9 }]),
        getTrafficSourceDetails: vi.fn(async () => ({ landingPages: [] })),
        getTopLandingPages: vi.fn(async () => [{ path: '/', visitors: 4, count: 7 }]),
        getGeoDistribution: vi.fn(async () => [{ country: 'US', visitors: 2, count: 2 }]),
        getDeviceBreakdown: vi.fn(async () => [{ device: 'desktop', visitors: 6, count: 8 }]),
        getCampaignPerformance: vi.fn(async () => [{ campaign: 'spring', visitors: 1, count: 1 }]),
        getBinaryConversionFunnel: vi.fn(async () => ({ distinctVisitors: 10, converted: 2, conversionRate: 0.2 })),
        getActiveAccountIds: vi.fn(async () => ['account-1']),
        countTidsForUsers: vi.fn(async () => 1),
        getRetention: vi.fn(async () => [{ day: 1, visitors: 3 }]),
        getDailyVisitors: vi.fn(async () => [{ day: '2026-07-01', visitors: 3 }]),
        getBotClassBreakdown: vi.fn(async () => [{ botClass: 'ai_crawler', count: 12 }]),
        getBotClassTimeSeries: vi.fn(async () => [{ day: '2026-07-01', ai_crawler: 4 }]),
        getBotOtherUserAgents: vi.fn(async () => [{ userAgent: 'weird-bot/1.0', count: 3 }]),
        getPathsByBotClass: vi.fn(async () => [{ path: '/tools', count: 5 }]),
        getRedirectAnalytics: vi.fn(async () => ({ total: 7, patterns: [] })),
        getNewVisitors: vi.fn(async () => ({
            total: 1,
            visitors: [{
                userId: 'tid-abc123',
                firstSeen: '2026-07-01T00:00:00.000Z',
                lastSeen: '2026-07-01T00:05:00.000Z',
                country: 'US',
                referrerDomain: 'google.com',
                landingPage: '/',
                device: 'desktop',
                utm: null,
                searchKeyword: 'tron energy',
                sessionsCount: 1,
                pageViews: 2,
                subnetHash: 'deadbeefdeadbeef'
            }]
        }))
    };
}

/**
 * Build a GscService double returning per-view sentinels.
 *
 * @returns A partial GscService cast to the full type for injection.
 */
function createGscServiceStub() {
    return {
        getKeywordsForPeriod: vi.fn(async () => ({ keywords: [{ query: 'tron energy', clicks: 4 }] })),
        getPagesForPeriod: vi.fn(async () => ({ pages: [{ page: '/', clicks: 9 }] })),
        // Params declared so a test can assert on the day/topN split the
        // handler derives.
        getKeywordsByDay: vi.fn(async (_days: number, _topN: number) => ({ days: [] })),
        getStatus: vi.fn(async () => ({ configured: true }))
    };
}

/**
 * Capture the tools a `registerTrafficAiTools` call registers, by driving the
 * service-registry watch synchronously with a stub registry.
 *
 * @param gscStub - Optional GscService double, so a caller can assert on the
 *                  arguments the handlers pass it. Defaults to a fresh stub.
 * @returns The registered tools keyed by name, plus the stub registry.
 */
function registerAndCapture(
    gscStub: ReturnType<typeof createGscServiceStub> = createGscServiceStub()
): { tools: Map<string, IAiTool>; registry: IAiToolRegistry } {
    const tools = new Map<string, IAiTool>();
    const registry = {
        registerTool: vi.fn((tool: IAiTool) => { tools.set(tool.name, tool); }),
        unregisterTool: vi.fn(() => true),
        listTools: vi.fn(() => [...tools.values()]),
        getEnabledTools: vi.fn(() => [...tools.values()]),
        getEnabledToolDeclarations: vi.fn(() => []),
        getTool: vi.fn((name: string) => tools.get(name)),
        listToolInfo: vi.fn(() => [...tools.values()].map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            capability: tool.capability,
            enabled: true,
            provider: PROVIDER_ID
        }))),
        resolveAllowlist: vi.fn(() => ({ resolved: [], missing: [] })),
        setEnabled: vi.fn(async () => true)
    } as unknown as IAiToolRegistry;

    const serviceRegistry = {
        watch: vi.fn((_name: string, handlers: { onAvailable: (svc: IAiToolRegistry) => void }) => {
            handlers.onAvailable(registry);
            return () => undefined;
        }),
        // Identity absent — exercises the graceful path where the funnel's
        // acquisition stage reads 0 instead of failing the whole read.
        get: vi.fn(() => undefined)
    } as unknown as IServiceRegistry;

    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as unknown as ISystemLogService;

    registerTrafficAiTools(
        serviceRegistry,
        createTrafficServiceStub() as unknown as TrafficService,
        gscStub as unknown as GscService,
        logger
    );

    return { tools, registry };
}

describe('traffic AI tools', () => {
    let tools: Map<string, IAiTool>;
    let registry: IAiToolRegistry;

    beforeEach(() => {
        ({ tools, registry } = registerAndCapture());
    });

    describe('registration', () => {
        it('registers all seven tools under the traffic provider id', () => {
            expect([...tools.keys()].sort()).toEqual(Object.values(AI_TOOL_NAMES).sort());
        });

        it('classifies every tool as a read with no spend', () => {
            for (const tool of tools.values()) {
                expect(tool.capability?.sideEffect).toBe('read');
                expect(tool.capability?.spendsMoney).toBeFalsy();
            }
        });

        it('declares untrusted content on the tools that surface third-party text', () => {
            expect(tools.get(AI_TOOL_NAMES.crawlers)?.capability?.surfacesUntrustedContent).toBe(true);
            expect(tools.get(AI_TOOL_NAMES.seo)?.capability?.surfacesUntrustedContent).toBe(true);
            expect(tools.get(AI_TOOL_NAMES.newVisitors)?.capability?.surfacesUntrustedContent).toBe(true);
            // The breakdown tool returns utm_* and path verbatim on its
            // campaigns / landing-pages / source-drill-down branches, and both
            // arrive as arbitrary strings on the public ingestion endpoints.
            expect(tools.get(AI_TOOL_NAMES.breakdown)?.capability?.surfacesUntrustedContent).toBe(true);
            // Every overview trend bucket carries topPaths/topSources/topCountries,
            // so the headline tool is an untrusted surface too despite its KPIs
            // being pure aggregates.
            expect(tools.get(AI_TOOL_NAMES.overview)?.capability?.surfacesUntrustedContent).toBe(true);
        });

        it('exposes no tool backed by the per-subject clickstream reads', async () => {
            // The stubs deliberately omit getPageActivity/getPageHits, so any
            // handler reaching for one throws rather than quietly returning a
            // browsing trail. Driving every zero-required-arg handler proves
            // none of them does.
            const trafficStub = createTrafficServiceStub();
            expect(trafficStub).not.toHaveProperty('getPageActivity');
            expect(trafficStub).not.toHaveProperty('getPageHits');

            await expect(tools.get(AI_TOOL_NAMES.overview)!.handler({})).resolves.toBeDefined();
            await expect(tools.get(AI_TOOL_NAMES.audience)!.handler({})).resolves.toBeDefined();
            await expect(tools.get(AI_TOOL_NAMES.newVisitors)!.handler({})).resolves.toBeDefined();
            await expect(tools.get(AI_TOOL_NAMES.redirects)!.handler({})).resolves.toBeDefined();
        });

        it('warns the model that new-visitor rows cannot be correlated to a person', () => {
            expect(tools.get(AI_TOOL_NAMES.newVisitors)!.description).toMatch(/CANNOT be correlated/);
        });

        it('filters the registry to this provider only', () => {
            expect(listOwnAiTools(registry).map(tool => tool.name).sort())
                .toEqual(Object.values(AI_TOOL_NAMES).sort());
        });
    });

    describe('new-visitor projection', () => {
        it('strips the tid and subnet hash from every returned row', async () => {
            const result = await tools.get(AI_TOOL_NAMES.newVisitors)!.handler({}) as {
                visitors: Array<Record<string, unknown>>;
            };

            expect(result.visitors).toHaveLength(1);
            const [row] = result.visitors;
            expect(row).not.toHaveProperty('userId');
            expect(row).not.toHaveProperty('subnetHash');
            expect(JSON.stringify(result)).not.toContain('tid-abc123');
            expect(JSON.stringify(result)).not.toContain('deadbeefdeadbeef');
        });

        it('keeps the acquisition fields that make the row useful', async () => {
            const result = await tools.get(AI_TOOL_NAMES.newVisitors)!.handler({}) as {
                visitors: Array<Record<string, unknown>>;
            };

            expect(result.visitors[0]).toMatchObject({
                country: 'US',
                referrerDomain: 'google.com',
                landingPage: '/',
                device: 'desktop',
                pageViews: 2
            });
        });
    });

    describe('input validation', () => {
        it('rejects an unknown period rather than silently defaulting', async () => {
            await expect(tools.get(AI_TOOL_NAMES.overview)!.handler({ period: '99y' }))
                .rejects.toThrow(/must be one of/);
        });

        it('rejects an unknown breakdown dimension', async () => {
            await expect(tools.get(AI_TOOL_NAMES.breakdown)!.handler({ dimension: 'moon-phase' }))
                .rejects.toThrow(/dimension/);
        });

        it('rejects `source` paired with a dimension other than sources', async () => {
            await expect(tools.get(AI_TOOL_NAMES.breakdown)!.handler({ dimension: 'geo', source: 'google.com' }))
                .rejects.toThrow(/only valid with dimension "sources"/);
        });

        it('rejects the crawler paths view without a valid botClass', async () => {
            await expect(tools.get(AI_TOOL_NAMES.crawlers)!.handler({ view: 'paths' }))
                .rejects.toThrow(/botClass/);
            await expect(tools.get(AI_TOOL_NAMES.crawlers)!.handler({ view: 'paths', botClass: 'human' }))
                .rejects.toThrow(/botClass/);
        });

        it('rejects an unknown SEO view', async () => {
            await expect(tools.get(AI_TOOL_NAMES.seo)!.handler({ view: 'backlinks' }))
                .rejects.toThrow(/view/);
        });

        it('clamps an oversized limit instead of honouring it', async () => {
            const result = await tools.get(AI_TOOL_NAMES.breakdown)!.handler({
                dimension: 'landing-pages',
                limit: 5000
            }) as { limit: number };

            expect(result.limit).toBeLessThanOrEqual(50);
        });

        it('defaults to excluding bots so counts match the dashboard', async () => {
            const result = await tools.get(AI_TOOL_NAMES.overview)!.handler({}) as { excludeBots: boolean };
            expect(result.excludeBots).toBe(true);
        });

        it('spreads the keyword-trend row budget across days instead of per-day', async () => {
            // A 30d window at the default limit would return 30 buckets x 20
            // keywords without the spread — 600 rows against a 50-row ceiling.
            const gsc = createGscServiceStub();
            const { tools: built } = registerAndCapture(gsc);
            await built.get(AI_TOOL_NAMES.seo)!.handler({ view: 'keywords-by-day', period: '30d' });

            const call = gsc.getKeywordsByDay.mock.calls[0];
            expect(call).toBeDefined();
            const [days, topN] = call;
            expect(days).toBe(30);
            expect(days * topN).toBeLessThanOrEqual(50);
            expect(topN).toBeGreaterThanOrEqual(1);
        });
    });

    describe('conversion funnel composition', () => {
        it('returns the acquisition stage, not just the binary funnel', async () => {
            const result = await tools.get(AI_TOOL_NAMES.audience)!.handler({}) as {
                funnel: Record<string, unknown>;
            };

            // Identity is absent in this stub, so the stage is present-but-zero
            // rather than missing — the model must never infer signups from
            // `converted`, which counts returning account holders too.
            expect(result.funnel).toHaveProperty('newAccountVisitors');
            expect(result.funnel.newAccountVisitors).toBe(0);
            expect(result.funnel.converted).toBe(2);
        });
    });
});
