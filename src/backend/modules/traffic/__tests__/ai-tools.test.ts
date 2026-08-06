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
import type { RedirectService } from '../services/redirect.service.js';
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
        getTopPaths: vi.fn(async () => [{ key: '/markets', count: 41 }]),
        getTopCountries: vi.fn(async () => [{ key: 'US', count: 33 }]),
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
        // Param declared so a test can assert the handler passes a row cap: the
        // service treats an omitted limit as "every pair", which the admin panel
        // wants and a context window cannot absorb.
        getKeywordPagePairsForPeriod: vi.fn(async (_periodHours: number, _limit?: number) => ({
            pairs: [{ keyword: 'tron energy', page: '/tools/energy', clicks: 4 }]
        })),
        // Params declared so a test can assert on the day/topN split the
        // handler derives.
        getKeywordsByDay: vi.fn(async (_days: number, _topN: number) => ({ days: [] })),
        getStatus: vi.fn(async () => ({ configured: true }))
    };
}

/**
 * Build a RedirectService double for the redirect tool's rule-inventory view.
 *
 * Carries one enabled and one disabled rule so a test can assert the handler
 * reports the enabled count rather than conflating it with the total.
 *
 * @returns A partial RedirectService cast to the full type for injection.
 */
function createRedirectServiceStub() {
    return {
        listRules: vi.fn(async () => [
            { id: 'r1', pattern: '/old', destination: '/new', isPrefix: true, permanent: true, enabled: true },
            { id: 'r2', pattern: '/retired', destination: '/', isPrefix: false, permanent: true, enabled: false }
        ])
    };
}

/**
 * Capture the tools a `registerTrafficAiTools` call registers, by driving the
 * service-registry watch synchronously with a stub registry.
 *
 * @param gscStub - Optional GscService double, so a caller can assert on the
 *                  arguments the handlers pass it. Defaults to a fresh stub.
 * @param seededServices - Optional services the registry `get()` resolves, keyed
 *                         by name. Defaults to none, which exercises the
 *                         graceful identity-absent path.
 * @param trafficStub - Optional TrafficService double, so a caller can shape a
 *                      read's return — a wide trend series, for instance — that
 *                      the default sentinel stub deliberately keeps small.
 * @returns The registered tools keyed by name, plus the stub registry.
 */
