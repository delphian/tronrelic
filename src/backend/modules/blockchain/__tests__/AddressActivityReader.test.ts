/**
 * Unit tests for the address page's chain reads and the tool options they rely on.
 *
 * The address page reuses the wallet AI tools' queries under its own
 * ClickHouse account and a wider window. These tests pin the parts of that
 * reuse that would fail quietly: the registered tools must keep their
 * one-week cap while the page's instances accept the whole history, chain-wide
 * reads must keep their own caps whatever is passed, every read must be
 * charged to the visitor, and each kind of limit must reach the page as its
 * own reason, because the page reacts differently to each.
 */
import { describe, it, expect } from 'vitest';
import type { IClickHouseReader } from '@/types';
import { AddressActivityReader } from '../chain-query/AddressActivityReader.js';
import { ChainQueryError } from '../chain-query/ChainQueryError.js';
import { ChainQuerySession } from '../chain-query/ChainQuerySession.js';
import type { IChainQueryToolkit } from '../chain-query/ChainQueryToolkit.js';
import { buildAddressCounterpartiesTool } from '../chain-query/tools/buildAddressCounterpartiesTool.js';
import { buildAddressProfileTool } from '../chain-query/tools/buildAddressProfileTool.js';
import { buildAddressTransfersTool } from '../chain-query/tools/buildAddressTransfersTool.js';
import { buildPermissionChangesTool } from '../chain-query/tools/buildPermissionChangesTool.js';
import { buildResourceDelegationsTool } from '../chain-query/tools/buildResourceDelegationsTool.js';
import { buildToolkit, CONTEXT, PEER, USDT, WALLET } from './chainQueryTestToolkit.js';

/** The page's window: a week by default, three weeks at most. */
const PAGE_OPTIONS = { addressWindowRules: { defaultHours: 168, maxHours: 504 } };

/**
 * Build a reader whose tools run against the fake ClickHouse reader.
 *
 * @param toolkit - The test toolkit the tools read through.
 * @returns The reader, with 21 days of retention.
 */
function buildReader(toolkit: IChainQueryToolkit): AddressActivityReader {
    return new AddressActivityReader({
        profile: buildAddressProfileTool(toolkit, PAGE_OPTIONS),
        counterparties: buildAddressCounterpartiesTool(toolkit, PAGE_OPTIONS),
        transfers: buildAddressTransfersTool(toolkit),
        delegations: buildResourceDelegationsTool(toolkit, PAGE_OPTIONS),
        permissions: buildPermissionChangesTool(toolkit, PAGE_OPTIONS)
    }, 21);
}

/**
 * A toolkit whose every query fails with one ClickHouse error code.
 *
 * @param code - The ClickHouse error code, as `@clickhouse/client` reports it.
 * @returns The toolkit.
 */
function failingToolkit(code: string): IChainQueryToolkit {
    return buildToolkit(() => {
        throw Object.assign(new Error('ClickHouse refused the query'), { code });
    }).toolkit;
}

describe('address tool window options', () => {
    it('keeps the registered profile tool at a week and lets the page read three', async () => {
        const { toolkit } = buildToolkit(() => []);

        const registered = await buildAddressProfileTool(toolkit).handler({ address: WALLET, hours: 504 }, undefined, CONTEXT) as Record<string, unknown>;
        const page = await buildAddressProfileTool(toolkit, PAGE_OPTIONS).handler({ address: WALLET, hours: 504 }, undefined, CONTEXT) as Record<string, unknown>;

        expect(registered).toEqual(expect.objectContaining({ success: false, errorKind: 'input' }));
        expect(page.success).toBe(true);
    });

    it('widens a delegation read only when an address narrows it', async () => {
        const { toolkit } = buildToolkit(() => []);
        const tool = buildResourceDelegationsTool(toolkit, PAGE_OPTIONS);

        const withAddress = await tool.handler({ view: 'events', address: WALLET, hours: 504 }, undefined, CONTEXT) as Record<string, unknown>;
        const chainWide = await tool.handler({ view: 'events', hours: 72 }, undefined, CONTEXT) as Record<string, unknown>;

        expect(withAddress.success).toBe(true);
        // A read of every delegation on the chain keeps its 48-hour cap.
        expect(chainWide).toEqual(expect.objectContaining({ success: false, errorKind: 'input' }));
    });

    it('widens the permission updates view only when an address narrows it', async () => {
        const { toolkit } = buildToolkit(() => []);
        const tool = buildPermissionChangesTool(toolkit, PAGE_OPTIONS);

        const withAddress = await tool.handler({ address: WALLET, hours: 504 }, undefined, CONTEXT) as Record<string, unknown>;
        const chainWide = await tool.handler({ hours: 504 }, undefined, CONTEXT) as Record<string, unknown>;

        expect(withAddress.success).toBe(true);
        expect(chainWide).toEqual(expect.objectContaining({ success: false, errorKind: 'input' }));
    });
});

