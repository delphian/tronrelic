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
 * Plugins can target these zones by registering widgets with:
 * - zone: 'plugin-content:before' or 'plugin-content:after'
 * - routes: ['/plugin-path'] to target specific plugin pages
 *
 * Context-aware widgets can access route information through the `route` and
 * `params` props passed to widget components. For plugin pages, the route is
 * the slug and params is an empty object (plugin-internal routing is handled
 * by the plugin itself).
 *
 * @example
 * // In plugin backend init()
 * await context.widgetService.register({
 *     id: 'my-plugin:promo-banner',
 *     zone: 'plugin-content:before',
 *     routes: ['/other-plugin'],
 *     order: 10,
 *     title: 'Promo Banner',
 *     fetchData: async (route, params) => ({ message: 'Check out my plugin!' })
 * }, manifest.id);
 */

import { WidgetZone, fetchWidgetsForRoute } from './widgets';
import { PluginPageHandler } from './PluginPageHandler';
import styles from './PluginPageWithZones.module.css';

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

    const widgets = await fetchWidgetsForRoute(route, params);
    const isResourceMarkets = slug === '/resource-markets';

    let seoContent: JSX.Element | null = null;

    if (isResourceMarkets) {
        seoContent = (
            <section className={styles.seo_section}>
                <h2 className={styles.seo_heading}>How TRON Energy Rental Works</h2>
                <p className={styles.seo_text}>
                    Every TRC-20 token transfer on the TRON network, including USDT, requires energy to execute.
                    Wallets without enough energy pay transaction fees by burning TRX, which can cost 10-50x more
                    than renting energy from a delegation provider. TronRelic monitors over 20 energy rental platforms
                    including TronSave, JustLend, Brutus Finance, and CatFee, comparing their prices every 10 minutes
                    so you can find the cheapest rate and save up to 90% on every transaction.
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
                            TronRelic monitors over 20 TRON energy rental platforms including TronSave, JustLend,
                            Brutus Finance, CatFee, TronZap, Feee.io, Tronspark, NRG, and many more. Each platform
                            is queried for current pricing, minimum order sizes, and availability. The comparison table
                            normalizes all prices to a per-energy-unit cost so you can instantly identify the cheapest
                            provider for your transaction size.
                        </p>
                    </details>

                    <details className={styles.faq_item}>
                        <summary className={styles.faq_summary}>How often are market prices updated?</summary>
                        <p className={styles.faq_answer}>
                            TronRelic refreshes energy market prices every 10 minutes through automated API queries
                            to each platform. The last-updated timestamp is displayed on the market comparison page
                            so you always know how fresh the data is. If a platform is temporarily unreachable, the
                            most recent successful price is shown with a stale indicator until the next successful refresh.
                        </p>
                    </details>
                </div>
            </section>
        );
    }

    return (
        <>
            <WidgetZone name="plugin-content:before" widgets={widgets} route={route} params={params} />
            <PluginPageHandler slug={slug} initialData={initialData} />
            <WidgetZone name="plugin-content:after" widgets={widgets} route={route} params={params} />
            {seoContent}
        </>
    );
}
