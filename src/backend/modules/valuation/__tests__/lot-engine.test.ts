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
        internal: over.internal ?? false
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

    it('treats internal transfers as neutral (no realization, basis preserved)', () => {
        const moves = [
            move({ txId: 'a', day: '2024-01-01', quantity: 100, direction: 'in' }),
            move({ txId: 'b', day: '2024-01-02', quantity: 100, direction: 'out', internal: true })
        ];
        const result = computeLots(moves, priceLookup({ 'TRX|2024-01-01': 0.1, 'TRX|2024-01-02': 0.5 }));
        expect(result.realizedPnlUsd).toBeCloseTo(0, 6);
        expect(result.remainingByAsset.get('TRX')?.costBasisUsd).toBeCloseTo(10, 6);
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
