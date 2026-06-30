/**
 * @fileoverview Tests for the valuation orchestration service.
 *
 * Validates the join the pure engine cannot: holdings/net worth sourced from the
 * balance snapshot, cost basis from the ledger priced by the price series, and —
 * the headline correctness property — that a transfer between two wallets the
 * same user owns nets out to zero realized PnL at the aggregate scope. Fakes
 * stand in for the account-history and price-history services via the registry.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IBlockTransaction, ISystemLogService } from '@/types';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';
import { ValuationService } from '../services/valuation.service.js';

const WALLET_A = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const WALLET_B = 'TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax';
const EXTERNAL = 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7';

/** No-op logger. */
function silentLogger(): ISystemLogService {
    const logger = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return logger; } };
    return logger as unknown as ISystemLogService;
}

/** Reset the valuation singleton between tests. */
function resetService(): void {
    (ValuationService as unknown as { instance: ValuationService | null }).instance = null;
}

/**
 * Build a minimal TRX-transfer transaction.
 *
 * @param from - Sender address.
 * @param to - Recipient address.
 * @param trx - TRX amount (human units).
 * @param day - UTC `YYYY-MM-DD` of the block.
 * @returns An IBlockTransaction.
 */
function trxTx(from: string, to: string, trx: number, day: string): IBlockTransaction {
    return {
        txId: `${from}-${to}-${day}`,
        blockNumber: 1,
        timestamp: new Date(`${day}T00:00:00.000Z`),
        type: 'TransferContract',
        status: 'SUCCESS',
        from: { address: from },
        to: { address: to },
        amountSun: trx * 1_000_000
    };
}

/**
 * Build a transaction that carries `amount_sun` but is NOT a native-TRX move —
 * a TRC10 `TransferAssetContract` (whose `amount_sun` is a token count) or a
 * `DelegateResourceContract` (whose `amount_sun` is delegated stake). The ledger
 * populates `amount_sun` from a per-type field, so these once leaked into the TRX
 * series; the type guard must now drop them.
 *
 * @param type - Native contract type to stamp on the row.
 * @param from - Sender address.
 * @param to - Recipient address.
 * @param sun - Raw `amount_sun` value (a non-TRX quantity for these types).
 * @param day - UTC `YYYY-MM-DD` of the block.
 * @returns An IBlockTransaction with a non-TRX `amount_sun`.
 */
function nonTrxAmountTx(type: string, from: string, to: string, sun: number, day: string): IBlockTransaction {
    return {
        txId: `${type}-${from}-${to}-${day}`,
        blockNumber: 1,
        timestamp: new Date(`${day}T00:00:00.000Z`),
        type,
        status: 'SUCCESS',
        from: { address: from },
        to: { address: to },
        amountSun: sun
    };
}

/**
 * Build a fake account-history service from per-address ledgers and snapshots.
 *
 * @param ledgers - Address → the transactions a windowed `getTransactions` returns.
 * @param balances - Address → liquid TRX (human units) in its latest snapshot.
 * @param fullLedgers - Address → the complete row set a by-`txId` refetch can reach;
 *   defaults to `ledgers`. Diverging it from `ledgers` simulates a row that fell
 *   outside the per-wallet read window but is still fetchable by hash.
 * @returns A partial IAccountHistoryService sufficient for the valuation reads.
 */
function fakeAccountHistory(
    ledgers: Record<string, IBlockTransaction[]>,
    balances: Record<string, number>,
    fullLedgers: Record<string, IBlockTransaction[]> = ledgers
) {
    return {
        getTransactions: vi.fn(async ({ address }: { address: string }) => ({
            transactions: ledgers[address] ?? [],
            total: (ledgers[address] ?? []).length
        })),
        getTransactionsByTxIds: vi.fn(async (address: string, txIds: string[]) =>
            (fullLedgers[address] ?? []).filter((tx) => txIds.includes(tx.txId))
        ),
        getLatestSnapshot: vi.fn(async (address: string) =>
            balances[address] === undefined
                ? null
                : {
                      address,
                      capturedAt: new Date('2024-02-01T00:00:00.000Z'),
                      trxBalanceSun: balances[address] * 1_000_000,
                      stakedEnergySun: 0,
                      stakedBandwidthSun: 0,
                      unstakingSun: 0,
                      energyLimit: 0,
                      energyUsed: 0,
                      netLimit: 0,
                      netUsed: 0,
                      tokenBalances: []
                  }
        )
    };
}

