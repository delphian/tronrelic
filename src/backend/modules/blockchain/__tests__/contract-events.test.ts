/**
 * Unit tests for event log normalisation, `Transfer` decoding, the log versus
 * call-data source rule, and internal transfer decoding.
 *
 * Plugins store token movements keyed on `eventId` and filter on `source`, so
 * a slip here would either duplicate transfers, lose the ones made inside
 * another contract's call, or mix complete and incomplete data in one list.
 */
import { describe, it, expect } from 'vitest';
import type { ITokenTransfer } from '@/types';
import {
    TRANSFER_EVENT_TOPIC,
    decodeTransferEvent,
    normalizeContractEvents,
    resolveTransactionEvents
} from '../contract-events.js';
import { decodeInternalTransfers } from '../internal-transfers.js';

/** USDT contract, base58. */
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/** 20-byte body of the USDT address, used as an arbitrary account address. */
const ADDRESS_BODY = 'a614f803b6fd780986a42c78ec9c7f77e6ded13c';

/** Base58 of the all-zero address, which marks a mint or a burn. */
const ZERO_ADDRESS = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';

/**
 * Left-pad hex to one 32-byte word.
 *
 * @param hex Hex digits to pad.
 * @returns 64 hex characters.
 */
function word(hex: string): string {
    return hex.padStart(64, '0');
}

/** A TRC20 `Transfer` of 1,000 units from the zero address to USDT's address, emitted by USDT. */
const TRC20_TRANSFER_LOG = {
    address: ADDRESS_BODY,
    topics: [TRANSFER_EVENT_TOPIC, word('0'), word(ADDRESS_BODY)],
    data: word('3e8')
};

/** The call-data decode block sync would produce for the same transaction. */
const CALLDATA_TRANSFER: ITokenTransfer = {
    contractAddress: USDT,
    method: 'transfer',
    from: 'TSigner',
    to: USDT,
    rawAmount: '1000'
};

describe('normalizeContractEvents', () => {
    it('converts the log address, which lacks the 41 prefix, to base58', () => {
        const [event] = normalizeContractEvents('tx-1', [TRC20_TRANSFER_LOG]);

        expect(event.contractAddress).toBe(USDT);
    });

    it('gives each event the identity txId:logIndex and keeps positions when a log is skipped', () => {
        const events = normalizeContractEvents('tx-1', [
            { address: 'not-hex', topics: [], data: '' },
            { ...TRC20_TRANSFER_LOG, topics: TRC20_TRANSFER_LOG.topics.map(topic => `0x${topic.toUpperCase()}`) }
        ]);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ eventId: 'tx-1:1', logIndex: 1, txId: 'tx-1' });
        expect(events[0].topics[0]).toBe(TRANSFER_EVENT_TOPIC);
    });

    it('returns an empty list for a receipt with no logs', () => {
        expect(normalizeContractEvents('tx-1', undefined)).toEqual([]);
    });
});

describe('decodeTransferEvent', () => {
    it('decodes a three-topic Transfer as TRC20 with the amount from data', () => {
        const [event] = normalizeContractEvents('tx-1', [TRC20_TRANSFER_LOG]);

        expect(decodeTransferEvent(event)).toEqual({
            eventId: 'tx-1:0',
            txId: 'tx-1',
            logIndex: 0,
            source: 'log',
            standard: 'trc20',
            contractAddress: USDT,
            from: ZERO_ADDRESS,
            to: USDT,
            rawAmount: '1000'
        });
    });

    it('decodes a four-topic Transfer as TRC721 with the token id from the last topic', () => {
        const [event] = normalizeContractEvents('tx-1', [{
            address: ADDRESS_BODY,
            topics: [TRANSFER_EVENT_TOPIC, word(ADDRESS_BODY), word('0'), word('2a')],
            data: ''
        }]);

        expect(decodeTransferEvent(event)).toMatchObject({ standard: 'trc721', tokenId: '42', to: ZERO_ADDRESS });
        expect(decodeTransferEvent(event)).not.toHaveProperty('rawAmount');
    });

    it('leaves other events and malformed transfers undecoded', () => {
        const events = normalizeContractEvents('tx-1', [
            { address: ADDRESS_BODY, topics: [word('abc')], data: '' },
            { address: ADDRESS_BODY, topics: [TRANSFER_EVENT_TOPIC, word('0'), word(ADDRESS_BODY)], data: '' }
        ]);

        expect(events.map(decodeTransferEvent)).toEqual([undefined, undefined]);
    });
});

