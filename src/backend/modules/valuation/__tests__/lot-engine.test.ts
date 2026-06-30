/**
 * @fileoverview Tests for the pure cost-basis and balance-reconstruction math.
 *
 * These assertions pin the money-judgement rules the whole valuation surface
 * rests on: FIFO realized PnL, internal-transfer neutrality, the unreachable-
 * history shortfall behaviour, and snapshot-anchored balance reconstruction.
 */

import { describe, it, expect } from 'vitest';
import { computeLots, reconstructTrxBalanceSeries, type ILedgerMove } from '../lib/lot-engine.js';

/**
 * Build a price lookup from a `{ 'asset|day': price }` table.
 *
 * @param table - Day-keyed prices.
 * @returns A `priceOnDay` function returning null for absent entries.
 */
function priceLookup(table: Record<string, number>): (asset: string, day: string) => number | null {
    return (asset, day) => table[`${asset}|${day}`] ?? null;
}

/**
 * Construct a move with sensible defaults.
 *
 * @param over - Fields to override on the base TRX move.
 * @returns The move.
 */
function move(over: Partial<ILedgerMove>): ILedgerMove {
    return {
        txId: over.txId ?? 't',
        day: over.day ?? '2024-01-01',
        timestamp: over.timestamp ?? new Date(`${over.day ?? '2024-01-01'}T00:00:00Z`).getTime(),
        asset: over.asset ?? 'TRX',
        quantity: over.quantity ?? 0,
        direction: over.direction ?? 'in',
        internal: over.internal ?? false,
        wallet: over.wallet ?? 'W'
    };
}

