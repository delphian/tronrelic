import type { AxiosInstance } from 'axios';
import type { MarketSnapshot } from '../dtos/market-snapshot.dto.js';
import type { IChainParametersService, ISystemLogService } from '@tronrelic/types';

export interface MarketFetcherContext {
    http: AxiosInstance;
    logger: ISystemLogService;
    cacheTtlSeconds: number;
    chainParameters: IChainParametersService | null;
}

export interface MarketFetcher {
  readonly name: string;
  readonly guid: string;
  readonly timeoutMs: number;
  fetch(context: MarketFetcherContext): Promise<MarketSnapshot | null>;
}
