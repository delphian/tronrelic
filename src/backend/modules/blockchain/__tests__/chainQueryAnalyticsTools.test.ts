/**
 * Unit tests for the chain query tools that read beyond `tron._transfer`:
 * delegations, permission changes, account activations, token lookup,
 * contract activity and events, and network statistics.
 *
 * They pin what each tool promises the model: values reach ClickHouse only as
 * parameters, amounts arrive converted, and classifications such as a
 * transferred owner permission are worked out correctly.
 */
import { describe, it, expect } from 'vitest';
import TronWeb from 'tronweb';
import { toHexAddress } from '../../../lib/tron-address.js';
import { summarizeCoverage } from '../chain-query/ChainCoverageReader.js';
import type { IChainWindow } from '../chain-query/chainQueryInput.js';
import { decodeKnownEvent, KNOWN_EVENT_TOPICS, KNOWN_METHOD_SELECTORS } from '../chain-query/chainSignatures.js';
import { buildContractEventsTool } from '../chain-query/tools/buildContractEventsTool.js';
import { buildFindTokenTool } from '../chain-query/tools/buildFindTokenTool.js';
import { buildNetworkStatsTool } from '../chain-query/tools/buildNetworkStatsTool.js';
import { ACTIVATION_FEES_SUN, buildNewAccountsTool } from '../chain-query/tools/buildNewAccountsTool.js';
import { buildPermissionChangesTool } from '../chain-query/tools/buildPermissionChangesTool.js';
import { buildResourceDelegationsTool } from '../chain-query/tools/buildResourceDelegationsTool.js';
import { buildChainResponse } from '../chain-query/chainQueryResponse.js';
import { buildToolkit, CONTEXT, NOW, PEER, USDT, WALLET } from './chainQueryTestToolkit.js';

/** TronWeb's keccak-256 helper, typed for the one call these tests make. */
const sha3 = (TronWeb as unknown as { sha3(text: string, prefix?: boolean): string }).sha3;

/**
 * Pad a hex value to one 32-byte ABI word, as event topics and data store it.
 *
 * @param hex - Hex digits without `0x`.
 * @returns 64 hex characters.
 */
function word(hex: string): string {
    return hex.padStart(64, '0');
}

/**
 * An indexed address topic for a base58 address: its 20 bytes, right-aligned.
 *
 * @param address - A base58 address.
 * @returns The topic.
 */
function addressTopic(address: string): string {
    return word(toHexAddress(address).toLowerCase().slice(2));
}

describe('chain signatures', () => {
    it('labels every selector and event with the hash of its own signature', () => {
        for (const [selector, signature] of Object.entries(KNOWN_METHOD_SELECTORS)) {
            expect(sha3(signature, false).slice(0, 8)).toBe(selector);
        }
        for (const [topic, signature] of Object.entries(KNOWN_EVENT_TOPICS)) {
            expect(sha3(signature, false)).toBe(topic);
        }
    });

    it('decodes TRC-20 transfers and Tether blacklist events, and leaves unknown layouts alone', () => {
        const transferTopic = Object.keys(KNOWN_EVENT_TOPICS).find(topic => KNOWN_EVENT_TOPICS[topic].startsWith('Transfer('))!;
        const blacklistTopic = Object.keys(KNOWN_EVENT_TOPICS).find(topic => KNOWN_EVENT_TOPICS[topic].startsWith('AddedBlackList('))!;

        expect(decodeKnownEvent([transferTopic, addressTopic(WALLET), addressTopic(PEER)], word('16e360'))).toEqual({
            name: 'Transfer',
            fields: { from: WALLET, to: PEER, amount: '1500000' }
        });
        expect(decodeKnownEvent([blacklistTopic], addressTopic(PEER))).toEqual({ name: 'AddedBlackList', fields: { user: PEER } });
        // A Transfer with its amount missing is not guessed at.
        expect(decodeKnownEvent([transferTopic, addressTopic(WALLET), addressTopic(PEER)], '')).toBeNull();
    });
});

