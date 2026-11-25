/**
 * Unit tests for the address page's section assembly, against a fake reader.
 *
 * These pin the decisions the service makes on top of the reads: a 21-day
 * summary too large for a busy wallet falls back to 7 days and says so, a
 * read refused only because the query slots were full is retried once, the
 * transfers list walks back one week at a time to the start of the stored
 * history, and reads run one after another so a page load holds one query
 * slot at a time.
 */
import { describe, it, expect, vi } from 'vitest';
import type {
    AddressExplorerSection,
    IAddressActivityQuery,
    IAddressActivityReader,
    IAddressActivityTransfersPage,
    IAddressActivityTransfersQuery,
    IAddressExplorerCoverage,
    IAddressExplorerTransfer,
    ISystemLogService
} from '@/types';
import { AddressExplorerService } from '../services/AddressExplorerService.js';

const WALLET = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const NOW = new Date('2026-11-25T12:00:00.000Z');
const DAY_MS = 86_400_000;

/** No-op logger. */
function silentLogger(): ISystemLogService {
    const logger = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return logger; } };
    return logger as unknown as ISystemLogService;
}

/** Full coverage, as a fully stored window reports it. */
const COVERAGE: IAddressExplorerCoverage = {
    expectedBlocks: 100,
    presentBlocks: 100,
    missingBlocks: 0,
    blocksWithoutReceipts: 0,
    dataFrom: null,
    dataTo: null,
    complete: true,
    blocksComplete: true
};

/**
 * A successful section carrying the given data.
 *
 * @param data - The section's data.
 * @returns The section.
 */
function ok<T>(data: T): AddressExplorerSection<T> {
    return { status: 'ok', window: { from: 'a', to: 'b' }, coverage: COVERAGE, tokens: {}, addressTags: {}, data };
}

/** One transfer row; its fields do not matter to the service. */
const TRANSFER = { txId: 'aa' } as unknown as IAddressExplorerTransfer;

/**
 * A fake reader whose summary reads answer with `summary` and whose transfer
 * reads answer with `transfers`, recording every call.
 *
 * @param summary - Answers a summary read for a number of hours.
 * @param transfers - Answers a transfers read for its query.
 * @returns The reader and its recorded calls.
 */
function fakeReader(
    summary: (hours: number) => AddressExplorerSection<unknown>,
    transfers: (query: IAddressActivityTransfersQuery) => AddressExplorerSection<IAddressActivityTransfersPage> = () => ok({ transfers: [TRANSFER], nextCursor: null })
) {
    const summaryCalls: IAddressActivityQuery[] = [];
    const transferCalls: IAddressActivityTransfersQuery[] = [];
    let running = 0;
    let maxRunning = 0;
    /**
     * Wrap a read so the fake can tell whether two reads overlapped.
     *
     * @param answer - Produces the read's result.
     * @returns The result, after yielding once to the event loop.
     */
    const track = async <T>(answer: () => T): Promise<T> => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await Promise.resolve();
        running -= 1;
        return answer();
    };
    const summaryRead = (query: IAddressActivityQuery) => {
        summaryCalls.push(query);
        return track(() => summary(query.hours));
    };
    const reader = {
        retentionDays: 21,
        profile: summaryRead,
        counterparties: summaryRead,
        delegations: summaryRead,
        permissions: summaryRead,
        transfers: (query: IAddressActivityTransfersQuery) => {
            transferCalls.push(query);
            return track(() => transfers(query));
        }
    } as unknown as IAddressActivityReader;
    return { reader, summaryCalls, transferCalls, maxRunning: () => maxRunning };
}

/**
 * Build the service with a fixed clock and no real pauses.
 *
 * @param reader - The fake reader.
 * @param sleep - Records pauses instead of waiting.
 * @returns The service.
 */
function buildService(reader: IAddressActivityReader, sleep = vi.fn(async () => undefined)): AddressExplorerService {
    return new AddressExplorerService(reader, silentLogger(), { now: () => NOW, sleep });
}