/**
 * Build a fake price-history service with a fixed historical price table and a
 * fixed current TRX price.
 *
 * @param historical - `'asset|day'` → USD price for the cost-basis lookup.
 * @param current - The latest TRX/USD price returned by series reads.
 * @returns A partial IPriceHistoryService.
 */
function fakePriceHistory(historical: Record<string, number>, current: number) {
    return {
        ensureAssetsTracked: vi.fn(async () => {}),
        getPricesForDays: vi.fn(async (asset: string, days: string[]) =>
            days
                .filter((day) => historical[`${asset}|${day}`] !== undefined)
                .map((day) => ({ asset, day, priceUsd: historical[`${asset}|${day}`] }))
        ),
        getSeries: vi.fn(async (asset: string, _from: string, to: string) => [{ asset, day: to, priceUsd: current }]),
        getPriceOn: vi.fn(async () => null)
    };
}

/**
 * Wire the valuation service against the given fakes through the registry.
 *
 * @param accountHistory - Fake account-history service.
 * @param priceHistory - Fake price-history service.
 * @returns The configured valuation service.
 */
function buildService(accountHistory: unknown, priceHistory: unknown): ValuationService {
    resetService();
    const registry = createMockServiceRegistry({ 'account-history': accountHistory, 'price-history': priceHistory });
    ValuationService.setDependencies({ serviceRegistry: registry, logger: silentLogger() });
    return ValuationService.getInstance();
}

