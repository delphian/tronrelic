/**
 * @fileoverview Turns a transaction receipt's event logs into typed facts.
 *
 * Core used to find token movements only in call data, which sees a direct
 * `transfer` call on a token and nothing else. Every token movement, including
 * the ones inside a DEX swap, a bridge, or a batch payout, emits a `Transfer`
 * event log from the token contract, and those logs arrive in the receipt that
 * block sync fetches when `fetchBlockReceipts` is on.
 *
 * This module does three things with them. It normalises every log into an
 * `IContractEvent` with a base58 address and a stable `eventId`. It fully
 * decodes the one standard every consumer reads the same way, the TRC20 and
 * TRC721 `Transfer` event, into `ITokenTransferEvent`. And it decides, per
 * transaction, whether the transfer list comes from logs or falls back to call
 * data, so no plugin writes its own fallback and no list mixes the two.
 * Contract-specific events (USDT `Issue`, SunSwap `Swap`) stay raw for plugins
 * to decode.
 *
 * A pure module, like `token-transfer.ts`, so tests pin the decoding without
 * driving block sync.
 *
 * @module backend/modules/blockchain/contract-events
 */
import type {
    IContractEvent,
    IInternalTransfer,
    ITokenTransfer,
    ITokenTransferEvent,
    ITransactionReceipt
} from '@/types';
import { TronGridClient } from './tron-grid.client.js';
import { decodeInternalTransfers } from './internal-transfers.js';

/**
 * `topics[0]` of `Transfer(address,address,uint256)`, the keccak-256 hash of
 * the signature. TRC20 and TRC721 share it.
 */
export const TRANSFER_EVENT_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Hex characters in one ABI word (32 bytes). */
const WORD_HEX = 64;

/** Hex characters in a 20-byte address without TRON's prefix byte. */
const ADDRESS_HEX = 40;

/** TRON mainnet address prefix byte, as hex. */
const TRON_ADDRESS_PREFIX_HEX = '41';

/** Matches a lowercase hex string, including the empty string. */
const HEX_PATTERN = /^[0-9a-f]*$/;

/** Everything a transaction's receipt contributes to its payload. */
export interface IResolvedTransactionEvents {
    /** Normalised logs; set only when the block's receipts are complete. */
    events?: IContractEvent[];
    /** Token movements from logs, or from call data as the fallback. */
    tokenTransfers: ITokenTransferEvent[];
    /** Value-bearing internal transfers; set only when receipts are complete. */
    internalTransfers?: IInternalTransfer[];
}

/** What `resolveTransactionEvents` needs to know about one transaction. */
export interface IResolveTransactionEventsInput {
    /** Transaction id, used to build each event's identity. */
    txId: string;
    /**
     * The transaction's `contractRet`. Call-data transfers are listed only for
     * `'SUCCESS'`, because a reverted call moved nothing.
     */
    status: string | undefined;
    /** The transaction's receipt, or null when none was fetched. */
    info: ITransactionReceipt | null;
    /**
     * Whether every transaction in the block got a receipt. Decided per block,
     * not per transaction, so a consumer can trust one answer for the whole
     * block: either every transfer in it came from logs or none did.
     */
    receiptsFetched: boolean;
    /** The call-data decode of this transaction, used only as the fallback. */
    calldataTransfer: ITokenTransfer | undefined;
}

/**
 * Normalise a hex string by removing `0x` and lowercasing it.
 *
 * TronGrid returns log fields without `0x` today, but a provider that adds it
 * must not produce a different `topics[0]` and so a missed subscription.
 *
 * @param value - Raw field from the receipt.
 * @returns The normalised hex, or null when the value is not a hex string.
 */
function normalizeHex(value: unknown): string | null {
    let normalized: string | null = null;

    if (typeof value === 'string') {
        const candidate = value.replace(/^0x/i, '').toLowerCase();
        if (HEX_PATTERN.test(candidate)) {
            normalized = candidate;
        }
    }

    return normalized;
}

/**
 * Convert a log's emitting address to base58.
 *
 * Log addresses arrive as 20 bytes of hex without TRON's `41` prefix, unlike
 * every other address in a TronGrid response, so they need the prefix added
 * before base58check encoding. An address that already carries the prefix is
 * accepted as well.
 *
 * @param hex - Normalised hex from the log's `address` field.
 * @returns The base58 address, or null when the value is not an address.
 */
function logAddressToBase58(hex: string): string | null {
    let base58: string | null = null;

    if (hex.length === ADDRESS_HEX) {
        base58 = TronGridClient.toBase58Address(`${TRON_ADDRESS_PREFIX_HEX}${hex}`);
    } else if (hex.length === ADDRESS_HEX + 2 && hex.startsWith(TRON_ADDRESS_PREFIX_HEX)) {
        base58 = TronGridClient.toBase58Address(hex);
    }

    return base58;
}

/**
 * Convert an indexed address topic to base58.
 *
 * An indexed address is stored right-aligned in a 32-byte word, so the last
 * 20 bytes are the address.
 *
 * @param topic - A 64-character normalised topic.
 * @returns The base58 address, or null when conversion fails.
 */
function topicToAddress(topic: string): string | null {
    return TronGridClient.toBase58Address(`${TRON_ADDRESS_PREFIX_HEX}${topic.slice(-ADDRESS_HEX)}`);
}

