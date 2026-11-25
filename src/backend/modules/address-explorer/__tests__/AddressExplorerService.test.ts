/**
 * Unit tests for the address page's section reads, against a fake reader.
 *
 * These pin the decisions the service makes on top of the reads: each span
 * section reads only its own data, a 21-day read too large for a busy wallet
 * falls back to 7 days and says so, a read refused only because the query
 * slots were full is retried once, and the transfers list walks back one week
 * at a time to the start of the stored history.
 */
import { describe, it, expect, vi } from 'vitest';
import type {
    AddressExplorerSection,
    IAddressActivityQuery,
    IAddressActivityReader,
    IAddressActivityTransfersPage,
    IAddressActivityTransfersQuery,
    IAddressExplorerCoverage,
    IAddressExplorerSectionOk,
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
 * @returns The section, typed as a success so a test can spread it and
 * replace its window or coverage.
 */
function ok<T>(data: T): IAddressExplorerSectionOk<T> {
    return { status: 'ok', window: { from: 'a', to: 'b' }, coverage: COVERAGE, tokens: {}, addressTags: {}, data };
}

/** One transfer row; its fields do not matter to the service. */
const TRANSFER = { txId: 'aa' } as unknown as IAddressExplorerTransfer;

/**
 * A fake reader whose span section reads answer with `summary` and whose
 * transfer reads answer with `transfers`, recording every call and which
 * section each span read asked for.
 *
 * @param summary - Answers a span section read for a number of hours.
 * @param transfers - Answers a transfers read for its query.
 * @returns The reader and its recorded calls.
 */
function fakeReader(
    summary: (hours: number) => AddressExplorerSection<unknown>,
    transfers: (query: IAddressActivityTransfersQuery) => AddressExplorerSection<IAddressActivityTransfersPage> = () => ok({ transfers: [TRANSFER], nextCursor: null })
) {
    const summaryCalls: IAddressActivityQuery[] = [];
    const sections: string[] = [];
    const transferCalls: IAddressActivityTransfersQuery[] = [];
    /**
     * Build the fake read for one span section, so a test can tell which
     * section the service asked for.
     *
     * @param name - The section the read stands in for.
     * @returns A read that records its query and section, then answers.
     */
    const summaryRead = (name: string) => async (query: IAddressActivityQuery) => {
        summaryCalls.push(query);
        sections.push(name);
        return summary(query.hours);
    };
    const reader = {
        retentionDays: 21,
        profile: summaryRead('profile'),
        counterparties: summaryRead('counterparties'),
        delegations: summaryRead('delegations'),
        permissions: summaryRead('permissions'),
        transfers: async (query: IAddressActivityTransfersQuery) => {
            transferCalls.push(query);
            return transfers(query);
        }
    } as unknown as IAddressActivityReader;
    return { reader, summaryCalls, transferCalls, calledSections: () => sections };
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

describe('AddressExplorerService.getSpanSection', () => {
    it('reads only the named section over the chosen span, charged to the visitor', async () => {
        const fake = fakeReader(() => ok({}));

        const section = await buildService(fake.reader).getSpanSection('delegations', WALLET, '7d', 'user-1');

        expect(section.status).toBe('ok');
        expect(fake.summaryCalls).toEqual([{ address: WALLET, hours: 168, quotaKey: 'user-1' }]);
        expect(fake.calledSections()).toEqual(['delegations']);
        expect(fake.transferCalls).toHaveLength(0);
    });

    it('falls back to 7 days and marks the section when 21 days is too large', async () => {
        const fake = fakeReader((hours) => (hours === 504 ? { status: 'error', reason: 'too-large' } : ok({ hours })));

        const section = await buildService(fake.reader).getSpanSection('profile', WALLET, '21d', 'user-1');

        expect(section).toEqual(expect.objectContaining({ status: 'ok', narrowedFrom: '21d', data: { hours: 168 } }));
    });

    it('reports a too-large 7-day read rather than narrowing further', async () => {
        const fake = fakeReader(() => ({ status: 'error', reason: 'too-large' }));

        const section = await buildService(fake.reader).getSpanSection('counterparties', WALLET, '7d', 'user-1');

        expect(section).toEqual({ status: 'error', reason: 'too-large' });
        expect(fake.summaryCalls.filter(call => call.hours !== 168)).toHaveLength(0);
    });

    it('retries once after a pause when the query slots were full', async () => {
        let attempts = 0;
        const fake = fakeReader(() => {
            attempts += 1;
            return attempts === 1 ? { status: 'error', reason: 'busy' } : ok({});
        });
        const sleep = vi.fn(async () => undefined);

        const section = await buildService(fake.reader, sleep).getSpanSection('permissions', WALLET, '24h', 'user-1');

        expect(section.status).toBe('ok');
        expect(sleep).toHaveBeenCalledTimes(1);
    });

    it('does not retry a used-up quota', async () => {
        const fake = fakeReader(() => ({ status: 'error', reason: 'quota' }));
        const sleep = vi.fn(async () => undefined);

        const section = await buildService(fake.reader, sleep).getSpanSection('profile', WALLET, '24h', 'user-1');

        expect(section).toEqual({ status: 'error', reason: 'quota' });
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

    /** Guards against a week that looks empty only because its blocks are missing hiding that gap. */
    it('reports the coverage and window of every week a page scanned, not only the last', async () => {
        let call = 0;
        const fake = fakeReader(() => ok({}), () => {
            call += 1;
            return call === 1
                ? { ...ok({ transfers: [], nextCursor: null }), window: { from: 'week1-from', to: 'week1-to' }, coverage: { ...COVERAGE, presentBlocks: 90, missingBlocks: 10, complete: false, blocksComplete: false } }
                : { ...ok({ transfers: [TRANSFER], nextCursor: null }), window: { from: 'week2-from', to: 'week2-to' } };
        });

        const page = await buildService(fake.reader).getTransfers(WALLET, 'user-1');

        expect(fake.transferCalls).toHaveLength(2);
        expect(page).toEqual(expect.objectContaining({
            status: 'ok',
            window: { from: 'week2-from', to: 'week1-to' },
            coverage: expect.objectContaining({ expectedBlocks: 200, presentBlocks: 190, missingBlocks: 10, complete: false, blocksComplete: false })
        }));
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