describe('blockchain-resource-delegations', () => {
    it('lists delegations with staked TRX converted and the lock period in hours', async () => {
        const { toolkit, reads } = buildToolkit(() => [{
            action: 'delegate',
            block_number: '29000',
            block_timestamp: '2026-09-24 11:00:00.000',
            tx_id: 'aa'.repeat(32),
            owner_address: PEER,
            receiver_address: WALLET,
            resource: 'ENERGY',
            balance_text: '2500000000',
            lock: true,
            lock_period: '28800',
            contract_ret: 'SUCCESS'
        }]);

        const result = await buildResourceDelegationsTool(toolkit).handler({ address: WALLET, role: 'receiver', resource: 'ENERGY' }, undefined, CONTEXT) as Record<string, unknown>;

        const read = reads.find(entry => entry.sql.includes('delegate_resource_contract'));
        expect(read?.sql).toContain('receiver_address = {address:String}');
        expect(read?.sql).not.toContain(WALLET);
        expect(read?.params).toEqual(expect.objectContaining({ address: WALLET, resource: 'ENERGY' }));
        expect(result.events).toEqual([expect.objectContaining({
            delegator: PEER,
            receiver: WALLET,
            stakedTrx: { raw: '2500000000', value: '2500' },
            locked: true,
            lockPeriod: { blocks: 28800, approxHours: 24 }
        })]);
        expect(result.addressTags).toEqual({ [PEER]: ['ofac:sdn'] });
    });

    it('refuses the counterparties view without an address and the top views with one', async () => {
        const { toolkit, reads } = buildToolkit(() => []);
        const tool = buildResourceDelegationsTool(toolkit);

        const noAddress = await tool.handler({ view: 'counterparties' }, undefined, CONTEXT) as Record<string, unknown>;
        const topWithAddress = await tool.handler({ view: 'top-delegators', address: WALLET }, undefined, CONTEXT) as Record<string, unknown>;

        expect(noAddress).toEqual(expect.objectContaining({ success: false, errorKind: 'input' }));
        expect(topWithAddress).toEqual(expect.objectContaining({ success: false, errorKind: 'input' }));
        expect(reads).toHaveLength(0);
    });
});

describe('blockchain-permission-changes', () => {
    it('flags an update that removes the account\'s own key from its owner permission', async () => {
        const owner = JSON.stringify({ permission_name: 'owner', threshold: 1, keys: [{ address: toHexAddress(PEER).toLowerCase(), weight: 1 }] });
        const { toolkit } = buildToolkit(() => [{
            block_number: '29000',
            block_timestamp: '2026-09-24 11:00:00.000',
            tx_id: 'bb'.repeat(32),
            owner_address: WALLET,
            owner,
            witness: '',
            actives: [],
            contract_ret: 'SUCCESS'
        }]);

        const result = await buildPermissionChangesTool(toolkit).handler({ onlyTransferred: true }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result.updates).toEqual([expect.objectContaining({
            account: WALLET,
            ownerControl: 'owner-control-transferred',
            outsideKeys: [PEER],
            owner: expect.objectContaining({ threshold: 1, keys: [{ address: PEER, weight: 1 }] })
        })]);
    });

    it('caps the permission-signed transaction window at 48 hours', async () => {
        const { toolkit, reads } = buildToolkit(() => []);

        const result = await buildPermissionChangesTool(toolkit).handler({ view: 'permission-transactions', hours: 72 }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({ success: false, errorKind: 'input' }));
        expect(reads).toHaveLength(0);
    });
});

describe('blockchain-new-accounts', () => {
    it('passes the activation fees as parameters and labels each activation', async () => {
        const { toolkit, reads } = buildToolkit(() => [{
            block_number: '29000',
            block_timestamp: '2026-09-24 11:00:00.000',
            tx_id: 'cc'.repeat(32),
            funder: PEER,
            account: WALLET,
            method: 'trx-transfer',
            amount_text: '100000',
            asset: ''
        }]);

        const result = await buildNewAccountsTool(toolkit).handler({ view: 'accounts', account: WALLET }, undefined, CONTEXT) as Record<string, unknown>;

        const read = reads.find(entry => entry.sql.includes('transfer_contract'));
        expect(read?.params).toEqual(expect.objectContaining({
            account: WALLET,
            createFee: ACTIVATION_FEES_SUN.createAccount,
            memoFee: ACTIVATION_FEES_SUN.memo,
            multiSignFee: ACTIVATION_FEES_SUN.multiSign
        }));
        expect(result.activations).toEqual([expect.objectContaining({
            account: WALLET,
            activatedBy: PEER,
            method: 'trx-transfer',
            amount: { raw: '100000', value: '0.1' }
        })]);
    });
});