describe('resolveTransactionEvents', () => {
    it('reads transfers from logs only when the block receipts are complete', () => {
        const resolved = resolveTransactionEvents({
            txId: 'tx-1',
            status: 'SUCCESS',
            info: { id: 'tx-1', log: [TRC20_TRANSFER_LOG] },
            receiptsFetched: true,
            calldataTransfer: CALLDATA_TRANSFER
        });

        expect(resolved.events).toHaveLength(1);
        expect(resolved.tokenTransfers).toHaveLength(1);
        expect(resolved.tokenTransfers[0].source).toBe('log');
        expect(resolved.internalTransfers).toEqual([]);
    });

    it('lists no transfers for a reverted call when logs are available, even if call data decoded', () => {
        // A reverted transaction emits no logs, which is how log mode removes
        // the need for any status or return-value check.
        const resolved = resolveTransactionEvents({
            txId: 'tx-1',
            status: 'REVERT',
            info: { id: 'tx-1' },
            receiptsFetched: true,
            calldataTransfer: CALLDATA_TRANSFER
        });

        expect(resolved.events).toEqual([]);
        expect(resolved.tokenTransfers).toEqual([]);
    });

    it('falls back to call data, marked as such, when the block receipts are incomplete', () => {
        const resolved = resolveTransactionEvents({
            txId: 'tx-1',
            status: 'SUCCESS',
            info: { id: 'tx-1', log: [TRC20_TRANSFER_LOG] },
            receiptsFetched: false,
            calldataTransfer: CALLDATA_TRANSFER
        });

        expect(resolved.events).toBeUndefined();
        expect(resolved.internalTransfers).toBeUndefined();
        expect(resolved.tokenTransfers).toEqual([{
            eventId: 'tx-1:calldata',
            txId: 'tx-1',
            source: 'calldata',
            standard: 'trc20',
            contractAddress: USDT,
            from: 'TSigner',
            to: USDT,
            rawAmount: '1000'
        }]);
    });

    it('lists no call-data transfer for a failed call', () => {
        const resolved = resolveTransactionEvents({
            txId: 'tx-1',
            status: 'REVERT',
            info: null,
            receiptsFetched: false,
            calldataTransfer: CALLDATA_TRANSFER
        });

        expect(resolved.tokenTransfers).toEqual([]);
    });
});

describe('decodeInternalTransfers', () => {
    it('lists each value-bearing entry and skips zero-value calls', () => {
        const transfers = decodeInternalTransfers('tx-1', [
            {
                caller_address: `41${ADDRESS_BODY}`,
                transferTo_address: `41${'0'.repeat(40)}`,
                callValueInfo: [{ callValue: 5_000_000 }, { tokenId: '1002000', callValue: 7 }],
                note: '63616c6c'
            },
            {
                caller_address: `41${ADDRESS_BODY}`,
                transferTo_address: `41${ADDRESS_BODY}`,
                callValueInfo: [{}],
                note: '63616c6c',
                rejected: true
            }
        ]);

        expect(transfers).toEqual([
            { txId: 'tx-1', internalIndex: 0, from: USDT, to: ZERO_ADDRESS, rawAmount: '5000000', note: 'call', rejected: false },
            { txId: 'tx-1', internalIndex: 0, from: USDT, to: ZERO_ADDRESS, rawAmount: '7', tokenId: '1002000', note: 'call', rejected: false }
        ]);
    });

    it('returns an empty list when the receipt has no internal transactions', () => {
        expect(decodeInternalTransfers('tx-1', undefined)).toEqual([]);
    });
});
