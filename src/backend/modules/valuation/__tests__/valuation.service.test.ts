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
import type { IValueTransfer, ISystemLogService } from '@/types';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';
import { ValuationService } from '../services/valuation.service.js';

const WALLET_A = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const WALLET_B = 'TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax';
const EXTERNAL = 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7';
const USER_ID = 'user-1';

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
 * Build a minimal TRX value-transfer leg. `origin` defaults to `native`
 * (a `TransferContract`-style top-level move); pass `internal` to model a TVM
 * transfer (a contract's deposit), which the ledger records as a first-class leg.
 *
 * @param from - Sender address.
 * @param to - Recipient address.
 * @param trx - TRX amount (human units).
 * @param day - UTC `YYYY-MM-DD` of the block.
 * @param origin - Leg origin; defaults to `native`.
 * @returns An IValueTransfer (TRX leg).
 */
function trxLeg(from: string, to: string, trx: number, day: string, origin: IValueTransfer['origin'] = 'native'): IValueTransfer {
    return {
        txId: `${from}-${to}-${day}`,
        origin,
        legKey: origin === 'internal' ? `${from}-${to}-${day}-ik` : '',
        assetType: 'TRX',
        assetId: '',
        from,
        to,
        amountRaw: String(trx * 1_000_000),
        timestamp: new Date(`${day}T00:00:00.000Z`),
        blockNumber: 1
    };
}

/**
 * Build a TRC10 value-transfer leg — a non-priceable asset the ledger may carry
 * but valuation must drop (only TRX and TRC20 have a USD price series). Under the
 * old transaction model this pollution arrived as a `TransferAssetContract` whose
 * `amount_sun` was a token count; the exclusion now happens on `assetType`.
 *
 * @param from - Sender address.
 * @param to - Recipient address.
 * @param raw - Raw token amount (base units).
 * @param day - UTC `YYYY-MM-DD` of the block.
 * @returns An IValueTransfer (TRC10 leg) that valuation must ignore.
 */
function trc10Leg(from: string, to: string, raw: number, day: string): IValueTransfer {
    return {
        txId: `trc10-${from}-${to}-${day}`,
        origin: 'native',
        legKey: '',
        assetType: 'TRC10',
        assetId: '1000001',
        from,
        to,
        amountRaw: String(raw),
        timestamp: new Date(`${day}T00:00:00.000Z`),
        blockNumber: 1
    };
}

/**
 * Build a fake account-history service from per-address value ledgers and snapshots.
 * The fake ignores `limit`/`offset` and returns the full array in one page — the
 * service's own `readLedger` loop still exercises normally since a full page
 * shorter than its page size ends pagination on the first call. Every requested
 * address reports ingestion `status: 'complete'` unless listed in
 * `incompleteAddresses`, so existing tests default to a fully-backfilled ledger.
 *
 * @param ledgers - Address → the complete value legs `getValueTransfers` returns.
 * @param balances - Address → liquid TRX (human units) in its latest snapshot.
 * @param incompleteAddresses - Addresses whose backfill should report `'running'` instead of `'complete'`.
 * @returns A partial IAccountHistoryService sufficient for the valuation reads.
 */
function fakeAccountHistory(
    ledgers: Record<string, IValueTransfer[]>,
    balances: Record<string, number>,
    incompleteAddresses: string[] = []
) {
    const incomplete = new Set(incompleteAddresses);
    return {
        getValueTransfers: vi.fn(async ({ address }: { address: string }) => ledgers[address] ?? []),
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
        ),
        getProgressFor: vi.fn(async (addresses: string[]) =>
            addresses.map((address) => ({
                address,
                status: incomplete.has(address) ? 'running' : 'complete',
                rowsIngested: 0
            }))
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
            fakeAccountHistory({ [WALLET_A]: [trxLeg(EXTERNAL, WALLET_A, 100, '2024-01-01')] }, { [WALLET_A]: 100 }),
            fakePriceHistory({ 'TRX|2024-01-01': 0.1 }, 0.2)
        );

        const summary = await service.getPortfolio({ userId: USER_ID, addresses: [WALLET_A], ownedAddresses: [WALLET_A], scope: 'wallet' });

        const trx = summary.holdings.find((holding) => holding.asset === 'TRX');
        expect(trx?.quantity).toBeCloseTo(100, 6);
        expect(summary.netWorthUsd).toBeCloseTo(20, 6); // 100 TRX * $0.20
        expect(summary.realizedPnlUsd).toBeCloseTo(0, 6); // nothing disposed
        expect(summary.unrealizedPnlUsd).toBeCloseTo(10, 6); // value 20 - basis 10
    });

    it('excludes non-priceable asset legs (TRC10) from the TRX series', async () => {
        // The value ledger can carry a TRC10 leg (a non-priceable asset). Only TRX
        // and TRC20 have a USD price series, so valuation must drop the TRC10 leg —
        // otherwise it would invent a phantom holding and pollute the TRX basis. The
        // TRX basis must reflect only the genuine 100 TRX transfer.
        const service = buildService(
            fakeAccountHistory(
                {
                    [WALLET_A]: [
                        trxLeg(EXTERNAL, WALLET_A, 100, '2024-01-01'),
                        trc10Leg(EXTERNAL, WALLET_A, 30_000 * 1_000_000, '2024-01-01')
                    ]
                },
                { [WALLET_A]: 100 }
            ),
            fakePriceHistory({ 'TRX|2024-01-01': 0.1 }, 0.2)
        );

        const summary = await service.getPortfolio({ userId: USER_ID, addresses: [WALLET_A], ownedAddresses: [WALLET_A], scope: 'wallet' });

        const trx = summary.holdings.find((holding) => holding.asset === 'TRX');
        expect(trx?.costBasisUsd).toBeCloseTo(10, 6); // only 100 TRX @ $0.10 — TRC10 leg excluded
        expect(summary.holdings).toHaveLength(1); // dropped leg creates no phantom holding
    });

    it('nets out a transfer between the user own wallets (no realized gain)', async () => {
        const service = buildService(
            fakeAccountHistory(
                {
                    [WALLET_A]: [trxLeg(WALLET_A, WALLET_B, 50, '2024-01-01')],
                    [WALLET_B]: [trxLeg(WALLET_A, WALLET_B, 50, '2024-01-01')]
                },
                { [WALLET_A]: 50, [WALLET_B]: 50 }
            ),
            fakePriceHistory({ 'TRX|2024-01-01': 0.1 }, 0.2)
        );

        const summary = await service.getPortfolio({
            userId: USER_ID,
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
                    [WALLET_A]: [trxLeg(EXTERNAL, WALLET_A, 100, '2024-01-01'), trxLeg(WALLET_A, WALLET_B, 60, '2024-01-02')],
                    [WALLET_B]: [trxLeg(WALLET_A, WALLET_B, 60, '2024-01-02')]
                },
                { [WALLET_A]: 40, [WALLET_B]: 60 }
            ),
            fakePriceHistory({ 'TRX|2024-01-01': 0.1, 'TRX|2024-01-02': 0.1 }, 0.1)
        );

        const summary = await service.getPortfolio({
            userId: USER_ID,
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

    it('clips the balance series to the default trailing year absent an admin override', async () => {
        // The snapshot anchors at 2024-02-01; a deposit almost two years earlier is
        // far outside the default 365-day window, so the series must not reach it.
        const service = buildService(
            fakeAccountHistory({ [WALLET_A]: [trxLeg(EXTERNAL, WALLET_A, 100, '2022-01-01')] }, { [WALLET_A]: 100 }),
            fakePriceHistory({}, 0.2)
        );

        const summary = await service.getPortfolio({ userId: USER_ID, addresses: [WALLET_A], ownedAddresses: [WALLET_A], scope: 'wallet' });

        expect(summary.balanceSeriesUsd[0]?.day).toBe('2023-02-01'); // trailing-year floor, not the 2022 deposit
    });

    it("widens the balance series to the full ledger when an admin sets a wallet's range to 'all'", async () => {
        resetService();
        const registry = createMockServiceRegistry({
            'account-history': fakeAccountHistory({ [WALLET_A]: [trxLeg(EXTERNAL, WALLET_A, 100, '2022-01-01')] }, { [WALLET_A]: 100 }),
            'price-history': fakePriceHistory({}, 0.2),
            'user-settings': { getNamespace: vi.fn(async () => ({ [WALLET_A]: 'all' })) }
        });
        ValuationService.setDependencies({ serviceRegistry: registry, logger: silentLogger() });

        const summary = await ValuationService.getInstance().getPortfolio({
            userId: USER_ID,
            addresses: [WALLET_A],
            ownedAddresses: [WALLET_A],
            scope: 'wallet'
        });

        expect(summary.balanceSeriesUsd[0]?.day).toBe('2022-01-01'); // the admin override reaches the true deposit day
    });

    it('flags historyBackfillComplete true when every in-scope address has finished backfill', async () => {
        const service = buildService(
            fakeAccountHistory({ [WALLET_A]: [trxLeg(EXTERNAL, WALLET_A, 100, '2024-01-01')] }, { [WALLET_A]: 100 }),
            fakePriceHistory({ 'TRX|2024-01-01': 0.1 }, 0.2)
        );

        const summary = await service.getPortfolio({ userId: USER_ID, addresses: [WALLET_A], ownedAddresses: [WALLET_A], scope: 'wallet' });

        expect(summary.historyBackfillComplete).toBe(true);
    });

    it('flags historyBackfillComplete false when an in-scope address is still backfilling', async () => {
        const service = buildService(
            fakeAccountHistory(
                { [WALLET_A]: [trxLeg(EXTERNAL, WALLET_A, 100, '2024-01-01')] },
                { [WALLET_A]: 100 },
                [WALLET_A] // still 'running'
            ),
            fakePriceHistory({ 'TRX|2024-01-01': 0.1 }, 0.2)
        );

        const summary = await service.getPortfolio({ userId: USER_ID, addresses: [WALLET_A], ownedAddresses: [WALLET_A], scope: 'wallet' });

        expect(summary.historyBackfillComplete).toBe(false);
    });

    it('flags historyBackfillComplete false when an in-scope address has no progress record at all', async () => {
        // Never ticked yet (e.g. just linked) — absence must read as "not complete",
        // not as "nothing to report".
        resetService();
        const registry = createMockServiceRegistry({
            'account-history': {
                ...fakeAccountHistory({ [WALLET_A]: [trxLeg(EXTERNAL, WALLET_A, 100, '2024-01-01')] }, { [WALLET_A]: 100 }),
                getProgressFor: vi.fn(async () => [])
            },
            'price-history': fakePriceHistory({ 'TRX|2024-01-01': 0.1 }, 0.2)
        });
        ValuationService.setDependencies({ serviceRegistry: registry, logger: silentLogger() });

        const summary = await ValuationService.getInstance().getPortfolio({
            userId: USER_ID,
            addresses: [WALLET_A],
            ownedAddresses: [WALLET_A],
            scope: 'wallet'
        });

        expect(summary.historyBackfillComplete).toBe(false);
    });

    it('returns a zeroed summary when the data services are unavailable', async () => {
        resetService();
        const registry = createMockServiceRegistry({});
        ValuationService.setDependencies({ serviceRegistry: registry, logger: silentLogger() });
        const summary = await ValuationService.getInstance().getPortfolio({ userId: USER_ID, addresses: [WALLET_A], ownedAddresses: [WALLET_A], scope: 'wallet' });
        expect(summary.netWorthUsd).toBe(0);
        expect(summary.holdings).toEqual([]);
    });
});
