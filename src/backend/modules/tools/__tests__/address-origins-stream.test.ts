/**
 * @fileoverview Tests for the Address Origins SSE stream's multi-wallet ordering.
 *
 * Why this exists: the handler climbs several wallets from one request, and the
 * order it advances them in is the whole user-visible difference between "every
 * ladder grows together" and "the last wallet sits blank until the first nine
 * finish". That ordering is invisible to a test of the climb itself — it lives
 * entirely in how the handler drives the per-wallet generators — and a refactor
 * that accidentally re-awaits one wallet to completion would still pass every
 * other test in this module. The cases below pin the round-robin interleave and
 * the terminal events that close each ladder.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { IActivatingTransaction, IActivationAncestry } from '@/types';
import type { AddressService } from '../services/address.service.js';
import type { CalculatorService } from '../services/calculator.service.js';
import type { SignatureService } from '../../auth/signature.service.js';
import type { ApprovalService } from '../services/approval.service.js';
import type { TimestampService } from '../services/timestamp.service.js';
import type { AddressOriginsService } from '../services/address-origins.service.js';
import { ToolsController } from '../api/tools.controller.js';

/** One captured SSE frame, parsed back out of the raw `res.write` payload. */
interface ICapturedEvent {
    event: string;
    data: Record<string, unknown>;
}

/**
 * Build a synthetic activator edge, why: these tests care only about which wallet
 * a hop belongs to and in what order it arrived, so the edge carries just enough
 * shape to survive the handler's serialization.
 *
 * @param activatorAddress - Stand-in activator identifying the hop in assertions.
 * @returns A minimal activating-transaction edge.
 */
function edge(activatorAddress: string): IActivatingTransaction {
    return {
        activatorAddress,
        txId: `tx-${activatorAddress}`,
        blockTimestamp: 1_700_000_000_000,
        contractType: 'TransferContract'
    } as IActivatingTransaction;
}

/**
 * Fake a wallet's stepped climb of `hopCount` hops, why: the handler must not
 * depend on how long a hop takes, so each `next()` yields only after a macrotask
 * — if the handler ran one wallet to completion, the interleave assertion below
 * would fail regardless of timing.
 *
 * @param label - Wallet marker embedded in each hop's activator address.
 * @param hopCount - Number of hops before the climb reports its ending.
 * @returns Generator matching the shape `AddressOriginsService.climbSteps` returns.
 */
async function* fakeClimb(label: string, hopCount: number): AsyncGenerator<IActivatingTransaction, IActivationAncestry, void> {
    const chain: IActivatingTransaction[] = [];
    for (let depth = 0; depth < hopCount; depth += 1) {
        await new Promise(resolve => setImmediate(resolve));
        const hop = edge(`${label}${depth}`);
        chain.push(hop);
        yield hop;
    }
    return {
        address: label,
        chain,
        stopReason: 'unresolved',
        originReached: true,
        truncated: false
    };
}

/**
 * Drive `streamAddressOrigins` against stubbed services and collect what it wrote.
 *
 * @param addresses - Wallets the stubbed plan should climb, in order.
 * @param hopCounts - Hop count per wallet, index-aligned with `addresses`.
 * @returns Every SSE frame the handler emitted, in emission order.
 */
async function runStream(addresses: string[], hopCounts: number[]): Promise<ICapturedEvent[]> {
    const originsService = {
        resolvePlan: () => ({ addresses, maxDepth: undefined, limited: false }),
        climbSteps: (address: string) => fakeClimb(address, hopCounts[addresses.indexOf(address)])
    } as unknown as AddressOriginsService;

    const controller = new ToolsController(
        null as unknown as AddressService,
        null as unknown as CalculatorService,
        null as unknown as SignatureService,
        null as unknown as ApprovalService,
        null as unknown as TimestampService,
        originsService
    );

    const captured: ICapturedEvent[] = [];
    const res = {
        writeHead: vi.fn(),
        flushHeaders: vi.fn(),
        write: (chunk: string) => {
            const [eventLine, dataLine] = chunk.trim().split('\n');
            captured.push({
                event: eventLine.replace('event: ', ''),
                data: JSON.parse(dataLine.replace('data: ', ''))
            });
            return true;
        },
        end: vi.fn(),
        writableEnded: false
    } as unknown as Response;

    const req = {
        query: { addresses: addresses.join(',') },
        authSession: {},
        on: vi.fn()
    } as unknown as Request;

    await controller.streamAddressOrigins(req, res);
    return captured;
}

describe('streamAddressOrigins multi-wallet ordering', () => {
    it('advances every wallet one hop per pass rather than finishing one first', async () => {
        const events = await runStream(['walletA', 'walletB'], [3, 3]);
        const hops = events
            .filter(entry => entry.event === 'hop')
            .map(entry => `${entry.data.sourceIndex}:${entry.data.depth}`);

        expect(hops).toEqual(['0:0', '1:0', '0:1', '1:1', '0:2', '1:2']);
    });

    it('drops a finished wallet from the rotation and keeps climbing the rest', async () => {
        const events = await runStream(['walletA', 'walletB'], [1, 3]);
        const hops = events
            .filter(entry => entry.event === 'hop')
            .map(entry => `${entry.data.sourceIndex}:${entry.data.depth}`);

        // Wallet A yields one hop then ends; wallet B must keep its own depth
        // sequence rather than inheriting A's slot or restarting.
        expect(hops).toEqual(['0:0', '1:0', '1:1', '1:2']);
    });

    it('closes each ladder with its own address-done and ends with one complete', async () => {
        const events = await runStream(['walletA', 'walletB'], [2, 1]);
        const terminal = events.filter(entry => entry.event === 'address-done');

        expect(terminal.map(entry => entry.data.sourceIndex).sort()).toEqual([0, 1]);
        expect(terminal.every(entry => entry.data.stopReason === 'unresolved')).toBe(true);
        expect(events.filter(entry => entry.event === 'complete')).toHaveLength(1);
        expect(events[events.length - 1].event).toBe('complete');
    });
});
