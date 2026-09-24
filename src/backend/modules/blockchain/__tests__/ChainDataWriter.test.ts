/**
 * Unit tests for writing committed blocks into the ClickHouse `tron` tables.
 *
 * The writer's promises are about completeness and about never getting in block
 * sync's way. Every block it could not write must leave a row in
 * `tron._ingest_gap`, because a missing block otherwise looks exactly like a
 * quiet one. `_ingest_state` must never claim a block that was only partly
 * written, and must never move backwards, even across a restart. A brief
 * ClickHouse failure must be ridden out by retrying, and a failure that
 * outlasts every retry must be logged at `fatal`. And a stalled ClickHouse must
 * cost memory up to a bound and no more.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IClickHouseInsertOptions, IClickHouseService } from '@/types';

const { loggerMock } = vi.hoisted(() => ({
    loggerMock: {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn()
    }
}));

vi.mock('../logger.js', () => ({ logger: loggerMock }));

import { ChainDataWriter, type IChainDataWriterOptions } from '../chain-data/ChainDataWriter.js';
import type { IChainDataRows } from '../chain-data/buildChainDataRows.js';

/** One recorded call to the fake's insert. */
interface IRecordedInsert {
    table: string;
    rows: Array<Record<string, unknown>>;
    options?: IClickHouseInsertOptions;
}

/**
 * Build a fake ClickHouse service that records what it was asked to do.
 *
 * `failTables` makes inserts into the named tables throw every time, and
 * `failOnce` makes them throw a set number of times before succeeding, which
 * is how a test simulates a ClickHouse that is down for good or only for a
 * moment. `holdTables` makes inserts wait until `release()` is called, which
 * simulates a stall. `storedProgress` is what the `_ingest_state` read answers,
 * standing in for progress an earlier process recorded.
 *
 * @returns The fake service and the controls and records a test asserts on.
 */
function createFakeClickHouse() {
    const execs: string[] = [];
    const inserts: IRecordedInsert[] = [];
    const failTables = new Set<string>();
    const failOnce = new Map<string, number>();
    const holdTables = new Set<string>();
    let failExec = false;
    let failQuery = false;
    let storedProgress: number | null = null;
    const held: Array<() => void> = [];

    const service = {
        exec: vi.fn(async (sql: string) => {
            if (failExec) {
                throw new Error('clickhouse unreachable');
            }
            execs.push(sql);
        }),
        insert: vi.fn(async (table: string, rows: Array<Record<string, unknown>>, options?: IClickHouseInsertOptions) => {
            if (holdTables.has(table)) {
                await new Promise<void>(resolve => held.push(resolve));
            }
            const remaining = failOnce.get(table) ?? 0;
            if (remaining > 0) {
                failOnce.set(table, remaining - 1);
                throw new Error(`insert into ${table} failed briefly`);
            }
            if (failTables.has(table)) {
                throw new Error(`insert into ${table} failed`);
            }
            inserts.push({ table, rows, options });
        }),
        query: vi.fn(async () => {
            if (failQuery) {
                throw new Error('query failed');
            }
            return [{ block_number: String(storedProgress ?? 0) }];
        }),
        ping: vi.fn(async () => true),
        isConnected: vi.fn(() => true)
    } as unknown as IClickHouseService;

    return {
        service,
        execs,
        inserts,
        failTables,
        failOnce,
        holdTables,
        setFailExec: (value: boolean) => { failExec = value; },
        setFailQuery: (value: boolean) => { failQuery = value; },
        setStoredProgress: (value: number | null) => { storedProgress = value; },
        heldCount: () => held.length,
        release: () => { held.splice(0).forEach(resolve => resolve()); }
    };
}

/**
 * Build one block's rows with a row in the block and transaction tables.
 *
 * @param blockNumber - The block the rows describe.
 * @param failure - A build failure to carry instead of rows, when testing that path.
 * @returns Rows in the shape the committer hands the writer.
 */
