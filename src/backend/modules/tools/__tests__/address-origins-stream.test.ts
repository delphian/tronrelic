/**
 * @fileoverview Tests for the Address Origins SSE stream's multi-wallet ordering
 * and its upwalk-pacer wiring.
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

import { describe, it, expect, vi, type Mock } from 'vitest';
import type { Request, Response } from 'express';
import type { IActivatingTransaction, IActivationAncestry } from '@/types';
import type { AddressService } from '../services/address.service.js';
import type { CalculatorService } from '../services/calculator.service.js';
import type { SignatureService } from '../../auth/signature.service.js';
import type { ApprovalService } from '../services/approval.service.js';
import type { TimestampService } from '../services/timestamp.service.js';
import type { AddressOriginsService } from '../services/address-origins.service.js';
import { ToolsController } from '../api/tools.controller.js';
import { CallPacer } from '../lib/CallPacer.js';

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

/** What one stubbed stream run produced, for assertions on output and wiring. */
interface IStreamRun {
    /** Every SSE frame the handler emitted, in emission order. */
    events: ICapturedEvent[];
    /** Spy on the pacer factory, to count how many pacers the request built. */
    createUpwalkPacer: Mock<(signal?: AbortSignal) => CallPacer>;
    /** Spy on the per-wallet climb, to see which pacer each ladder was given. */
    climbSteps: Mock<
        (address: string, options?: unknown, pacer?: CallPacer) => AsyncGenerator<IActivatingTransaction, IActivationAncestry, void>
    >;
}

/**
 * Drive `streamAddressOrigins` against stubbed services and collect what it wrote.
 *
 * @param addresses - Wallets the stubbed plan should climb, in order.
 * @param hopCounts - Hop count per wallet, index-aligned with `addresses`.
 * @returns The emitted frames, plus spies on the pacer wiring.
 */
async function runStream(addresses: string[], hopCounts: number[]): Promise<IStreamRun> {
    // A zero interval keeps these ordering tests instant. The pacing rule itself
    // is exercised against the real interval in the service's own suite; here
    // the concern is only how the handler wires the pacer to the ladders.
    const createUpwalkPacer = vi.fn((_signal?: AbortSignal) => new CallPacer(0));
    const climbSteps = vi.fn((address: string, _options?: unknown, _pacer?: CallPacer) =>
        fakeClimb(address, hopCounts[addresses.indexOf(address)])
    );
    const originsService = {
        resolvePlan: () => ({ addresses, maxDepth: undefined, limited: false }),
        createUpwalkPacer,
        climbSteps
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
    return { events: captured, createUpwalkPacer, climbSteps };
}

/**
 * Drive the handler over one wallet whose single hop is a contract activation,
 * why: the wire payload has to name both parties and say which one the ladder
 * followed, and that assembly happens only in the handler.
 *
 * @returns The frames emitted for that one hop.
 */
async function runInternalHopStream(): Promise<ICapturedEvent[]> {
    const internalEdge: IActivatingTransaction = {
        subjectAddress: 'wallet',
        activatorAddress: 'contract',
        callerAddress: 'signer',
        txId: 'parent-tx',
        blockTimestamp: 1_700_000_000_000,
        contractType: 'InternalTransaction',
        subjectControllers: ['co-signer'],
        creationTimeVerified: true
    };

    /**
     * Yield the single internal hop, then report the climb as exhausted.
     *
     * @returns Generator matching `AddressOriginsService.climbSteps`.
     */
    async function* climb(): AsyncGenerator<IActivatingTransaction, IActivationAncestry, void> {
        yield internalEdge;
        return {
            address: 'wallet',
            chain: [internalEdge],
            stopReason: 'unresolved',
            originReached: true,
            truncated: false
        };
    }

    const originsService = {
        resolvePlan: () => ({ addresses: ['wallet'], maxDepth: undefined, limited: false }),
        createUpwalkPacer: () => new CallPacer(0),
        climbSteps: () => climb()
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

    await controller.streamAddressOrigins(
        { query: { addresses: 'wallet' }, authSession: {}, on: vi.fn() } as unknown as Request,
        res
    );
    return captured;
}

describe('streamAddressOrigins hop payload', () => {
    it('names both parties and says the signer is the one followed', async () => {
        const events = await runInternalHopStream();
        const hop = events.find(entry => entry.event === 'hop');

        expect(hop?.data).toMatchObject({
            subjectAddress: 'wallet',
            activatorAddress: 'contract',
            callerAddress: 'signer',
            climbedAddress: 'signer',
            subjectControllers: ['co-signer'],
            caveats: ['internal-transfer', 'climbed-caller']
        });
    });
});

describe('streamAddressOrigins upwalk pacing', () => {
    it('builds one pacer for the request and gives every ladder that same one', async () => {
        const run = await runStream(['walletA', 'walletB', 'walletC'], [1, 1, 1]);

        // One pacer per request is the product rule: a pacer per ladder would
        // let a ten-wallet comparison run ten times as hot as a single wallet.
        expect(run.createUpwalkPacer).toHaveBeenCalledTimes(1);
        const pacer = run.createUpwalkPacer.mock.results[0].value;
        expect(run.climbSteps).toHaveBeenCalledTimes(3);
        for (const call of run.climbSteps.mock.calls) {
            expect(call[2]).toBe(pacer);
        }
    });

    it('ties the pacer to the client connection so a disconnect cancels its wait', async () => {
        const run = await runStream(['walletA'], [1]);
        const signal = run.createUpwalkPacer.mock.calls[0][0];

        expect(signal).toBeInstanceOf(AbortSignal);
        // The stubbed request never closes, so the signal must still be live;
        // an already-aborted signal would disable pacing for every request.
        expect(signal?.aborted).toBe(false);
    });
});

describe('streamAddressOrigins multi-wallet ordering', () => {
    it('advances every wallet one hop per pass rather than finishing one first', async () => {
        const { events } = await runStream(['walletA', 'walletB'], [3, 3]);
        const hops = events
            .filter(entry => entry.event === 'hop')
            .map(entry => `${entry.data.sourceIndex}:${entry.data.depth}`);

        expect(hops).toEqual(['0:0', '1:0', '0:1', '1:1', '0:2', '1:2']);
    });

    it('drops a finished wallet from the rotation and keeps climbing the rest', async () => {
        const { events } = await runStream(['walletA', 'walletB'], [1, 3]);
        const hops = events
            .filter(entry => entry.event === 'hop')
            .map(entry => `${entry.data.sourceIndex}:${entry.data.depth}`);

        // Wallet A yields one hop then ends; wallet B must keep its own depth
        // sequence rather than inheriting A's slot or restarting.
        expect(hops).toEqual(['0:0', '1:0', '1:1', '1:2']);
    });

    it('closes each ladder with its own address-done and ends with one complete', async () => {
        const { events } = await runStream(['walletA', 'walletB'], [2, 1]);
        const terminal = events.filter(entry => entry.event === 'address-done');

        expect(terminal.map(entry => entry.data.sourceIndex).sort()).toEqual([0, 1]);
        expect(terminal.every(entry => entry.data.stopReason === 'unresolved')).toBe(true);
        expect(events.filter(entry => entry.event === 'complete')).toHaveLength(1);
        expect(events[events.length - 1].event).toBe('complete');
    });
});
