import type { MarketFetcher } from './types.js';
import { logger } from '../../../lib/logger.js';

class MarketFetcherRegistry {
  private fetchers: Map<string, MarketFetcher> = new Map();

  register(fetcher: MarketFetcher) {
    if (this.fetchers.has(fetcher.guid)) {
      throw new Error(`Fetcher with guid ${fetcher.guid} already registered`);
    }
    this.fetchers.set(fetcher.guid, fetcher);
    logger.debug({ guid: fetcher.guid, name: fetcher.name }, 'Registered market fetcher');
  }

  list(): MarketFetcher[] {
    return Array.from(this.fetchers.values());
  }
}

export const marketFetcherRegistry = new MarketFetcherRegistry();