function buildRows(blockNumber: number, failure?: string): IChainDataRows {
    return {
        blockNumber,
        blockTimestamp: '2026-09-24 03:12:36.000',
        tables: failure === undefined
            ? {
                block: [{ block_number: blockNumber }],
                transaction: [{ block_number: blockNumber, tx_id: `tx-${blockNumber}` }],
                log: []
            }
            : {},
        ...(failure !== undefined ? { failure } : {})
    };
}

/** A fixed clock, so `_ingested_at` and `recorded_at` are predictable. */
const NOW = new Date(Date.UTC(2026, 8, 24, 3, 12, 40, 0));

/**
 * Build a writer against the fake with a fixed clock and no real retry delay,
 * so a test that exercises every retry does not wait seconds for it.
 *
 * @param fake - The fake ClickHouse the writer talks to.
 * @param overrides - Options a test needs to change, such as the queue limit.
 * @returns The writer under test.
 */
function createWriter(
    fake: ReturnType<typeof createFakeClickHouse>,
    overrides: Partial<IChainDataWriterOptions> = {}
): ChainDataWriter {
    return new ChainDataWriter(fake.service, {
        provider: 'trongrid',
        now: () => NOW,
        sleep: async () => {},
        ...overrides
    });
}

/**
 * Pick out the inserts into one table.
 *
 * @param fake - The fake whose recorded inserts to search.
 * @param table - The full table name, such as `tron._ingest_state`.
 * @returns Every recorded insert into that table, in order.
 */
function insertsInto(fake: ReturnType<typeof createFakeClickHouse>, table: string): IRecordedInsert[] {
    return fake.inserts.filter(insert => insert.table === table);
}

