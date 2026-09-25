/**
 * @fileoverview Everything a chain query tool needs, gathered in one object.
 *
 * Each tool builder receives this toolkit instead of the service registry, so
 * a tool depends on a small interface a test can fake, and the lookups every
 * tool shares (coverage, token metadata, tags, prices) are built once and
 * share their caches.
 *
 * @module backend/modules/blockchain/chain-query/ChainQueryToolkit
 */

import type {
    IAddressTagService,
    IClickHouseAccountService,
    IPriceHistoryService,
    IServiceRegistry,
    IToolHandlerContext
} from '@/types';
import { CHAIN_DATA_RETENTION_DAYS } from '../chain-data/buildChainDataSchema.js';
import { AddressTagLookup } from './AddressTagLookup.js';
import { ChainCoverageReader } from './ChainCoverageReader.js';
import { ChainQueryError } from './ChainQueryError.js';
import { ChainQuerySession } from './ChainQuerySession.js';
import { TokenCatalog } from './TokenCatalog.js';
import { UsdPricer } from './UsdPricer.js';

/** The ClickHouse account every chain query tool reads as. */
export const CHAIN_QUERY_ACCOUNT_ID = 'ai-agent';

/** What a chain query tool is built from. */
export interface IChainQueryToolkit {
    /**
     * Open a session reading as the `ai-agent` account for one tool call.
     *
     * @param context - The run identity the governor passed to the handler.
     * @returns The session; the caller disposes it when the call ends.
     * @throws ChainQueryError of kind `unavailable` when ClickHouse or the account is not usable.
     */
    openSession(context: IToolHandlerContext | undefined): ChainQuerySession;
    /** Coverage of a window, cached briefly across calls. */
    coverage: ChainCoverageReader;
    /** Token metadata, with resolved tokens cached for the life of the process. */
    tokens: TokenCatalog;
    /** Active address tags. */
    tags: AddressTagLookup;
    /** Daily closing prices. */
    prices: UsdPricer;
    /** How many days of chain data ClickHouse keeps. */
    retentionDays: number;
    /** The current time, injectable for tests. */
    now(): Date;
}

/**
 * Build the toolkit from the service registry.
 *
 * Every service is looked up when a tool runs rather than here, because the
 * ClickHouse accounts, address tags, and price history modules publish their
 * services during their own startup, after the tools are registered.
 *
 * @param serviceRegistry - The registry the modules publish their services on.
 * @returns The toolkit every chain query tool is built from.
 */
export function createChainQueryToolkit(serviceRegistry: IServiceRegistry): IChainQueryToolkit {
    return {
        openSession: (context) => {
            const accounts = serviceRegistry.get<IClickHouseAccountService>('clickhouse-accounts');
            if (!accounts) {
                throw new ChainQueryError('Chain data is not available on this deployment: ClickHouse is not configured.', 'unavailable');
            }
            let session: ChainQuerySession;
            try {
                session = new ChainQuerySession(accounts.reader(CHAIN_QUERY_ACCOUNT_ID), context);
            } catch {
                throw new ChainQueryError(
                    'Chain data cannot be read right now: the ai-agent ClickHouse account is not active. An operator can check it on the ClickHouse tab of /system/system.',
                    'unavailable'
                );
            }
            return session;
        },
        coverage: new ChainCoverageReader(),
        tokens: new TokenCatalog(),
        tags: new AddressTagLookup(() => serviceRegistry.get<IAddressTagService>('address-tags')),
        prices: new UsdPricer(() => serviceRegistry.get<IPriceHistoryService>('price-history')),
        retentionDays: CHAIN_DATA_RETENTION_DAYS,
        now: () => new Date()
    };
}