/**
 * Convert a 32-byte word to a decimal string.
 *
 * @param word - 64 hex characters.
 * @returns The value as a base-10 string, exact for any uint256.
 */
function wordToDecimal(word: string): string {
    return BigInt(`0x${word}`).toString(10);
}

/**
 * Normalise a receipt's raw logs into `IContractEvent`s.
 *
 * A log whose address cannot be converted, or whose topics or data are not
 * hex, is left out rather than guessed at. The `logIndex` of every other log
 * stays its position in the receipt, so identities stay stable even when one
 * log is skipped.
 *
 * @param txId - Transaction the logs belong to.
 * @param logs - The receipt's `log` array, which may be absent.
 * @returns The normalised events in emission order.
 */
export function normalizeContractEvents(txId: string, logs: ITransactionReceipt['log']): IContractEvent[] {
    const events: IContractEvent[] = [];

    for (const [logIndex, log] of (logs ?? []).entries()) {
        const addressHex = normalizeHex(log?.address);
        const contractAddress = addressHex ? logAddressToBase58(addressHex) : null;
        const topics = (log?.topics ?? []).map(normalizeHex);
        const data = normalizeHex(log?.data ?? '');

        if (!contractAddress || data === null || topics.some(topic => topic === null)) {
            continue;
        }

        events.push({
            eventId: `${txId}:${logIndex}`,
            txId,
            logIndex,
            contractAddress,
            topics: topics as string[],
            data
        });
    }

    return events;
}

/**
 * Decode one event as a standard token `Transfer`, if it is one.
 *
 * TRC20 and TRC721 share the signature, so the topic count tells them apart:
 * three topics means the amount is in `data` (TRC20), four means the token id
 * is the last topic (TRC721). Anything else with that signature is not a
 * standard transfer and is left undecoded.
 *
 * @param event - A normalised event.
 * @returns The decoded transfer, or undefined when the event is not a
 *          standard TRC20 or TRC721 `Transfer`.
 */
export function decodeTransferEvent(event: IContractEvent): ITokenTransferEvent | undefined {
    let decoded: ITokenTransferEvent | undefined;

    const [topic0, fromTopic, toTopic, tokenIdTopic] = event.topics;
    const isTransfer = topic0 === TRANSFER_EVENT_TOPIC
        && fromTopic?.length === WORD_HEX
        && toTopic?.length === WORD_HEX;

    if (isTransfer) {
        const from = topicToAddress(fromTopic);
        const to = topicToAddress(toTopic);
        const base = {
            eventId: event.eventId,
            txId: event.txId,
            logIndex: event.logIndex,
            source: 'log' as const,
            contractAddress: event.contractAddress
        };

        if (from && to && event.topics.length === 3 && event.data.length >= WORD_HEX) {
            decoded = { ...base, standard: 'trc20', from, to, rawAmount: wordToDecimal(event.data.slice(0, WORD_HEX)) };
        } else if (from && to && event.topics.length === 4 && tokenIdTopic?.length === WORD_HEX) {
            decoded = { ...base, standard: 'trc721', from, to, tokenId: wordToDecimal(tokenIdTopic) };
        }
    }

    return decoded;
}

/**
 * Express a call-data decode as an `ITokenTransferEvent`.
 *
 * Used only when the block's receipts are incomplete, so consumers read one
 * list whatever the source and filter on `source` when they need proof.
 *
 * @param txId - Transaction the call belongs to.
 * @param transfer - The call-data decode from `decodeTokenTransfer`.
 * @returns The transfer marked `source: 'calldata'`, with the identity
 *          `${txId}:calldata` since there is no log to index.
 */
export function calldataTransferToEvent(txId: string, transfer: ITokenTransfer): ITokenTransferEvent {
    return {
        eventId: `${txId}:calldata`,
        txId,
        source: 'calldata',
        standard: 'trc20',
        contractAddress: transfer.contractAddress,
        from: transfer.from,
        to: transfer.to,
        rawAmount: transfer.rawAmount
    };
}

/**
 * Work out a transaction's events, token transfers, and internal transfers.
 *
 * The source rule lives here, once, so no consumer reinvents it. When the
 * block's receipts are complete, events and internal transfers are set and the
 * transfer list comes from logs only. When they are not, events and internal
 * transfers stay absent, meaning unknown, and the transfer list falls back to
 * the call-data decode for a successful call. The two sources are never mixed
 * in one list, so there are no duplicates to merge.
 *
 * @param input - The transaction's id, status, receipt, the block's receipt
 *                completeness, and its call-data decode.
 * @returns The fields to set on the transaction's payload.
 */
export function resolveTransactionEvents(input: IResolveTransactionEventsInput): IResolvedTransactionEvents {
    const { txId, status, info, receiptsFetched, calldataTransfer } = input;
    let resolved: IResolvedTransactionEvents;

    if (receiptsFetched) {
        const events = normalizeContractEvents(txId, info?.log);
        const tokenTransfers: ITokenTransferEvent[] = [];
        for (const event of events) {
            const transfer = decodeTransferEvent(event);
            if (transfer) {
                tokenTransfers.push(transfer);
            }
        }

        resolved = {
            events,
            tokenTransfers,
            internalTransfers: decodeInternalTransfers(txId, info?.internal_transactions)
        };
    } else {
        resolved = {
            tokenTransfers: calldataTransfer && status === 'SUCCESS'
                ? [calldataTransferToEvent(txId, calldataTransfer)]
                : []
        };
    }

    return resolved;
}
