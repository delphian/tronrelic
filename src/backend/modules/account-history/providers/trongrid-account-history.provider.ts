/**
 * @fileoverview TronGrid implementation of the account-history provider seam.
 *
 * Walks an account's history through BOTH TronGrid account endpoints, because
 * neither alone is complete:
 *   - `/v1/accounts/{addr}/transactions` (`source: 'tx'`) — native TRX, TRC10,
 *     staking, delegation, and raw contract calls. It indexes by the native
 *     transaction parties (owner/to), so it includes *outbound* TRC20 transfers
 *     (the account is the caller) but NOT inbound ones (the recipient is only
 *     inside the encoded call data, never a native party).
 *   - `/v1/accounts/{addr}/transactions/trc20` (`source: 'trc20'`) — decoded
 *     token transfers indexed by token-transfer participant, so it captures the
 *     inbound TRC20 transfers the native endpoint omits, with the token amount.
 * The service walks both with separate cursors and marks an account complete only
 * when both exhaust. TRC20 token amount/symbol/decimals ride in the normalized
 * transaction's `contract.parameters` (the open decoded-ABI-args domain), so
 * `IBlockTransaction` itself stays unextended.
 *
 * Calls route through the shared `TronGridClient` singleton so this backfill
 * inherits the global rate limiter and rotating keys — sharing the TronGrid
 * budget with live block sync rather than competing with it. Native items are
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
import type { AccountTxSource, IAccountTransactionRow, ITronGridAccountTx, ITronGridTrc20Tx } from '../database/index.js';
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
     * Fetch one page from the requested endpoint and normalize it. The `source`
     * selects which TronGrid endpoint to read; each carries its own fingerprint
     * cursor, tracked separately by the service.
     *
     * @param address - Base58 account address.
     * @param options - Endpoint source, page size, and continuation fingerprint.
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

        const client = TronGridClient.getInstance();
        if (options.source === 'trc20') {
            const response = await client.getTrc20Transactions<{
                data?: ITronGridTrc20Tx[];
                meta?: { fingerprint?: string };
            }>(address, params);
            const items = response?.data ?? [];
            const transactions = items
                .filter((item) => (item.type ?? 'Transfer') === 'Transfer')
                .map((item) => TronGridAccountHistoryProvider.toBlockTransactionFromTrc20(item));
            return { transactions, nextFingerprint: response?.meta?.fingerprint };
        }

        const response = await client.getAccountTransactions<{
            data?: ITronGridAccountTx[];
            meta?: { fingerprint?: string };
        }>(address, params);
        const items = response?.data ?? [];
        const transactions = items.map((item) => TronGridAccountHistoryProvider.toBlockTransaction(item));
        return { transactions, nextFingerprint: response?.meta?.fingerprint };
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
            memo: TronGridClient.decodeMemo(item.raw_data?.data)
        };
        return transaction;
    }

    /**
     * Map one decoded TRC20 transfer to the domain contract. The token contract,
     * amount, symbol, and decimals ride in `contract.parameters` (the open
     * decoded-ABI-args domain) so `IBlockTransaction` stays unextended; the
     * service lifts them into dedicated ClickHouse columns. The trc20 endpoint
     * returns only confirmed transfers and omits block number and native result,
     * so status is `SUCCESS` and block number 0.
     *
     * @param item - Raw TronGrid TRC20 transfer item.
     * @returns The normalized transaction.
     */
    private static toBlockTransactionFromTrc20(item: ITronGridTrc20Tx): IBlockTransaction {
        const transaction: IBlockTransaction = {
            txId: item.transaction_id ?? '',
            blockNumber: 0,
            timestamp: new Date(item.block_timestamp ?? 0),
            type: 'TriggerSmartContract',
            status: 'SUCCESS',
            from: { address: item.from ?? 'unknown' },
            to: { address: item.to ?? 'unknown' },
            contract: {
                address: item.token_info?.address ?? 'unknown',
                method: 'transfer',
                parameters: {
                    value: item.value ?? '0',
                    symbol: item.token_info?.symbol,
                    decimals: item.token_info?.decimals
                }
            },
            memo: null
        };
        return transaction;
    }
}

/**
 * Project a normalized transaction into a flat ClickHouse row for a given
 * tracked account and source. Kept beside the provider because it inverts the
 * same mapping; the service calls it for every fetched transaction before insert.
 * For `trc20` rows the token amount/symbol/decimals are lifted out of
 * `contract.parameters` (where the trc20 mapper placed them) into dedicated
 * columns; for `tx` rows the token columns are null.
 *
 * @param account - The tracked account this row is ingested for (dedup key).
 * @param tx - The normalized transaction.
 * @param source - Which endpoint produced it (`'tx'` or `'trc20'`); part of the dedup key.
 * @param timestamp - Formatted ClickHouse datetime for the transaction's block time.
 * @param ingestedAt - Formatted ClickHouse datetime used as the ReplacingMergeTree version.
 * @returns The ClickHouse row.
 */
export function toAccountTransactionRow(account: string, tx: IBlockTransaction, source: AccountTxSource, timestamp: string, ingestedAt: string): IAccountTransactionRow {
    const params = source === 'trc20' ? tx.contract?.parameters : undefined;
    const tokenAmount = params && params.value != null ? String(params.value) : null;
    const tokenSymbol = params && typeof params.symbol === 'string' ? params.symbol : null;
    const tokenDecimals = params && typeof params.decimals === 'number' ? params.decimals : null;

    const row: IAccountTransactionRow = {
        account,
        tx_id: tx.txId,
        source,
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
        token_amount: tokenAmount,
        token_symbol: tokenSymbol,
        token_decimals: tokenDecimals,
        memo: tx.memo ?? null,
        ingested_at: ingestedAt
    };
    return row;
}