describe('blockchain-find-token', () => {
    it('puts the operator-tagged contract first even when an imitation is busier', async () => {
        const imitation = PEER;
        const { toolkit } = buildToolkit((sql) => sql.includes('upperUTF8(symbol)')
            ? [{ token: imitation }, { token: USDT }]
            : [
                { address: imitation, transfers: '900', non_zero: '900', senders: '1', receivers: '900' },
                { address: USDT, transfers: '500', non_zero: '480', senders: '300', receivers: '310' }
            ]);

        const result = await buildFindTokenTool(toolkit).handler({ symbol: 'usdt' }, undefined, CONTEXT) as Record<string, unknown>;

        const candidates = result.candidates as Array<Record<string, unknown>>;
        expect(candidates[0]).toEqual(expect.objectContaining({ contract: USDT, verified: true, nonZeroTransfers: 480 }));
        expect(candidates[1]).toEqual(expect.objectContaining({ contract: imitation, verified: false }));
    });

    it('verifies nothing when no contract carries the token tag', async () => {
        const { toolkit } = buildToolkit((sql) => sql.includes('upperUTF8(symbol)') ? [{ token: PEER }] : []);

        const result = await buildFindTokenTool(toolkit).handler({ symbol: 'USDD' }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result.candidates).toEqual([expect.objectContaining({ contract: PEER, verified: false })]);
        expect((result.notes as string[]).some(note => note.includes('token:usdd'))).toBe(true);
    });

    it('refuses TRX, which is not a token', async () => {
        const { toolkit } = buildToolkit(() => []);

        const result = await buildFindTokenTool(toolkit).handler({ symbol: 'trx' }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({ success: false, errorKind: 'input' }));
    });
});

describe('blockchain-contract-events', () => {
    it('decodes a Transfer with the contract\'s own decimals and pages by log index', async () => {
        const transferTopic = Object.keys(KNOWN_EVENT_TOPICS).find(topic => KNOWN_EVENT_TOPICS[topic].startsWith('Transfer('))!;
        const row = {
            block_number: '29000',
            block_timestamp: '2026-09-24 11:00:00.000',
            tx_id: 'dd'.repeat(32),
            log_index: '3',
            topics: [transferTopic, addressTopic(WALLET), addressTopic(PEER)],
            data: word('16e360')
        };
        const { toolkit, reads } = buildToolkit(() => [row, { ...row, log_index: '2' }]);

        const result = await buildContractEventsTool(toolkit).handler({ contract: USDT, event: 'Transfer', limit: 1 }, undefined, CONTEXT) as Record<string, unknown>;

        expect(reads.find(entry => entry.sql.includes('tron.log'))?.params).toEqual(expect.objectContaining({ contract: USDT, topic0: transferTopic }));
        expect(result.events).toEqual([expect.objectContaining({
            name: 'Transfer',
            fields: { from: WALLET, to: PEER, amount: { raw: '1500000', value: '1.5' } }
        })]);
        expect(result.truncated).toBe(true);
        expect(typeof result.nextCursor).toBe('string');
    });
});

describe('blockchain-network-stats', () => {
    it('limits each metric\'s window by the size of the table it reads', async () => {
        const { toolkit } = buildToolkit(() => []);
        const tool = buildNetworkStatsTool(toolkit);

        const blocks = await tool.handler({ metric: 'blocks', hours: 168 }, undefined, CONTEXT) as Record<string, unknown>;
        const senders = await tool.handler({ metric: 'value-senders', hours: 48 }, undefined, CONTEXT) as Record<string, unknown>;

        expect(blocks.success).toBe(true);
        expect(senders).toEqual(expect.objectContaining({ success: false, errorKind: 'input' }));
    });
});

describe('coverage for tools that do not read receipts', () => {
    it('counts a window without receipts as complete for block contents only', () => {
        const window: IChainWindow = { from: new Date(NOW.getTime() - 3_600_000), to: NOW, clampedToRetention: false };
        const coverage = summarizeCoverage({
            first_block: '1000',
            last_block: '1199',
            present: '200',
            without_receipts: '200',
            first_at: '2026-09-24 11:00:00.000',
            last_at: '2026-09-24 12:00:00.000'
        }, window, NOW.getTime());

        expect(coverage).toEqual(expect.objectContaining({ complete: false, blocksComplete: true }));
        const response = buildChainResponse({ window, coverage, tokens: new Map(), tags: { tags: {}, available: true }, usesReceipts: false }, {});
        expect((response.notes as string[]).some(note => note.includes('Coverage is incomplete'))).toBe(false);
    });
});
