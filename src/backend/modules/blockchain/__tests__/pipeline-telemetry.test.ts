/**
 * Unit tests for the in-memory pipeline telemetry recorder.
 *
 * The `/system` Pipeline tab reads receipt coverage, stage percentiles, error
 * history, and the fetched and committed heights from this recorder, so a slip
 * here puts a wrong figure in front of an operator diagnosing a stall.
 */
import { describe, it, expect } from 'vitest';
import { PipelineTelemetry, resolveReceiptOutcome, type IPreparedBlockTelemetry } from '../pipeline-telemetry.js';

/**
 * Build a prepared-block record with sensible defaults.
 *
 * @param blockNumber - Block height.
 * @param overrides - Fields to change.
 * @returns The record.
 */
function prepared(blockNumber: number, overrides: Partial<IPreparedBlockTelemetry> = {}): IPreparedBlockTelemetry {
    return {
        blockNumber,
        blockTimestamp: new Date(blockNumber * 3000),
        transactionCount: 10,
        receiptOutcome: 'complete',
        eventCount: 4,
        tokenTransferCount: 2,
        buffered: true,
        timings: { fetchBlock: 100, fetchReceipts: 50, prepare: 200 },
        ...overrides
    };
}

describe('resolveReceiptOutcome', () => {
    it.each([
        [0, true, 0, 'empty'],
        [10, false, 0, 'disabled'],
        [10, true, 10, 'complete'],
        [10, true, 0, 'failed'],
        [10, true, 7, 'partial']
    ] as const)('classifies %i transactions, switch %s, %i receipts as %s', (count, enabled, receipts, expected) => {
        expect(resolveReceiptOutcome(count, enabled, receipts)).toBe(expected);
    });
});

describe('PipelineTelemetry', () => {
    it('tracks the highest fetched and committed heights, not the latest arrival', () => {
        const telemetry = new PipelineTelemetry({ now: () => 1_000_000 });

        telemetry.recordPrepared(prepared(200));
        telemetry.recordPrepared(prepared(150, { buffered: false }));
        telemetry.recordCommitted(150, { commit: 10 });

        const snapshot = telemetry.getSnapshot();
        expect(snapshot.lastFetched?.blockNumber).toBe(200);
        expect(snapshot.lastCommitted?.blockNumber).toBe(150);
        expect(snapshot.lastCommitted?.blockTimestamp).toEqual(new Date(150 * 3000));
    });

    it('counts receipt outcomes across the window and drops the oldest past its size', () => {
        const telemetry = new PipelineTelemetry({ blockWindow: 3 });

        telemetry.recordPrepared(prepared(1, { receiptOutcome: 'failed' }));
        telemetry.recordPrepared(prepared(2, { receiptOutcome: 'complete' }));
        telemetry.recordPrepared(prepared(3, { receiptOutcome: 'partial' }));
        telemetry.recordPrepared(prepared(4, { receiptOutcome: 'empty' }));

        expect(telemetry.getSnapshot().receipts).toEqual({ window: 3, complete: 1, partial: 1, failed: 0, disabled: 0, empty: 1 });
    });

    it('reports nearest-rank percentiles per stage, with commit stages only from committed blocks', () => {
        const telemetry = new PipelineTelemetry();
        for (let index = 1; index <= 20; index += 1) {
            telemetry.recordPrepared(prepared(index, { timings: { fetchBlock: index * 10, prepare: index * 20 } }));
        }
        telemetry.recordCommitted(20, { commit: 40, bulkWriteTransactions: 30 });

        const stages = telemetry.getSnapshot().stages;
        const fetchBlock = stages.find(stage => stage.stage === 'fetchBlock');
        const commit = stages.find(stage => stage.stage === 'commit');

        expect(fetchBlock).toEqual({ stage: 'fetchBlock', phase: 'prepare', p50: 100, p95: 190, max: 200, samples: 20 });
        expect(commit).toMatchObject({ phase: 'commit', p50: 40, samples: 1 });
        expect(stages.find(stage => stage.stage === 'getTrxPrice')).toBeUndefined();
    });

    it('lists recent blocks newest first with their commit state', () => {
        const telemetry = new PipelineTelemetry({ recentBlockCount: 2, now: () => 5_000 });
        telemetry.recordPrepared(prepared(1));
        telemetry.recordPrepared(prepared(2));
        telemetry.recordPrepared(prepared(3));
        telemetry.recordCommitted(2, { commit: 12 });

        const recent = telemetry.getSnapshot().recentBlocks;
        expect(recent.map(block => block.blockNumber)).toEqual([3, 2]);
        expect(recent[0].committedAt).toBeNull();
        expect(recent[1]).toMatchObject({ commitMs: 12, prepareMs: 200, eventCount: 4 });
    });

    it('keeps a bounded error history, newest first', () => {
        const telemetry = new PipelineTelemetry({ errorWindow: 2 });
        telemetry.recordError({ blockNumber: 1, stage: 'fetch', errorClass: 'HTTP 429', message: 'a' });
        telemetry.recordError({ blockNumber: 2, stage: 'fetch', errorClass: 'ETIMEDOUT', message: 'b' });
        telemetry.recordError({ blockNumber: 3, stage: 'commit', errorClass: 'commit', message: 'c' });

        expect(telemetry.getSnapshot().errors.map(error => error.message)).toEqual(['c', 'b']);
    });

    it('measures rates over the history actually held, never less than a minute', () => {
        let now = 0;
        const telemetry = new PipelineTelemetry({ now: () => now });
        for (let index = 0; index < 20; index += 1) {
            now = index * 3000;
            telemetry.recordPrepared(prepared(index));
        }

        // Twenty blocks over the first minute is twenty a minute, not four.
        expect(telemetry.getSnapshot().ingestBlocksPerMinute).toBe(20);
    });
});