describe('AddressExplorerService.getOverview', () => {
    it('reads every section one at a time, charged to the visitor', async () => {
        const fake = fakeReader(() => ok({}));

        const overview = await buildService(fake.reader).getOverview(WALLET, '7d', 'user-1');

        expect(overview.period).toBe('7d');
        expect([overview.profile, overview.counterparties, overview.transfers, overview.delegations, overview.permissions].every(section => section.status === 'ok')).toBe(true);
        expect(fake.summaryCalls).toHaveLength(4);
        expect(fake.summaryCalls.every(call => call.hours === 168 && call.quotaKey === 'user-1')).toBe(true);
        expect(fake.maxRunning()).toBe(1);
    });

    it('falls back to 7 days and marks the section when 21 days is too large', async () => {
        const fake = fakeReader((hours) => (hours === 504 ? { status: 'error', reason: 'too-large' } : ok({ hours })));

        const overview = await buildService(fake.reader).getOverview(WALLET, '21d', 'user-1');

        expect(overview.profile).toEqual(expect.objectContaining({ status: 'ok', narrowedFrom: '21d', data: { hours: 168 } }));
    });

    it('reports a too-large 7-day read rather than narrowing further', async () => {
        const fake = fakeReader(() => ({ status: 'error', reason: 'too-large' }));

        const overview = await buildService(fake.reader).getOverview(WALLET, '7d', 'user-1');

        expect(overview.profile).toEqual({ status: 'error', reason: 'too-large' });
        expect(fake.summaryCalls.filter(call => call.hours !== 168)).toHaveLength(0);
    });

    it('retries once after a pause when the query slots were full', async () => {
        let attempts = 0;
        const fake = fakeReader(() => {
            attempts += 1;
            return attempts === 1 ? { status: 'error', reason: 'busy' } : ok({});
        });
        const sleep = vi.fn(async () => undefined);

        const overview = await buildService(fake.reader, sleep).getOverview(WALLET, '24h', 'user-1');

        expect(overview.profile.status).toBe('ok');
        expect(sleep).toHaveBeenCalledTimes(1);
    });

    it('does not retry a used-up quota', async () => {
        const fake = fakeReader(() => ({ status: 'error', reason: 'quota' }));
        const sleep = vi.fn(async () => undefined);

        const overview = await buildService(fake.reader, sleep).getOverview(WALLET, '24h', 'user-1');

        expect(overview.profile).toEqual({ status: 'error', reason: 'quota' });
        expect(sleep).not.toHaveBeenCalled();
    });
});

describe('AddressExplorerService.getTransfers', () => {
    it('reads the newest week first and offers the week before it', async () => {
        const fake = fakeReader(() => ok({}));

        const page = await buildService(fake.reader).getTransfers(WALLET, 'user-1');

        expect(fake.transferCalls).toHaveLength(1);
        expect(fake.transferCalls[0]).toEqual(expect.objectContaining({
            from: new Date(NOW.getTime() - 7 * DAY_MS).toISOString(),
            to: NOW.toISOString(),
            quotaKey: 'user-1'
        }));
        expect(page).toEqual(expect.objectContaining({
            status: 'ok',
            data: { transfers: [TRANSFER], next: { before: new Date(NOW.getTime() - 7 * DAY_MS).toISOString() } }
        }));
    });

    it('continues inside the same week when the reader has more rows there', async () => {
        const fake = fakeReader(() => ok({}), () => ok({ transfers: [TRANSFER], nextCursor: 'abc' }));

        const page = await buildService(fake.reader).getTransfers(WALLET, 'user-1');

        expect(page).toEqual(expect.objectContaining({ data: { transfers: [TRANSFER], next: { before: NOW.toISOString(), cursor: 'abc' } } }));
    });

    it('skips empty weeks back to the start of the stored history and then stops', async () => {
        const fake = fakeReader(() => ok({}), () => ok({ transfers: [], nextCursor: null }));

        const page = await buildService(fake.reader).getTransfers(WALLET, 'user-1');

        expect(fake.transferCalls).toHaveLength(3);
        expect(fake.transferCalls[2].from).toBe(new Date(NOW.getTime() - 21 * DAY_MS).toISOString());
        expect(page).toEqual(expect.objectContaining({ status: 'ok', data: { transfers: [], next: null } }));
    });

    it('starts from the position the previous page gave', async () => {
        const fake = fakeReader(() => ok({}));
        const before = new Date(NOW.getTime() - 7 * DAY_MS).toISOString();

        await buildService(fake.reader).getTransfers(WALLET, 'user-1', { before, cursor: 'xyz' });

        expect(fake.transferCalls[0]).toEqual(expect.objectContaining({ to: before, cursor: 'xyz' }));
    });

    it('passes a failed read through as the page', async () => {
        const fake = fakeReader(() => ok({}), () => ({ status: 'error', reason: 'unavailable' }));

        const page = await buildService(fake.reader).getTransfers(WALLET, 'user-1');

        expect(page).toEqual({ status: 'error', reason: 'unavailable' });
    });
});