describe('chain query limit reasons', () => {
    it('names which limit stopped the read and which account it belongs to', async () => {
        const reader: IClickHouseReader = {
            accountId: 'address-explorer',
            query: async () => {
                throw Object.assign(new Error('Memory limit exceeded'), { code: '241' });
            }
        } as unknown as IClickHouseReader;
        const session = new ChainQuerySession(reader, CONTEXT, undefined, 25_000, 'address-explorer');

        const error = await session.query('SELECT 1', {}).catch((caught: unknown) => caught);
        session.dispose();

        expect(error).toBeInstanceOf(ChainQueryError);
        expect((error as ChainQueryError).reason).toBe('size');
        expect((error as ChainQueryError).message).toContain('address-explorer account');
    });

    it('reports the reason in the tool response beside the error kind', async () => {
        const quota = await buildAddressProfileTool(failingToolkit('201')).handler({ address: WALLET }, undefined, CONTEXT);
        const busy = await buildAddressProfileTool(failingToolkit('202')).handler({ address: WALLET }, undefined, CONTEXT);

        expect(quota).toEqual(expect.objectContaining({ errorKind: 'limit', errorReason: 'quota' }));
        expect(busy).toEqual(expect.objectContaining({ errorKind: 'limit', errorReason: 'concurrency' }));
    });
});

describe('AddressActivityReader', () => {
    it('returns the profile as a typed section charged to the visitor, without the model-facing fields', async () => {
        const { toolkit, reads } = buildToolkit(() => []);

        const section = await buildReader(toolkit).profile({ address: WALLET, hours: 504, quotaKey: 'user-1' });

        expect(section.status).toBe('ok');
        if (section.status === 'ok') {
            expect(section.data).toEqual({
                activity: expect.objectContaining({ transfers: 0, firstAt: null, lastAt: null }),
                byToken: [],
                truncated: false,
                lookalikeGroups: []
            });
            expect(section.coverage).toEqual(expect.objectContaining({ presentBlocks: expect.any(Number) }));
            expect(section).not.toHaveProperty('notes');
            expect(section).not.toHaveProperty('cost');
        }
        expect(reads.length).toBeGreaterThan(0);
        expect(reads.every(read => read.quotaKey === 'user-1')).toBe(true);
    });

    it('returns a transfers page with its in-window cursor', async () => {
        const row = (txId: string): Record<string, unknown> => ({
            block_number: '29000',
            block_timestamp: '2026-09-24 11:00:00.000',
            tx_id: txId,
            source: 'log',
            event_index: 0,
            direction: 'in',
            counterparty: PEER,
            asset_type: 'trc20',
            token: USDT,
            amount_text: '2000000'
        });
        // The tool asks for one row more than its page size to detect a further page.
        const rows = Array.from({ length: 51 }, (_unused, index) => row(index.toString(16).padStart(64, '0')));
        const { toolkit } = buildToolkit((sql) => (sql.includes('tron._transfer') ? rows : []));

        const section = await buildReader(toolkit).transfers({
            address: WALLET,
            from: '2026-09-17T12:00:00.000Z',
            to: '2026-09-24T12:00:00.000Z',
            quotaKey: 'user-1'
        });

        expect(section.status).toBe('ok');
        if (section.status === 'ok') {
            expect(section.data.transfers).toHaveLength(50);
            expect(section.data.transfers[0]).toEqual(expect.objectContaining({ direction: 'in', counterparty: PEER, amount: { raw: '2000000', value: '2' } }));
            expect(typeof section.data.nextCursor).toBe('string');
        }
    });

    it('maps each kind of failure to the reason the page explains', async () => {
        const tooLarge = await buildReader(failingToolkit('158')).counterparties({ address: WALLET, hours: 504, quotaKey: 'user-1' });
        const quota = await buildReader(failingToolkit('201')).delegations({ address: WALLET, hours: 168, quotaKey: 'user-1' });
        const busy = await buildReader(failingToolkit('202')).permissions({ address: WALLET, hours: 24, quotaKey: 'user-1' });

        expect(tooLarge).toEqual({ status: 'error', reason: 'too-large' });
        expect(quota).toEqual({ status: 'error', reason: 'quota' });
        expect(busy).toEqual({ status: 'error', reason: 'busy' });
    });
});