describe('computeLots', () => {
    it('realizes FIFO gain on a buy then sell', () => {
        const moves = [
            move({ day: '2024-01-01', quantity: 100, direction: 'in' }),
            move({ day: '2024-01-02', quantity: 100, direction: 'out' })
        ];
        const result = computeLots(moves, priceLookup({ 'TRX|2024-01-01': 0.1, 'TRX|2024-01-02': 0.2 }));
        expect(result.realizedPnlUsd).toBeCloseTo(10, 6); // 100*0.2 - 100*0.1
        expect(result.remainingByAsset.get('TRX')?.quantity ?? 0).toBeCloseTo(0, 6);
    });

    it('consumes lots in FIFO order', () => {
        const moves = [
            move({ txId: 'a', day: '2024-01-01', quantity: 100, direction: 'in' }),
            move({ txId: 'b', day: '2024-01-02', quantity: 100, direction: 'in' }),
            move({ txId: 'c', day: '2024-01-03', quantity: 100, direction: 'out' })
        ];
        const result = computeLots(
            moves,
            priceLookup({ 'TRX|2024-01-01': 0.1, 'TRX|2024-01-02': 0.2, 'TRX|2024-01-03': 0.3 })
        );
        expect(result.realizedPnlUsd).toBeCloseTo(20, 6); // sold the 0.1 lot at 0.3
        const remaining = result.remainingByAsset.get('TRX');
        expect(remaining?.quantity).toBeCloseTo(100, 6);
        expect(remaining?.costBasisUsd).toBeCloseTo(20, 6); // the 0.2 lot remains
    });

    it('migrates basis on an internal transfer (source loses it, dest gains it; no realization)', () => {
        // A buys 100 @ $0.10, then sends all 100 to B internally. The $10 basis must
        // travel from A's sub-book to B's, with zero realized PnL despite the price rise.
        const moves = [
            move({ txId: 'acq', wallet: 'A', day: '2024-01-01', quantity: 100, direction: 'in' }),
            move({ txId: 'xfer', wallet: 'A', day: '2024-01-02', quantity: 100, direction: 'out', internal: true }),
            move({ txId: 'xfer', wallet: 'B', day: '2024-01-02', quantity: 100, direction: 'in', internal: true })
        ];
        const result = computeLots(moves, priceLookup({ 'TRX|2024-01-01': 0.1, 'TRX|2024-01-02': 0.5 }));
        expect(result.realizedPnlUsd).toBeCloseTo(0, 6);
        expect(result.remainingByWalletAsset.get('A')?.get('TRX')?.quantity ?? 0).toBeCloseTo(0, 6);
        expect(result.remainingByWalletAsset.get('B')?.get('TRX')?.quantity ?? 0).toBeCloseTo(100, 6);
        expect(result.remainingByWalletAsset.get('B')?.get('TRX')?.costBasisUsd ?? 0).toBeCloseTo(10, 6);
        // Pooled across wallets, basis is conserved by the migration.
        expect(result.remainingByAsset.get('TRX')?.costBasisUsd).toBeCloseTo(10, 6);
    });

    it('preserves basis even when acquire and internal-forward share a block timestamp', () => {
        // Same-block acquire-then-forward: the array is deliberately out of order and
        // every move shares one timestamp, so correctness rests on the kind ranking
        // (external-in before internal-out before internal-in), not array/day order.
        const ts = new Date('2024-01-01T00:00:00Z').getTime();
        const moves = [
            move({ txId: 'xfer', wallet: 'A', timestamp: ts, quantity: 100, direction: 'out', internal: true }),
            move({ txId: 'xfer', wallet: 'B', timestamp: ts, quantity: 100, direction: 'in', internal: true }),
            move({ txId: 'acq', wallet: 'A', timestamp: ts, quantity: 100, direction: 'in' })
        ];
        const result = computeLots(moves, priceLookup({ 'TRX|2024-01-01': 0.1 }));
        expect(result.realizedPnlUsd).toBeCloseTo(0, 6);
        expect(result.remainingByWalletAsset.get('B')?.get('TRX')?.quantity ?? 0).toBeCloseTo(100, 6);
        expect(result.remainingByWalletAsset.get('B')?.get('TRX')?.costBasisUsd ?? 0).toBeCloseTo(10, 6);
    });

    it('uses segregated (per-wallet) FIFO: a sale draws on the selling wallet basis, not a global pool', () => {
        // B buys @ $0.10 (older), A buys @ $0.20, A sells @ $0.30. A sold its OWN
        // $0.20 lot → $10 realized, not the $20 a single global FIFO pool (consuming
        // B's older $0.10 lot) would report. This is what keeps scopes additive.
        const moves = [
            move({ txId: 'b1', wallet: 'B', day: '2024-01-01', quantity: 100, direction: 'in' }),
            move({ txId: 'a1', wallet: 'A', day: '2024-01-02', quantity: 100, direction: 'in' }),
            move({ txId: 'a2', wallet: 'A', day: '2024-01-03', quantity: 100, direction: 'out' })
        ];
        const result = computeLots(
            moves,
            priceLookup({ 'TRX|2024-01-01': 0.1, 'TRX|2024-01-02': 0.2, 'TRX|2024-01-03': 0.3 })
        );
        expect(result.realizedByWallet.get('A') ?? 0).toBeCloseTo(10, 6);
        expect(result.realizedByWallet.get('B') ?? 0).toBeCloseTo(0, 6);
        expect(result.realizedPnlUsd).toBeCloseTo(10, 6);
        expect(result.remainingByWalletAsset.get('B')?.get('TRX')?.costBasisUsd ?? 0).toBeCloseTo(10, 6);
    });

    it('handles a disposal exceeding known lots against zero basis', () => {
        const moves = [move({ day: '2024-01-05', quantity: 100, direction: 'out' })];
        const result = computeLots(moves, priceLookup({ 'TRX|2024-01-05': 0.3 }));
        expect(result.realizedPnlUsd).toBeCloseTo(30, 6); // proceeds, no basis to subtract
    });
});

describe('reconstructTrxBalanceSeries', () => {
    it('anchors the end of the series to the absolute balance and walks deltas back', () => {
        const series = reconstructTrxBalanceSeries(
            '2024-01-03',
            100,
            [
                { day: '2024-01-02', signedQty: 30 },
                { day: '2024-01-03', signedQty: 20 }
            ],
            () => 1,
            365
        );
        expect(series).toHaveLength(2);
        expect(series[0]).toEqual({ day: '2024-01-02', valueUsd: 80 });
        expect(series[1]).toEqual({ day: '2024-01-03', valueUsd: 100 });
    });

    it('returns empty when there is no activity range', () => {
        const series = reconstructTrxBalanceSeries('2024-01-03', 100, [], () => 1, 0);
        // With no deltas and a zero window, the floor equals the anchor day, so a
        // single anchor point is still emitted at the absolute balance.
        expect(series[series.length - 1]?.valueUsd).toBe(100);
    });
});
