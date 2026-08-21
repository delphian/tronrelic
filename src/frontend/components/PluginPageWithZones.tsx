/**
 * Server wrapper component for plugin pages with widget zone support.
 *
 * This component wraps the client-side PluginPageHandler with server-rendered
 * widget zones, enabling plugins to inject UI components into other plugin pages
 * without any custom plugin code.
 *
 * Widget zones provided:
 * - plugin-content:before - Above the plugin page content
 * - plugin-content:after - Below the plugin page content
 *
 * Plugins target these zones by calling registerWidget on the unified
 * widgets service (`IWidgetsService`, published on the service registry
 * as `'widgets'`). The default placement points the widget at a zone
 * and a route filter; operators can later override either from
 * /system/widgets.
 *
 * Context-aware widgets can access route information through the `route` and
 * `params` props passed to widget components. For plugin pages, the route is
 * the slug and params is an empty object (plugin-internal routing is handled
 * by the plugin itself).
 *
 * @example
 * // In plugin backend init()
 * const widgets = context.services.get<IWidgetsService>('widgets');
 * if (widgets) {
 *     await widgets.registerWidget({
 *         id: 'my-plugin:promo-banner',
 *         label: 'Promo Banner',
 *         description: 'Cross-plugin promo strip.',
 *         defaultZoneId: 'plugin-content:before',
 *         defaultRoutes: ['/other-plugin'],
 *         defaultOrder: 10,
 *         defaultTitle: 'Promo Banner',
 *         defaultDataFetcher: async (route, params) => ({
 *             message: 'Check out my plugin!'
 *         })
 *     }, manifest.id);
 * }
 */

import { WidgetZone, fetchWidgetsForRoute } from './widgets';
import { PluginPageHandler } from './PluginPageHandler';
import { getServerSideApiUrlWithPath } from '../lib/api-url';
import styles from './PluginPageWithZones.module.scss';

/**
 * Tracked-market catalog facts consumed by the /resource-markets SEO prose.
 *
 * Only the two fields the copy actually renders are modelled. The catalog
 * carries far more per market, and narrowing here stops the prose from
 * silently coupling to data it never displays.
 */
interface IResourceMarketFacts {
    /** How many markets the capture pipeline currently tracks. */
    count: number;
    /** Display names of those markets, in catalog priority order. */
    names: string[];
}

/**
 * Value used when the catalog cannot be reached during SSR.
 *
 * A stale hardcoded number is the exact failure this helper exists to prevent,
 * so the degraded path reports zero and lets the callers below fall back to
 * count-free phrasing rather than guessing at coverage.
 */
const RESOURCE_MARKET_FACTS_FALLBACK: IResourceMarketFacts = { count: 0, names: [] };

/**
 * How long a resolved catalog may be reused across requests.
 *
 * Markets are added by an operator through /system, not by the capture cycle,
 * so this list changes on a scale of weeks. Caching for an hour keeps the
 * lookup from adding an origin round-trip to every /resource-markets render —
 * the slowest route on the site, and one Cloudflare does not currently cache.
 */
const RESOURCE_MARKET_FACTS_TTL_SECONDS = 3600;

/**
 * How many providers the prose spells out before eliding the remainder. Enough
 * to make the claim concrete without turning a paragraph into a list.
 */
const RESOURCE_MARKET_NAME_LIMIT = 4;

/**
 * Resolve how many energy markets TronRelic actually tracks, and what they are
 * called, so the page's SEO prose cannot overstate its own coverage.
 *
 * This exists because the copy previously asserted "over 20 energy rental
 * platforms including TronSave, JustLend, Brutus Finance, and CatFee" while the
 * pipeline tracked nine — and named four providers that appear nowhere on the
 * page. On a page whose entire commercial claim is price accuracy, a coverage
 * claim the page itself disproves costs credibility with readers and crawlers
 * alike. Deriving the sentence from the same catalog the cards render means the
 * two can never drift apart again.
 *
 * Failure is deliberately non-fatal: a missing adjective is a far smaller
 * problem than a 500 on the site's primary money page.
 *
 * @returns Tracked-market count and display names, or a zero-count fallback
 *   when the catalog is unreachable so callers can choose neutral phrasing.
 */
