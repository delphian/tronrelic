/**
 * @fileoverview Decodes a TRC20 token movement from a smart contract call.
 *
 * Core reports a `TriggerSmartContract` with the token contract as its
 * recipient and the call value (normally zero TRX) as its amount, so the real
 * recipient and token amount live only in the ABI-encoded call data. Plugins
 * used to decode that themselves, each with its own copy. Block sync now
 * decodes it once here and delivers the result as `payload.tokenTransfer`.
 *
 * A pure module, alongside `transaction-parse.ts`, so a test can pin the
 * decoding without driving block sync.
 *
 * @module backend/modules/blockchain/token-transfer
 */

import type { ITokenTransfer } from '@/types';
import { TronGridClient } from './tron-grid.client.js';

/** Selector of `transfer(address,uint256)`. */
const TRANSFER_SELECTOR = 'a9059cbb';

/** Selector of `transferFrom(address,address,uint256)`. */
const TRANSFER_FROM_SELECTOR = '23b872dd';

/** Hex characters in one ABI word (32 bytes). */
const WORD_HEX = 64;

/** Hex characters in a function selector (4 bytes). */
const SELECTOR_HEX = 8;

/** TRON mainnet address prefix byte, as hex. */
const TRON_ADDRESS_PREFIX_HEX = '41';

/**
 * Read one 32-byte ABI word from call data.
 *
 * @param data Call data hex without `0x`, starting with the selector.
 * @param index Zero-based word position after the selector.
 * @returns The word's 64 hex characters, or null when the data is too short.
 */
function readWord(data: string, index: number): string | null {
    const start = SELECTOR_HEX + index * WORD_HEX;
    const word = data.slice(start, start + WORD_HEX);

    return word.length === WORD_HEX ? word : null;
}

/**
 * Convert an ABI address word to a base58 TRON address.
 *
 * The word holds a 20-byte address right-aligned; TRON addresses add the
 * `0x41` prefix byte before base58check encoding.
 *
 * @param word 64 hex characters from the call data.
 * @returns The base58 address, or null when conversion fails.
 */
function wordToAddress(word: string): string | null {
    return TronGridClient.toBase58Address(`${TRON_ADDRESS_PREFIX_HEX}${word.slice(-40)}`);
}

/**
 * Convert an ABI uint256 word to a decimal string.
 *
 * @param word 64 hex characters from the call data.
 * @returns The value as a base-10 string; exact for any uint256.
 */
function wordToAmount(word: string): string {
    return BigInt(`0x${word}`).toString(10);
}

/**
 * Decode the token movement a `TriggerSmartContract` call performed.
 *
 * Only the two standard TRC20 movement methods are recognised. Anything else,
 * including malformed or truncated call data, yields undefined so the payload
 * simply carries no `tokenTransfer`.
 *
 * @param contractAddress Base58 address of the called contract (the token).
 * @param ownerAddress Base58 signer of the transaction; the sender for `transfer`.
 * @param callData Hex call data from the contract parameter, with or without `0x`.
 * @returns The decoded movement, or undefined when the call is not a token transfer.
 */
export function decodeTokenTransfer(
    contractAddress: string,
    ownerAddress: string,
    callData: string | undefined
): ITokenTransfer | undefined {
    const data = (callData ?? '').replace(/^0x/, '').toLowerCase();
    const selector = data.slice(0, SELECTOR_HEX);
    let decoded: ITokenTransfer | undefined;

    try {
        if (selector === TRANSFER_SELECTOR) {
            const toWord = readWord(data, 0);
            const amountWord = readWord(data, 1);
            const to = toWord ? wordToAddress(toWord) : null;
            if (to && amountWord) {
                decoded = { contractAddress, method: 'transfer', from: ownerAddress, to, rawAmount: wordToAmount(amountWord) };
            }
        } else if (selector === TRANSFER_FROM_SELECTOR) {
            const fromWord = readWord(data, 0);
            const toWord = readWord(data, 1);
            const amountWord = readWord(data, 2);
            const from = fromWord ? wordToAddress(fromWord) : null;
            const to = toWord ? wordToAddress(toWord) : null;
            if (from && to && amountWord) {
                decoded = { contractAddress, method: 'transferFrom', from, to, rawAmount: wordToAmount(amountWord) };
            }
        }
    } catch {
        // Non-hex characters in the call data make BigInt throw. A call we
        // cannot read is not a token transfer we can report.
        decoded = undefined;
    }

    return decoded;
}