describe('ValuationService.getPortfolio', () => {
    beforeEach(() => {
        resetService();
    });

    it('values current holdings from the snapshot and cost basis from the ledger', async () => {
        const service = buildService(
            fakeAccountHistory({ [WALLET_A]: [trxTx(EXTERNAL, WALLET_A, 100, '2024-01-01')] }, { [WALLET_A]: 100 }),
            fakePriceHistory({ 'TRX|2024-01-01': 0.1 }, 0.2)
        );

        const summary = await service.getPortfolio({ addresses: [WALLET_A], ownedAddresses: [WALLET_A], scope: 'wallet' });

        const trx = summary.holdings.find((holding) => holding.asset === 'TRX');
        expect(trx?.quantity).toBeCloseTo(100, 6);
        expect(summary.netWorthUsd).toBeCloseTo(20, 6); // 100 TRX * $0.20
        expect(summary.realizedPnlUsd).toBeCloseTo(0, 6); // nothing disposed
        expect(summary.unrealizedPnlUsd).toBeCloseTo(10, 6); // value 20 - basis 10
    });

    it('excludes non-TRX contract amounts (TRC10, delegation) from the TRX series', async () => {
        // `amount_sun` on a TransferAssetContract is a TRC10 token count, and on a
        // DelegateResourceContract a delegated stake — neither is spendable TRX.
        // Both once folded into the TRX cost basis (and inflated the balance
        // series until the display clamp flattened it). The type guard must drop
        // them so the TRX basis reflects only the genuine 100 TRX transfer.
        const service = buildService(
            fakeAccountHistory(
                {
                    [WALLET_A]: [
                        trxTx(EXTERNAL, WALLET_A, 100, '2024-01-01'),
                        nonTrxAmountTx('TransferAssetContract', EXTERNAL, WALLET_A, 30_000 * 1_000_000, '2024-01-01'),
                        nonTrxAmountTx('DelegateResourceContract', EXTERNAL, WALLET_A, 11_585 * 1_000_000, '2024-01-01')
                    ]
                },
                { [WALLET_A]: 100 }
            ),
            fakePriceHistory({ 'TRX|2024-01-01': 0.1 }, 0.2)
        );

        const summary = await service.getPortfolio({ addresses: [WALLET_A], ownedAddresses: [WALLET_A], scope: 'wallet' });

        const trx = summary.holdings.find((holding) => holding.asset === 'TRX');
        expect(trx?.costBasisUsd).toBeCloseTo(10, 6); // only 100 TRX @ $0.10 — polluting rows excluded
        expect(summary.holdings).toHaveLength(1); // dropped rows create no phantom holding
    });

    it('nets out a transfer between the user own wallets (no realized gain)', async () => {
        const service = buildService(
            fakeAccountHistory(
                {
                    [WALLET_A]: [trxTx(WALLET_A, WALLET_B, 50, '2024-01-01')],
                    [WALLET_B]: [trxTx(WALLET_A, WALLET_B, 50, '2024-01-01')]
                },
                { [WALLET_A]: 50, [WALLET_B]: 50 }
            ),
            fakePriceHistory({ 'TRX|2024-01-01': 0.1 }, 0.2)
        );

        const summary = await service.getPortfolio({
            addresses: [WALLET_A, WALLET_B],
            ownedAddresses: [WALLET_A, WALLET_B],
            scope: 'user'
        });

        expect(summary.realizedPnlUsd).toBeCloseTo(0, 6); // internal move, not a disposal
        expect(summary.netWorthUsd).toBeCloseTo(20, 6); // 100 TRX total * $0.20
    });

    it('preserves migrated basis in the per-wallet zoom (no phantom gain on internal funding)', async () => {
        // A buys 100 TRX @ $0.10 externally, then sends 60 to B internally. Zooming B
        // must carry B's 60 at the $6 basis that travelled from A — not zero basis,
        // which would invent a $6 unrealized gain on a wallet that never bought.
        const service = buildService(
            fakeAccountHistory(
                {
                    [WALLET_A]: [trxTx(EXTERNAL, WALLET_A, 100, '2024-01-01'), trxTx(WALLET_A, WALLET_B, 60, '2024-01-02')],
                    [WALLET_B]: [trxTx(WALLET_A, WALLET_B, 60, '2024-01-02')]
                },
                { [WALLET_A]: 40, [WALLET_B]: 60 }
            ),
            fakePriceHistory({ 'TRX|2024-01-01': 0.1, 'TRX|2024-01-02': 0.1 }, 0.1)
        );

        const summary = await service.getPortfolio({
            addresses: [WALLET_B],
            ownedAddresses: [WALLET_A, WALLET_B],
            scope: 'wallet'
        });

        const trx = summary.holdings.find((holding) => holding.asset === 'TRX');
        expect(trx?.quantity).toBeCloseTo(60, 6);
        expect(trx?.costBasisUsd).toBeCloseTo(6, 6); // 60 * $0.10, migrated from A
        expect(summary.unrealizedPnlUsd).toBeCloseTo(0, 6); // value 6 - basis 6, not 6 - 0
        expect(summary.realizedPnlUsd).toBeCloseTo(0, 6);
    });

    it('repairs an internal transfer whose receiving leg fell outside the read window', async () => {
        // A buys 100 @ $0.10, sends 60 to B internally (01-02), then B sells 60
        // externally (01-03) @ $0.20. B's windowed ledger has only the sale — the
        // internal-in row was pushed past B's window. Without repair the sale
        // realizes against ZERO basis ($12 phantom gain); the by-txId refetch
        // restores B's $6 migrated basis so realized is the true $6.
        const internalTx = trxTx(WALLET_A, WALLET_B, 60, '2024-01-02');
        const accountHistory = fakeAccountHistory(
            {
                [WALLET_A]: [trxTx(EXTERNAL, WALLET_A, 100, '2024-01-01'), internalTx],
                // B's window: only the external sale; the internal-in is missing.
                [WALLET_B]: [trxTx(WALLET_B, EXTERNAL, 60, '2024-01-03')]
            },
            { [WALLET_A]: 40, [WALLET_B]: 0 },
            {
                // Full reach for the by-txId refetch: B's internal-in row is fetchable.
                [WALLET_A]: [internalTx],
                [WALLET_B]: [internalTx]
            }
        );
        const service = buildService(
            accountHistory,
            fakePriceHistory({ 'TRX|2024-01-01': 0.1, 'TRX|2024-01-03': 0.2 }, 0.2)
        );

        const summary = await service.getPortfolio({
            addresses: [WALLET_A, WALLET_B],
            ownedAddresses: [WALLET_A, WALLET_B],
            scope: 'user'
        });

        expect(accountHistory.getTransactionsByTxIds).toHaveBeenCalled();
        expect(summary.realizedPnlUsd).toBeCloseTo(6, 6); // proceeds 12 - migrated basis 6, not 12 - 0
    });

    it('returns a zeroed summary when the data services are unavailable', async () => {
        resetService();
        const registry = createMockServiceRegistry({});
        ValuationService.setDependencies({ serviceRegistry: registry, logger: silentLogger() });
        const summary = await ValuationService.getInstance().getPortfolio({ addresses: [WALLET_A], ownedAddresses: [WALLET_A], scope: 'wallet' });
        expect(summary.netWorthUsd).toBe(0);
        expect(summary.holdings).toEqual([]);
    });
});