async function fetchResourceMarketFacts(): Promise<IResourceMarketFacts> {
    let facts = RESOURCE_MARKET_FACTS_FALLBACK;
    try {
        // SSR must reach the backend over the internal SITE_BACKEND origin.
        // getServerConfig().apiUrl is the public SITE_URL-derived origin, which
        // a frontend container cannot reliably resolve (TLS failures / 502) —
        // see docs/frontend/frontend-architecture-runtime-config.md.
        const apiUrl = getServerSideApiUrlWithPath();
        const response = await fetch(`${apiUrl}/plugins/resource-markets/db-markets`, {
            next: { revalidate: RESOURCE_MARKET_FACTS_TTL_SECONDS },
            signal: AbortSignal.timeout(6000)
        });
        if (response.ok) {
            const body = await response.json();
            const markets: Array<{ displayName?: string }> = Array.isArray(body?.markets)
                ? body.markets
                : [];
            const names = markets
                .map((market) => market.displayName)
                .filter((name): name is string => typeof name === 'string' && name.length > 0);
            facts = { count: markets.length, names };
        } else {
            console.error('Failed to fetch resource market catalog:', response.status);
        }
    } catch (error) {
        console.error('Error fetching resource market catalog:', error);
    }
    return facts;
}

/**
 * Render the tracked-market count as a noun phrase the surrounding sentence can
 * absorb in every case, including when the catalog lookup failed.
 *
 * @param facts - Catalog resolved by `fetchResourceMarketFacts`.
 * @returns A phrase such as `9 TRON energy rental platforms`, or a count-free
 *   equivalent that stays true when coverage could not be determined.
 */
function describeMarketCount(facts: IResourceMarketFacts): string {
    return facts.count > 0
        ? `${facts.count} TRON energy rental platforms`
        : 'multiple TRON energy rental platforms';
}

/**
 * Render the tracked providers as an inline list, naming only markets that are
 * genuinely in the catalog and on the page below.
 *
 * @param facts - Catalog resolved by `fetchResourceMarketFacts`.
 * @returns A clause such as ` including Feee.io, TRONSAVE, and 7 more`, or an
 *   empty string when no names resolved so the sentence stays grammatical.
 */
function describeMarketNames(facts: IResourceMarketFacts): string {
    let clause = '';
    if (facts.names.length > 0) {
        const shown = facts.names.slice(0, RESOURCE_MARKET_NAME_LIMIT);
        const remaining = facts.names.length - shown.length;
        const tail = remaining > 0 ? `, and ${remaining} more` : '';
        clause = ` including ${shown.join(', ')}${tail}`;
    }
    return clause;
}

interface PluginPageWithZonesProps {
    slug: string;
    /**
     * Server-fetched initial data from the plugin's IPageConfig.serverDataFetcher,
     * forwarded to the plugin component via PluginPageHandler. Plugins use this
     * for SSR-rendered body content (e.g., bazi-fortune's day pillar) so the
     * initial HTML contains real data instead of placeholders.
     */
    initialData?: unknown;
}

/**
 * Render a plugin page with widget zones for cross-plugin content injection.
 *
 * Structured data (JSON-LD) for plugin pages is now declared in each plugin's
 * IPageConfig.structuredData field and injected by the catch-all route at
 * src/frontend/app/[...slug]/page.tsx, so this component no longer hardcodes
 * any per-plugin schema. The visible FAQ HTML for /resource-markets remains
 * here intentionally — it must continue rendering server-side until that
 * plugin moves the prose into its own page component.
 *
 * @param slug - The URL path for the plugin page (e.g., '/whales', '/memo-tracker')
 * @param initialData - Optional SSR-fetched data forwarded to the plugin component
 */