function registerAndCapture(
    gscStub: ReturnType<typeof createGscServiceStub> = createGscServiceStub(),
    seededServices: Record<string, unknown> = {},
    trafficStub: ReturnType<typeof createTrafficServiceStub> = createTrafficServiceStub()
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
        // Identity absent by default — exercises the graceful path where the
        // funnel's acquisition stage reads 0 and the site-wide account block
        // reads null instead of failing the whole read.
        get: vi.fn((name: string) => seededServices[name])
    } as unknown as IServiceRegistry;

    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as unknown as ISystemLogService;

    registerTrafficAiTools(
        serviceRegistry,
        trafficStub as unknown as TrafficService,
        gscStub as unknown as GscService,
        createRedirectServiceStub() as unknown as RedirectService,
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
            // The stubs deliberately omit getVisitors/getPageHits, so any
            // handler reaching for one throws rather than quietly returning a
            // browsing trail. Driving every zero-required-arg handler proves
            // none of them does. getVisitors carries the same re-identification
            // risk the retired getPageActivity did — it is per-tid, and a tid
            // that logged in carries an account id.
            const trafficStub = createTrafficServiceStub();
            expect(trafficStub).not.toHaveProperty('getVisitors');
            expect(trafficStub).not.toHaveProperty('getPageHits');

            await expect(tools.get(AI_TOOL_NAMES.overview)!.handler({})).resolves.toBeDefined();
            await expect(tools.get(AI_TOOL_NAMES.audience)!.handler({})).resolves.toBeDefined();
            await expect(tools.get(AI_TOOL_NAMES.newVisitors)!.handler({})).resolves.toBeDefined();
            await expect(tools.get(AI_TOOL_NAMES.redirects)!.handler({})).resolves.toBeDefined();
        });

        it('warns the model that new-visitor rows cannot be correlated to a person', () => {
            expect(tools.get(AI_TOOL_NAMES.newVisitors)!.description).toMatch(/CANNOT be correlated/);
        });

        it('describes sources and landing pages as session-scoped, not first-touch', () => {
            // The reads moved to session scope (derivedSessionsSql +
            // sessionSourceExpr) while the description still claimed first-touch,
            // so the model explained returning-visitor attribution backwards —
            // the exact opposite of the dashboard tooltip over the same numbers.
            const description = tools.get(AI_TOOL_NAMES.breakdown)!.description;
            expect(description).toMatch(/SESSION-SCOPED/);
            expect(description).not.toMatch(/Sources, landing pages, and campaigns are FIRST-TOUCH/);
            // Campaigns must stay described as first-touch: it is the one read
            // that still is, because ad tagging exists only on the first touch.
            expect(description).toMatch(/"campaigns" is the one FIRST-TOUCH dimension/);
        });

        it('labels each breakdown response with the attribution its buckets carry', async () => {
            const breakdown = tools.get(AI_TOOL_NAMES.breakdown)!;
            const sources = await breakdown.handler({ dimension: 'sources' }) as { attribution: string };
            const landing = await breakdown.handler({ dimension: 'landing-pages' }) as { attribution: string };
            const campaigns = await breakdown.handler({ dimension: 'campaigns' }) as { attribution: string };
            const geo = await breakdown.handler({ dimension: 'geo' }) as { attribution: string };

            expect(sources.attribution).toBe('session-scoped');
            expect(landing.attribution).toBe('session-scoped');
            expect(campaigns.attribution).toBe('first-touch');
            expect(geo.attribution).toBe('in-window');
        });
    });

    describe('window vocabulary', () => {
        it('accepts the dashboard 90d preset on the date-range reads', async () => {
            const result = await tools.get(AI_TOOL_NAMES.overview)!.handler({ period: '90d' }) as { period: string };
            expect(result.period).toBe('90d');
        });

        it('holds the raw-hours reads to their 30d ceiling', async () => {
            // Crawlers and SEO take a sinceHours the REST layer clamps to 720
            // and their tab pickers stop at 30d, so 90d is a window no panel can
            // reproduce and a far heavier scan than any of them issues.
            await expect(tools.get(AI_TOOL_NAMES.crawlers)!.handler({ view: 'summary', period: '90d' }))
                .rejects.toThrow(/must be one of/);
            await expect(tools.get(AI_TOOL_NAMES.seo)!.handler({ view: 'keywords', period: '90d' }))
                .rejects.toThrow(/must be one of/);
        });

        it('resolves an explicit custom range and echoes its true boundaries', async () => {
            const result = await tools.get(AI_TOOL_NAMES.overview)!.handler({
                startDate: '2026-03-01T00:00:00.000Z',
                endDate: '2026-03-15T23:59:59.000Z'
            }) as { period: string; windowStart: string; windowEnd: string };

            expect(result.period).toBe('custom');
            expect(result.windowStart).toBe('2026-03-01T00:00:00.000Z');
            expect(result.windowEnd).toBe('2026-03-15T23:59:59.000Z');
        });

        it('rejects a half-specified or inverted custom range instead of silently defaulting', async () => {
            // The REST layer degrades a bad range to its default window, which is
            // harmless for a browser but not here: a model that asked for March
            // and quietly received the last 24 hours narrates the wrong window.
            await expect(tools.get(AI_TOOL_NAMES.overview)!.handler({ startDate: '2026-03-01T00:00:00Z' }))
                .rejects.toThrow(/must be supplied together/);
            await expect(tools.get(AI_TOOL_NAMES.overview)!.handler({
                startDate: '2026-03-15T00:00:00Z',
                endDate: '2026-03-01T00:00:00Z'
            })).rejects.toThrow(/must not be later than/);
            await expect(tools.get(AI_TOOL_NAMES.overview)!.handler({
                startDate: 'last tuesday',
                endDate: 'today'
            })).rejects.toThrow(/ISO-8601/);
        });

        it('caps a custom span at the widest preset instead of leaving it unbounded', async () => {
            // Without this the preset budget is decorative: the reads behind
            // overview and audience scale linearly with the span, so a decade-wide
            // custom range costs far more than any window the model could name.
            await expect(tools.get(AI_TOOL_NAMES.overview)!.handler({
                startDate: '2015-01-01T00:00:00Z',
                endDate: '2026-08-06T00:00:00Z'
            })).rejects.toThrow(/at most 90 days/);
            await expect(tools.get(AI_TOOL_NAMES.audience)!.handler({
                startDate: '2026-01-01T00:00:00Z',
                endDate: '2026-08-06T00:00:00Z'
            })).rejects.toThrow(/at most 90 days/);
        });

        it('admits a custom span sitting exactly on the 90-day ceiling', async () => {
            // The boundary is inclusive: 90 days is a window the model can already
            // request by name, so rejecting the identical explicit range would be
            // arbitrary.
            const result = await tools.get(AI_TOOL_NAMES.overview)!.handler({
                startDate: '2026-01-01T00:00:00.000Z',
                endDate: '2026-04-01T00:00:00.000Z'
            }) as { period: string };
            expect(result.period).toBe('custom');
        });

        it('drops per-bucket detail once the trend series outgrows the bucket budget', async () => {
            // Capping the input span bounds the bucket COUNT, not the payload:
            // every window over 48h is daily-bucketed and each point carries its
            // own top three paths, countries, and sources, so 90d would ship
            // hundreds of nested objects into the context window.
            const wide = createTrafficServiceStub();
            wide.getOverviewTrend = vi.fn(async () => ({
                current: { visitors: 10 },
                series: Array.from({ length: 91 }, (_, day) => ({
                    bucket: `2026-05-${String((day % 28) + 1).padStart(2, '0')}`,
                    visitors: day,
                    pageviews: day * 2,
                    topPaths: [{ path: '/markets', hits: 3 }],
                    topCountries: [{ country: 'US', hits: 2 }],
                    topSources: [{ source: 'google.com', hits: 1 }]
                }))
            })) as typeof wide.getOverviewTrend;
            const { tools: built } = registerAndCapture(createGscServiceStub(), {}, wide);

            const result = await built.get(AI_TOOL_NAMES.overview)!.handler({ period: '90d' }) as {
                seriesDetailTrimmed: boolean;
                trend: { series: Array<Record<string, unknown>> };
            };

            expect(result.seriesDetailTrimmed).toBe(true);
            expect(result.trend.series).toHaveLength(91);
            // The series SHAPE survives — only the nested dimensions go, and the
            // description points the model at the breakdown tool for them.
            expect(result.trend.series[0]).toEqual({ bucket: '2026-05-01', visitors: 0, pageviews: 0 });
            expect(result.trend.series.every(point => !('topPaths' in point))).toBe(true);
        });

        it('keeps per-bucket detail on windows inside the bucket budget', async () => {
            // The trim must not fire on the windows an operator reads most: at
            // 24h and 30d the series is well under the cap and the per-bucket
            // dimensions are the tool's whole value.
            const narrow = createTrafficServiceStub();
            narrow.getOverviewTrend = vi.fn(async () => ({
                current: { visitors: 10 },
                series: Array.from({ length: 31 }, (_, day) => ({
                    bucket: `2026-05-${String(day + 1).padStart(2, '0')}`,
                    visitors: day,
                    pageviews: day * 2,
                    topPaths: [{ path: '/markets', hits: 3 }],
                    topCountries: [],
                    topSources: []
                }))
            })) as typeof narrow.getOverviewTrend;
            const { tools: built } = registerAndCapture(createGscServiceStub(), {}, narrow);

            const result = await built.get(AI_TOOL_NAMES.overview)!.handler({ period: '30d' }) as {
                seriesDetailTrimmed: boolean;
                trend: { series: Array<Record<string, unknown>> };
            };

            expect(result.seriesDetailTrimmed).toBe(false);
            expect(result.trend.series[0]).toHaveProperty('topPaths');
        });

        it('advertises the custom range on every date-range tool description', async () => {
            // A capability the description omits is invisible to the model, which
            // reads descriptions rather than schemas when deciding how to call.
            for (const name of [
                AI_TOOL_NAMES.overview,
                AI_TOOL_NAMES.breakdown,
                AI_TOOL_NAMES.audience,
                AI_TOOL_NAMES.newVisitors,
                AI_TOOL_NAMES.redirects
            ]) {
                expect(tools.get(name)!.description).toMatch(/startDate/);
            }
        });
    });

    describe('dashboard parity views', () => {
        it('serves the raw all-traffic aggregates the Crawlers tab shows, labeled as row counts', async () => {
            const paths = await tools.get(AI_TOOL_NAMES.crawlers)!.handler({ view: 'top-paths' }) as {
                measure: string; data: unknown;
            };
            const countries = await tools.get(AI_TOOL_NAMES.crawlers)!.handler({ view: 'top-countries' }) as {
                measure: string; data: unknown;
            };

            // The label is the guard against the reconciliation trap: these count
            // every event row, bot and human, with no ignore-list filter, and each
            // row is one group rather than a site-wide total — a different measure
            // from the visitor figures beside them, in neither direction.
            expect(paths.measure).toMatch(/not visitors/);
            expect(countries.measure).toMatch(/not visitors/);
            expect(paths.data).toEqual([{ key: '/markets', count: 41 }]);
            expect(countries.data).toEqual([{ key: 'US', count: 33 }]);
        });

        it('serves the keyword→page pairs panel with an explicit row cap', async () => {
            const gsc = createGscServiceStub();
            const { tools: built } = registerAndCapture(gsc);
            await built.get(AI_TOOL_NAMES.seo)!.handler({ view: 'keyword-pages', limit: 30 });

            const call = gsc.getKeywordPagePairsForPeriod.mock.calls[0];
            expect(call).toBeDefined();
            const [, limit] = call;
            // Omitting the limit returns every pair — right for the admin panel,
            // fatal for a context window.
            expect(limit).toBe(30);
        });

        it('serves the redirect rule inventory, including rules that were never hit', async () => {
            // The analytics breakdown is hit-derived, so a zero-hit rule — the
            // retirement candidate the tool is meant to help identify — appears
            // only here.
            const result = await tools.get(AI_TOOL_NAMES.redirects)!.handler({ view: 'rules' }) as {
                total: number; enabled: number; scope: string; rules: Array<{ pattern: string }>;
            };

            expect(result.total).toBe(2);
            expect(result.enabled).toBe(1);
            expect(result.scope).toMatch(/not windowed/);
            expect(result.rules.map(rule => rule.pattern)).toEqual(['/old', '/retired']);
        });

        it('pages the rule inventory while still counting the whole of it', async () => {
            // The page caps what reaches the model's context window, not the DB
            // read — but `total` must keep counting rules the model has not been
            // shown, or a truncated page reads as the complete inventory.
            const redirects = tools.get(AI_TOOL_NAMES.redirects)!;
            const first = await redirects.handler({ view: 'rules', limit: 1 }) as {
                total: number; returned: number; hasMore: boolean; rules: Array<{ pattern: string }>;
            };
            const second = await redirects.handler({ view: 'rules', limit: 1, offset: 1 }) as {
                total: number; returned: number; hasMore: boolean; rules: Array<{ pattern: string }>;
            };

            expect(first.total).toBe(2);
            expect(first.returned).toBe(1);
            expect(first.hasMore).toBe(true);
            expect(first.rules.map(rule => rule.pattern)).toEqual(['/old']);

            expect(second.total).toBe(2);
            expect(second.hasMore).toBe(false);
            expect(second.rules.map(rule => rule.pattern)).toEqual(['/retired']);
        });

        it('defaults the redirect tool to analytics and rejects an unknown view', async () => {
            const result = await tools.get(AI_TOOL_NAMES.redirects)!.handler({}) as { view: string };
            expect(result.view).toBe('analytics');
            await expect(tools.get(AI_TOOL_NAMES.redirects)!.handler({ view: 'rewrite' }))
                .rejects.toThrow(/must be one of/);
        });

        it('reports site-wide account totals separately from the windowed funnel', async () => {
            // Seeding 'accounts' also activates the funnel's real acquisition
            // path, so the double must answer the directory lookup that path
            // makes per active account, not only the site-wide count.
            const { tools: built } = registerAndCapture(createGscServiceStub(), {
                accounts: {
                    countAccounts: vi.fn(async () => 240),
                    getAccount: vi.fn(async (id: string) => ({ id, createdAt: '2020-01-01T00:00:00.000Z' }))
                },
                wallets: { countDistinctOwners: vi.fn(async () => 60) }
            });

            const result = await built.get(AI_TOOL_NAMES.audience)!.handler({}) as {
                accounts: { scope: string; totalAccounts: number; walletAdoptionRate: number } | null;
            };

            expect(result.accounts).toMatchObject({ totalAccounts: 240, accountsWithWallets: 60 });
            expect(result.accounts!.walletAdoptionRate).toBeCloseTo(0.25);
            // Scope is carried on the payload, not just the description: these
            // totals sit beside windowed funnel figures and must never be
            // narrated as "accounts in the last 24 hours".
            expect(result.accounts!.scope).toMatch(/not windowed/);
        });

        it('reads accounts as null, never zero, when identity is unavailable', async () => {
            // Zero would be indistinguishable from a site with no accounts.
            const result = await tools.get(AI_TOOL_NAMES.audience)!.handler({}) as { accounts: unknown };
            expect(result.accounts).toBeNull();
        });

        it('reads the wallet adoption rate as null when the wallet store alone is absent', async () => {
            // Identity registers 'accounts' and 'wallets' separately, so one can
            // resolve without the other. A 0 rate here is a measured-looking claim
            // built from missing data — the model would narrate "0% of accounts
            // have connected a wallet" off nothing.
            const { tools: built } = registerAndCapture(createGscServiceStub(), {
                accounts: {
                    countAccounts: vi.fn(async () => 240),
                    getAccount: vi.fn(async (id: string) => ({ id, createdAt: '2020-01-01T00:00:00.000Z' }))
                }
            });

            const result = await built.get(AI_TOOL_NAMES.audience)!.handler({}) as {
                accounts: { totalAccounts: number; accountsWithWallets: number | null; walletAdoptionRate: number | null };
            };

            expect(result.accounts.totalAccounts).toBe(240);
            expect(result.accounts.accountsWithWallets).toBeNull();
            expect(result.accounts.walletAdoptionRate).toBeNull();
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
