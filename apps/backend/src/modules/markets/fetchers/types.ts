import type { AxiosInstance } from 'axios';
import type { Logger } from 'pino';
import type { MarketSnapshot } from '../dtos/market-snapshot.dto.js';
import type { IChainParametersService } from '@tronrelic/types';

export interface MarketFetcherContext {
    http: AxiosInstance;
    logger: Logger;
    cacheTtlSeconds: number;
    chainParameters: IChainParametersService | null;
}

export interface MarketFetcher {
  readonly name: string;
  readonly guid: string;
  readonly schedule: string;
  readonly timeoutMs: number;
  fetch(context: MarketFetcherContext): Promise<MarketSnapshot | null>;
}