export async function PluginPageWithZones({ slug, initialData }: PluginPageWithZonesProps) {
    // For plugin pages, the slug is the route and params are empty
    // (plugin-internal param parsing is handled by the plugin's page component)
    const route = slug;
    const params: Record<string, string> = {};

    const { widgets, zones } = await fetchWidgetsForRoute(route, params);
    const isResourceMarkets = slug === '/resource-markets';

    let seoContent: JSX.Element | null = null;

    if (isResourceMarkets) {
        // Resolved per render (hourly-cached) so the coverage claims below are
        // always derived from the live catalog rather than restated by hand.
        const marketFacts = await fetchResourceMarketFacts();
        const marketCount = describeMarketCount(marketFacts);
        const marketNames = describeMarketNames(marketFacts);
        seoContent = (
            <section className={styles.seo_section}>
                <h2 className={styles.seo_heading}>How TRON Energy Rental Works</h2>
                <p className={styles.seo_text}>
                    Every TRC-20 token transfer on the TRON network, including USDT, requires energy to execute.
                    Wallets without enough energy pay transaction fees by burning TRX, which can cost 10-50x more
                    than renting energy from a delegation provider. TronRelic tracks {marketCount}
                    {marketNames}, refreshing their prices every capture cycle so you can find the cheapest rate
                    before you send.
                </p>

                <h3 className={styles.faq_heading}>Frequently Asked Questions</h3>

                <div className={styles.faq_list}>
                    <details className={styles.faq_item}>
                        <summary className={styles.faq_summary}>What is TRON energy and why does it matter?</summary>
                        <p className={styles.faq_answer}>
                            TRON energy is a resource consumed when executing smart contracts on the TRON network,
                            including TRC-20 token transfers like USDT. Every wallet regenerates a small amount of
                            free energy daily based on staked TRX, but high-volume wallets exhaust this quickly.
                            Without enough energy, the network burns TRX from your balance to cover the cost, which
                            can be 10-50x more expensive than renting energy from a delegation provider.
                        </p>
                    </details>

                    <details className={styles.faq_item}>
                        <summary className={styles.faq_summary}>How does renting energy reduce TRC-20 transfer fees?</summary>
                        <p className={styles.faq_answer}>
                            When you rent energy, a provider delegates their staked TRX resources to your wallet for
                            a set period. Your wallet temporarily gains enough energy to execute smart contracts without
                            burning TRX. A standard USDT transfer requires approximately 65,000 energy. Burning that
                            energy costs roughly 27 TRX at current rates, but renting the same amount from a market
                            provider typically costs 2-5 TRX, saving you up to 90% per transaction.
                        </p>
                    </details>

                    <details className={styles.faq_item}>
                        <summary className={styles.faq_summary}>How does TRON energy regeneration affect pricing?</summary>
                        <p className={styles.faq_answer}>
                            Every TRON wallet regenerates energy over a 24-hour cycle based on how much TRX is staked
                            for energy. This natural regeneration means the total energy available on the network changes
                            throughout the day, which influences rental market pricing. Providers monitor regeneration
                            rates to adjust their pricing, and savvy users can time their rentals to coincide with periods
                            of higher supply and lower demand for better rates.
                        </p>
                    </details>

                    <details className={styles.faq_item}>
                        <summary className={styles.faq_summary}>Which energy rental platforms does TronRelic compare?</summary>
                        <p className={styles.faq_answer}>
                            TronRelic tracks {marketCount}{marketNames}. Each platform is queried for current
                            pricing, minimum order sizes, and availability. The comparison table normalizes every
                            price to the cost of a single USDT TRC-20 transfer so you can identify the cheapest
                            provider for your transaction size without converting rate cards by hand.
                        </p>
                    </details>

                    <details className={styles.faq_item}>
                        <summary className={styles.faq_summary}>How often are market prices updated?</summary>
                        <p className={styles.faq_answer}>
                            TronRelic captures every tracked platform's rate card on a four-hour cycle, at 00:00,
                            04:00, 08:00, 12:00, 16:00 and 20:00 UTC. The capture timestamp is displayed on the
                            market comparison page so you always know how fresh the data is. If a platform is
                            temporarily unreachable, its most recent successful capture is shown until the next
                            cycle succeeds. Rates can move between captures, so confirm on the provider's own site
                            before sending a large order.
                        </p>
                    </details>
                </div>
            </section>
        );
    }

    return (
        <>
            <WidgetZone name="plugin-content:before" widgets={widgets} layout={zones['plugin-content:before']} route={route} params={params} />
            <PluginPageHandler slug={slug} initialData={initialData} />
            <WidgetZone name="plugin-content:after" widgets={widgets} layout={zones['plugin-content:after']} route={route} params={params} />
            {seoContent}
        </>
    );
}
