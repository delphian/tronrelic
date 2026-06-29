/**
 * @fileoverview TronGrid implementation of the account-history provider seam.
 *
 * Walks an account's history through TronGrid's `/v1/accounts/{addr}/transactions`
 * endpoint, which returns *every* transaction type — native TRX, TRC10, staking,
 * delegation, and contract calls (TRC20 transfers surface as TriggerSmartContract).
 * One endpoint therefore covers "all transaction types"; the TRC20-specific
 * endpoint is intentionally not used because it only adds decoded token amounts,
 * which `IBlockTransaction` does not model.
 *
 * Calls route through the shared `TronGridClient` singleton so this backfill
 * inherits the global rate limiter and rotating keys — sharing the TronGrid
 * budget with live block sync rather than competing with it. Each raw item is
 * normalized to `IBlockTransaction` via the blockchain module's pure parsers, so
 * the account-history and block-sync pipelines interpret a contract identically.
 */

import type { IBlockTransaction } from '@/types';
import { TronGridClient } from '../../blockchain/tron-grid.client.js';
import {
    normalizeContractType,
    resolveOwnerAddress,
    resolveRecipient,
    resolveAmounts,
    describeContract
} from '../../blockchain/transaction-parse.js';
import type { IAccountTransactionRow, ITronGridAccountTx } from '../database/index.js';
import type { IAccountHistoryFetchOptions, IAccountHistoryPageResult, IAccountHistoryProvider } from './IAccountHistoryProvider.js';

/** TronGrid's hard ceiling on page size for the account-transactions endpoint. */
const MAX_PAGE_SIZE = 200;

/**
 * Reads account history from TronGrid behind the provider seam.
 */
export class TronGridAccountHistoryProvider implements IAccountHistoryProvider {
    /** Stable provider id for audit/logs. */
    readonly id = 'trongrid';

    /**
     * Fetch one page of all-type transactions for an account and normalize them.
     *
     * @param address - Base58 account address.
     * @param options - Page size and continuation fingerprint.
     * @returns Normalized transactions plus the next-page cursor.
     */
    async fetchPage(address: string, options: IAccountHistoryFetchOptions): Promise<IAccountHistoryPageResult> {
        const params: Record<string, string | number | boolean> = {
            only_confirmed: true,
            limit: Math.min(Math.max(1, options.limit), MAX_PAGE_SIZE),
            order_by: 'block_timestamp,desc'
        };
        if (options.fingerprint) {
            params.fingerprint = options.fingerprint;
        }

        const response = await TronGridClient.getInstance().getAccountTransactions<{
            data?: ITronGridAccountTx[];
            meta?: { fingerprint?: string };
        }>(address, params);

        const items = response?.data ?? [];
        const transactions = items.map((item) => TronGridAccountHistoryProvider.toBlockTransaction(item));

        const result: IAccountHistoryPageResult = {
            transactions,
            nextFingerprint: response?.meta?.fingerprint
        };
        return result;
    }

    /**
     * Map one raw TronGrid account-transaction item to the source-independent
     * domain contract, reusing the blockchain module's parsers so field meaning
     * never drifts from the sync pipeline.
     *
     * @param item - Raw TronGrid transaction envelope.
     * @returns The normalized transaction.
     */
    private static toBlockTransaction(item: ITronGridAccountTx): IBlockTransaction {
        const contract0 = item.raw_data?.contract?.[0];
        const rawType = contract0?.type;
        const value = contract0?.parameter?.value ?? {};

        const normalized = normalizeContractType(rawType);
        const from = resolveOwnerAddress(value);
        const to = resolveRecipient(normalized, value, from);
        const { rawAmountSun } = resolveAmounts(normalized, value);

        const isContractCall = normalized === 'TriggerSmartContract' || normalized === 'CreateSmartContract';
        const details = isContractCall ? describeContract(normalized, value) : undefined;

        const hasEnergy = item.energy_usage_total !== undefined || item.energy_usage !== undefined || item.energy_fee !== undefined;
        const hasBandwidth = item.net_usage !== undefined || item.net_fee !== undefined;

        const transaction: IBlockTransaction = {
            txId: item.txID ?? '',
            blockNumber: item.blockNumber ?? 0,
            timestamp: new Date(item.block_timestamp ?? 0),
            type: rawType ?? 'Unknown',
            status: item.ret?.[0]?.contractRet ?? 'UNKNOWN',
            from: { address: from },
            to: { address: to },
            amountSun: rawAmountSun > 0 ? rawAmountSun : undefined,
            feeSun: typeof item.fee === 'number' ? item.fee : undefined,
            energy: hasEnergy
                ? { consumed: item.energy_usage_total ?? item.energy_usage ?? 0, feeSun: item.energy_fee ?? 0 }
                : undefined,
            bandwidth: hasBandwidth
                ? { consumed: item.net_usage ?? 0, feeSun: item.net_fee ?? 0 }
                : undefined,
            contract: details ? { address: details.address, method: details.method, parameters: details.parameters } : undefined,
            memo: item.raw_data?.data ?? null
        };
        return transaction;
    }
}

/**
 * Project a normalized transaction into a flat ClickHouse row for a given
 * tracked account. Kept beside the provider because it inverts the same mapping;
 * the service calls it for every fetched transaction before insert.
 *
 * @param account - The tracked account this row is ingested for (dedup key).
 * @param tx - The normalized transaction.
 * @param ingestedAt - Formatted ClickHouse datetime used as the ReplacingMergeTree version.
 * @returns The ClickHouse row.
 */
export function toAccountTransactionRow(account: string, tx: IBlockTransaction, timestamp: string, ingestedAt: string): IAccountTransactionRow {
    const row: IAccountTransactionRow = {
        account,
        tx_id: tx.txId,
        block_number: tx.blockNumber,
        timestamp,
        type: tx.type,
        status: tx.status,
        from_address: tx.from.address,
        to_address: tx.to.address,
        amount_sun: tx.amountSun ?? null,
        fee_sun: tx.feeSun ?? null,
        energy_consumed: tx.energy?.consumed ?? null,
        energy_fee_sun: tx.energy?.feeSun ?? null,
        bandwidth_consumed: tx.bandwidth?.consumed ?? null,
        bandwidth_fee_sun: tx.bandwidth?.feeSun ?? null,
        contract_address: tx.contract?.address ?? null,
        contract_method: tx.contract?.method ?? null,
        memo: tx.memo ?? null,
        ingested_at: ingestedAt
    };
    return row;
}
