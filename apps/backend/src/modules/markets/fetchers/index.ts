import { httpClient } from '../../../lib/http-client.js';
import { logger } from '../../../lib/logger.js';
import { marketFetcherRegistry } from './fetcher-registry.js';
import type { MarketFetcherContext } from './types.js';
import { TronEnergyMarketFetcher } from './implementations/tron-energy-market.fetcher.js';
import { TronEnergyFetcher } from './implementations/tron-energy.fetcher.js';
import { FeeeIoFetcher } from './implementations/feee-io.fetcher.js';
import { TronSaveFetcher } from './implementations/tron-save.fetcher.js';
import { TronPulseFetcher } from './implementations/tron-pulse.fetcher.js';
import { ErgonFetcher } from './implementations/ergon.fetcher.js';
import { BrutusFinanceFetcher } from './implementations/brutus-finance.fetcher.js';
import { MeFreeNetFetcher } from './implementations/mefree-net.fetcher.js';
import { TronFeeEnergyRentalFetcher } from './implementations/tron-fee-energy-rental.fetcher.js';
import { TronifyFetcher } from './implementations/tronify.fetcher.js';
import { TronLendingFetcher } from './implementations/tron-lending.fetcher.js';
import { TronEnergizeFetcher } from './implementations/tron-energize.fetcher.js';
import { NitronEnergyFetcher } from './implementations/nitron-energy.fetcher.js';
import { ApiTrxFetcher } from './implementations/api-trx.fetcher.js';

const defaultContext: MarketFetcherContext = {
  http: httpClient,
  logger,
  cacheTtlSeconds: 300,
  chainParameters: null
};

export function initializeMarketFetchers() {
  const fetchers = [
    new TronEnergyMarketFetcher(),
    new TronEnergyFetcher(),
    new FeeeIoFetcher(),
    new TronSaveFetcher(),
    new TronPulseFetcher(),
    new ErgonFetcher(),
    new BrutusFinanceFetcher(),
    new MeFreeNetFetcher(),
    new TronFeeEnergyRentalFetcher(),
    new TronifyFetcher(),
    new TronLendingFetcher(),
    new TronEnergizeFetcher(),
    new NitronEnergyFetcher(),
    new ApiTrxFetcher()
  ];
  fetchers.forEach(fetcher => marketFetcherRegistry.register(fetcher));
}

export function getMarketFetcherContext(): MarketFetcherContext {
  return { ...defaultContext };
}

export { marketFetcherRegistry } from './fetcher-registry.js';
export type { MarketFetcher, MarketFetcherContext } from './types.js';
