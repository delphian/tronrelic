import type { IPluginContext } from '@tronrelic/types';
import { MarketFetcherRegistry } from '../fetchers/fetcher-registry.js';
import { createMarketService } from '../services/market.service.js';

/**
 * Scheduled job that refreshes all market data every 10 minutes.
 *
 * Workflow:
 * 1. Fetch latest data from all 14 market fetchers
 * 2. Normalize and compute pricing details
 * 3. Store in plugin database
 * 4. Emit WebSocket updates
 * 5. Update cache
 *
 * Registered in backend.ts init() hook with scheduler.register()
 */
export async function refreshMarketsJob(context: IPluginContext, registry: MarketFetcherRegistry): Promise<void> {
    const logger = context.logger.child({ job: 'refresh-markets' });

    try {
        logger.info('Starting market refresh');

        const marketService = createMarketService(context);
        const fetchers = registry.list();

        await marketService.refreshAllMarkets(fetchers);

        logger.info({ count: fetchers.length }, 'Market refresh completed successfully');
    } catch (error) {
        logger.error({ error }, 'Market refresh failed');
        throw error;
    }
}