describe('ChainDataWriter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates the database and tables before the first write, and only once', async () => {
        const fake = createFakeClickHouse();
        const writer = createWriter(fake);

        writer.submit(buildRows(100));
        writer.submit(buildRows(101));
        await writer.drain();

        expect(fake.execs[0]).toBe('CREATE DATABASE IF NOT EXISTS tron');
        expect(fake.execs.filter(sql => sql.startsWith('CREATE DATABASE'))).toHaveLength(1);
        expect(fake.execs.some(sql => sql.includes('tron._ingest_gap'))).toBe(true);
    });

    it('writes each non-empty table, stamped, with every insert synchronous', async () => {
        // A synchronous insert skips the async buffer, so it neither holds a
        // pooled connection waiting for the buffer nor loses a failure to the
        // asynchronous-insert log.
        const fake = createFakeClickHouse();
        const writer = createWriter(fake);

        writer.submit(buildRows(100));
        await writer.drain();

        const tables = fake.inserts.map(insert => insert.table);
        expect(tables).toContain('tron.block');
        expect(tables).toContain('tron.transaction');
        expect(tables).not.toContain('tron.log');

        const transaction = fake.inserts.find(insert => insert.table === 'tron.transaction');
        expect(fake.inserts.every(insert => insert.options?.synchronous === true)).toBe(true);
        expect(transaction?.options).toEqual({ synchronous: true });
        expect(transaction?.rows[0]).toEqual({
            block_number: 100,
            tx_id: 'tx-100',
            _provider: 'trongrid',
            _ingested_at: '2026-09-24 03:12:40.000'
        });
    });

    it('records how far it has got only after every table was written', async () => {
        const fake = createFakeClickHouse();
        const writer = createWriter(fake);

        writer.submit(buildRows(100));
        await writer.drain();

        const state = fake.inserts.find(insert => insert.table === 'tron._ingest_state');
        expect(state?.rows).toEqual([expect.objectContaining({ writer: 'block-sync', block_number: 100 })]);
        expect(fake.inserts.indexOf(state!)).toBe(fake.inserts.length - 1);
    });

    it('retries a briefly failing insert and records no gap once it succeeds', async () => {
        // Most ClickHouse failures last a moment; giving up on the first one
        // would turn every blip into gaps.
        const fake = createFakeClickHouse();
        fake.failOnce.set('tron.transaction', 2);
        const writer = createWriter(fake);

        writer.submit(buildRows(100));
        await writer.drain();

        expect(insertsInto(fake, 'tron._ingest_gap')).toHaveLength(0);
        expect(insertsInto(fake, 'tron.transaction')).toHaveLength(1);
        expect(insertsInto(fake, 'tron.block')).toHaveLength(1);
        expect(insertsInto(fake, 'tron._ingest_state')[0].rows[0]).toEqual(expect.objectContaining({ block_number: 100 }));
        expect(loggerMock.warn).toHaveBeenCalledTimes(2);
        expect(loggerMock.fatal).not.toHaveBeenCalled();
    });

    it('doubles the base wait before each retry, through the shared retry helper', async () => {
        // The shared helper jitters each wait to between half and all of the
        // base. A random draw of 0 pins every wait to its lower bound, half.
        const random = vi.spyOn(Math, 'random').mockReturnValue(0);
        const fake = createFakeClickHouse();
        fake.failTables.add('tron.transaction');
        const sleep = vi.fn(async (_ms: number) => {});
        const writer = createWriter(fake, { sleep, maxAttempts: 4, retryDelayMs: 500 });

        writer.submit(buildRows(100));
        await writer.drain();
        random.mockRestore();

        // Three retries for the data insert; the gap insert succeeds first time.
        expect(sleep.mock.calls.map(call => call[0])).toEqual([250, 500, 1000]);
        expect(loggerMock.warn.mock.calls.map(call => call[0].delayMs)).toEqual([250, 500, 1000]);
    });

    it('records a gap, logs fatal, and does not advance its state when a table fails every attempt', async () => {
        // A block missing from one table is incomplete, and _ingest_state must
        // never claim an incomplete block.
        const fake = createFakeClickHouse();
        fake.failTables.add('tron.transaction');
        const writer = createWriter(fake, { maxAttempts: 3 });

        writer.submit(buildRows(100));
        await writer.drain();

        expect((fake.service.insert as ReturnType<typeof vi.fn>).mock.calls
            .filter(call => call[0] === 'tron.transaction')).toHaveLength(3);
        expect(insertsInto(fake, 'tron._ingest_state')).toHaveLength(0);
        expect(insertsInto(fake, 'tron._ingest_gap')[0].rows).toEqual([{
            block_number: 100,
            reason: 'insert into tron.transaction failed',
            recorded_at: '2026-09-24 03:12:40.000',
            _provider: 'trongrid'
        }]);
        expect(loggerMock.fatal).toHaveBeenCalledTimes(1);
        expect(loggerMock.fatal).toHaveBeenCalledWith(
            expect.objectContaining({ table: 'tron.transaction', attempts: 3 }),
            expect.stringContaining('these blocks are recorded as gaps')
        );
    });

    it('records a gap for a block whose rows could not be built', async () => {
        const fake = createFakeClickHouse();
        const writer = createWriter(fake);

        writer.submit(buildRows(100, 'unexpected shape'));
        await writer.drain();

        expect(fake.inserts.map(insert => insert.table)).toEqual(['tron._ingest_gap']);
        expect(fake.inserts[0].rows[0]).toEqual(expect.objectContaining({
            block_number: 100,
            reason: 'rows could not be built: unexpected shape'
        }));
    });

    it('writes nothing until the tables exist, and tries again after the retry delay', async () => {
        // A ClickHouse unreachable at boot must be picked up without a restart.
        const fake = createFakeClickHouse();
        fake.setFailExec(true);
        let now = NOW.getTime();
        const writer = createWriter(fake, { schemaRetryMs: 60_000, now: () => new Date(now) });

        writer.submit(buildRows(100));
        await writer.drain();
        expect(fake.inserts).toHaveLength(0);
        expect(loggerMock.fatal).toHaveBeenCalledWith(
            expect.objectContaining({ database: 'tron' }),
            expect.stringContaining('could not be created')
        );

        fake.setFailExec(false);
        now += 30_000;
        writer.submit(buildRows(101));
        await writer.drain();
        expect(fake.inserts).toHaveLength(0);

        now += 30_000;
        writer.submit(buildRows(102));
        await writer.drain();
        expect(fake.inserts.some(insert => insert.table === 'tron.block')).toBe(true);
    });

    it('records blocks lost before the tables existed once they do', async () => {
        // A missing block looks like a quiet one, so a ClickHouse unreachable
        // at boot must still leave a gap row for every block it missed.
        const fake = createFakeClickHouse();
        fake.setFailExec(true);
        let now = NOW.getTime();
        const writer = createWriter(fake, { schemaRetryMs: 60_000, now: () => new Date(now) });

        writer.submit(buildRows(100));
        await writer.drain();

        fake.setFailExec(false);
        now += 60_000;
        writer.submit(buildRows(101));
        await writer.drain();

        const gaps = insertsInto(fake, 'tron._ingest_gap');
        expect(gaps.flatMap(gap => gap.rows.map(row => row.block_number))).toEqual([100]);
        expect(gaps[0].rows[0]).toEqual(expect.objectContaining({ reason: 'chain data tables did not exist yet' }));
        expect(fake.inserts.some(insert => insert.table === 'tron.block' && insert.rows[0].block_number === 101)).toBe(true);
    });

    it('refuses a block when the queue is full and records it as a gap', async () => {
        // Every waiting block holds all of its rows, so a stalled ClickHouse
        // must cost a bounded amount of memory, not all of it.
        const fake = createFakeClickHouse();
        const writer = createWriter(fake, { maxQueued: 1 });

        writer.submit(buildRows(99));
        await writer.drain();

        fake.holdTables.add('tron.block');
        writer.submit(buildRows(100));
        writer.submit(buildRows(101));

        // Release only once block 100's insert is actually waiting, or the
        // release lands before the insert starts and the insert waits forever.
        await vi.waitFor(() => expect(fake.heldCount()).toBe(1));
        fake.release();
        await writer.drain();
        expect(fake.inserts.some(insert => insert.table === 'tron.block' && insert.rows[0].block_number === 100)).toBe(true);

        const gaps = insertsInto(fake, 'tron._ingest_gap');
        expect(gaps).toHaveLength(1);
        expect(gaps[0].rows[0]).toEqual(expect.objectContaining({
            block_number: 101,
            reason: 'writer queue full (1 blocks waiting)'
        }));
    });

    it('records every block refused during a stall in one gap insert, after the batch in flight', async () => {
        // A separate insert per refused block would pile writes onto a stalled
        // ClickHouse and take pooled connections other modules need.
        const fake = createFakeClickHouse();
        const writer = createWriter(fake, { maxQueued: 1 });

        writer.submit(buildRows(99));
        await writer.drain();

        fake.holdTables.add('tron.block');
        writer.submit(buildRows(100));
        writer.submit(buildRows(101));
        writer.submit(buildRows(102));
        writer.submit(buildRows(103));

        await vi.waitFor(() => expect(fake.heldCount()).toBe(1));
        expect(insertsInto(fake, 'tron._ingest_gap')).toHaveLength(0);

        fake.release();
        await writer.drain();

        const gaps = insertsInto(fake, 'tron._ingest_gap');
        expect(gaps).toHaveLength(1);
        expect(gaps[0].rows.map(row => row.block_number)).toEqual([101, 102, 103]);
    });

    it('writes blocks that waited as one batch, one insert per table', async () => {
        // After a restart, sync commits blocks far faster than one every three
        // seconds. Writing those one at a time would overflow the queue.
        const fake = createFakeClickHouse();
        const writer = createWriter(fake);

        writer.submit(buildRows(99));
        await writer.drain();

        fake.holdTables.add('tron.block');
        writer.submit(buildRows(100));
        writer.submit(buildRows(101));
        writer.submit(buildRows(102));
        await vi.waitFor(() => expect(fake.heldCount()).toBe(1));
        fake.holdTables.delete('tron.block');
        fake.release();
        await writer.drain();

        const blockInserts = insertsInto(fake, 'tron.block');
        expect(blockInserts.map(insert => insert.rows.map(row => row.block_number))).toEqual([[99], [100], [101, 102]]);
        const states = insertsInto(fake, 'tron._ingest_state');
        expect(states[states.length - 1].rows[0]).toEqual(expect.objectContaining({ block_number: 102 }));
    });

    it('does not move its recorded progress backwards when an older block is refilled', async () => {
        // The gap scan commits a missing block after newer ones; _ingest_state
        // must keep reporting the highest block written.
        const fake = createFakeClickHouse();
        const writer = createWriter(fake);

        writer.submit(buildRows(200));
        await writer.drain();
        writer.submit(buildRows(150));
        await writer.drain();

        const states = insertsInto(fake, 'tron._ingest_state');
        expect(states.map(state => state.rows[0].block_number)).toEqual([200]);
    });

    it('does not record progress below what an earlier process already recorded', async () => {
        // After a restart the gap scan can commit an old block before the
        // forward walk reaches new ones. The new process has seen nothing
        // higher, but _ingest_state already holds a higher block.
        const fake = createFakeClickHouse();
        fake.setStoredProgress(300);
        const writer = createWriter(fake);

        writer.submit(buildRows(250));
        await writer.drain();
        expect(insertsInto(fake, 'tron._ingest_state')).toHaveLength(0);

        writer.submit(buildRows(301));
        await writer.drain();
        expect(insertsInto(fake, 'tron._ingest_state').map(state => state.rows[0].block_number)).toEqual([301]);
    });

    it('writes no progress while the stored progress cannot be read, and catches up once it can', async () => {
        // Writing progress without knowing the stored value is exactly what
        // could move it backwards, so the writer holds off instead.
        const fake = createFakeClickHouse();
        fake.setStoredProgress(300);
        fake.setFailQuery(true);
        const writer = createWriter(fake);

        writer.submit(buildRows(250));
        await writer.drain();
        expect(insertsInto(fake, 'tron._ingest_state')).toHaveLength(0);
        expect(insertsInto(fake, 'tron._ingest_gap')).toHaveLength(0);
        expect(loggerMock.fatal).toHaveBeenCalledWith(
            expect.objectContaining({ table: 'tron._ingest_state' }),
            expect.stringContaining('progress is not recorded')
        );

        fake.setFailQuery(false);
        writer.submit(buildRows(302));
        await writer.drain();
        expect(insertsInto(fake, 'tron._ingest_state').map(state => state.rows[0].block_number)).toEqual([302]);
    });

    it('records no gap when only the progress row fails to write', async () => {
        // Every table committed, so the blocks are complete and not gaps.
        const fake = createFakeClickHouse();
        fake.failTables.add('tron._ingest_state');
        const writer = createWriter(fake);

        writer.submit(buildRows(100));
        await writer.drain();

        expect(insertsInto(fake, 'tron._ingest_gap')).toHaveLength(0);
    });

    it('stops retrying once shutdown has begun, so a failing block becomes a gap within the timeout', async () => {
        const fake = createFakeClickHouse();
        fake.failTables.add('tron.transaction');
        const sleep = vi.fn(async (_ms: number) => {});
        const writer = createWriter(fake, { sleep, maxAttempts: 4 });

        writer.submit(buildRows(100));
        await writer.drain({ shuttingDown: true });

        expect(sleep).not.toHaveBeenCalled();
        expect(insertsInto(fake, 'tron._ingest_gap')[0].rows[0]).toEqual(expect.objectContaining({ block_number: 100 }));
    });

    it('never throws out of submit, and logs fatal when recording a gap fails every attempt', async () => {
        const fake = createFakeClickHouse();
        fake.failTables.add('tron.transaction');
        fake.failTables.add('tron._ingest_gap');
        const writer = createWriter(fake);

        expect(() => writer.submit(buildRows(100))).not.toThrow();
        await expect(writer.drain()).resolves.toBeUndefined();
        expect(loggerMock.fatal).toHaveBeenCalledWith(
            expect.objectContaining({ table: 'tron._ingest_gap' }),
            expect.stringContaining('missing from ClickHouse and from _ingest_gap')
        );
    });
});
