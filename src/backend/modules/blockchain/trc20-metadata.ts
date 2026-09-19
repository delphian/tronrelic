/**
 * @fileoverview Decodes the answers of a TRC20 contract's metadata calls.
 *
 * `decimals()`, `symbol()`, and `name()` answer with ABI-encoded return data.
 * These helpers turn that data into plain values. They are pure, so a test
 * pins the decoding without a network call.
 *
 * @module backend/modules/blockchain/trc20-metadata
 */

/** Hex characters in one ABI word (32 bytes). */
const WORD_HEX = 64;

/** Largest decimals value treated as real; real tokens use 0 to 18. */
const MAX_DECIMALS = 36;

/**
 * Decode a `decimals()` answer.
 *
 * @param hex Return data from the contract call, with or without `0x`.
 * @returns The decimals, or null when the answer is missing or implausible.
 */
export function decodeAbiDecimals(hex: string | null | undefined): number | null {
    const clean = (hex ?? '').replace(/^0x/, '');
    let decimals: number | null = null;

    if (/^[0-9a-fA-F]+$/.test(clean) && clean.length >= WORD_HEX) {
        const value = Number(BigInt(`0x${clean.slice(0, WORD_HEX)}`));
        decimals = Number.isInteger(value) && value >= 0 && value <= MAX_DECIMALS ? value : null;
    }

    return decimals;
}

/**
 * Decode a `symbol()` or `name()` answer.
 *
 * Most tokens return a dynamic ABI `string` (offset word, length word, then
 * the bytes). Some older contracts return a fixed `bytes32` padded with zero
 * bytes instead, so both forms are accepted.
 *
 * @param hex Return data from the contract call, with or without `0x`.
 * @returns The decoded text, or null when there is none.
 */
export function decodeAbiString(hex: string | null | undefined): string | null {
    const clean = (hex ?? '').replace(/^0x/, '');
    let text: string | null = null;

    if (/^[0-9a-fA-F]*$/.test(clean) && clean.length >= WORD_HEX) {
        let bytesHex: string;
        if (clean.length >= WORD_HEX * 2 && Number(BigInt(`0x${clean.slice(0, WORD_HEX)}`)) === 32) {
            const length = Number(BigInt(`0x${clean.slice(WORD_HEX, WORD_HEX * 2)}`));
            bytesHex = clean.slice(WORD_HEX * 2, WORD_HEX * 2 + length * 2);
        } else {
            bytesHex = clean.slice(0, WORD_HEX).replace(/(00)+$/, '');
        }
        const decoded = Buffer.from(bytesHex, 'hex').toString('utf8').replace(/\0/g, '').trim();
        text = decoded.length > 0 ? decoded : null;
    }

    return text;
}
