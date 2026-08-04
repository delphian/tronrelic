/**
 * @fileoverview Client-side TRON address validation.
 *
 * A base58 shape check — 'T' plus 33 characters from the base58 alphabet — is
 * cheap but weak: a single mistyped character usually lands on another valid
 * base58 character, so the typo passes and the address is accepted as real. It
 * refers to no account that exists, which downstream means a tag row nobody can
 * explain or a tracked account whose backfill returns nothing forever.
 *
 * Base58Check exists to catch exactly that. The last four bytes of a decoded
 * TRON address are the first four bytes of `sha256(sha256(payload))`, so
 * recomputing them rejects essentially every single-character typo. This module
 * is the frontend's one implementation; UI that accepts an address should call
 * `isValidTronAddress` rather than testing a regex, so the bar is identical
 * everywhere and can be raised in one place.
 *
 * `tronweb` is deliberately not used — it is banned on the client (see
 * `modules/user/lib/tronLink.ts`). `@noble/hashes` is already a frontend
 * dependency, and SHA-256 over 21 bytes is trivial next to a keystroke.
 */

import { sha256 } from '@noble/hashes/sha256';

/** Base58 alphabet — excludes 0, O, I, l to avoid visual ambiguity. */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Base58 shape of a TRON address: 'T' followed by 33 base58 characters.
 * Necessary but not sufficient — the fast pre-filter that rejects obvious
 * non-addresses before the checksum work, never the whole test.
 */
const TRON_ADDRESS_SHAPE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** Decoded length of a TRON address: 0x41 prefix + 20 payload bytes + 4 checksum bytes. */
const DECODED_LENGTH = 25;

/** Number of trailing bytes carrying the double-SHA-256 checksum. */
const CHECKSUM_LENGTH = 4;

/** Mainnet address prefix byte; base58 'T' addresses always decode to this. */
const MAINNET_PREFIX = 0x41;

/**
 * Decode a base58 string to its bytes.
 *
 * Accumulates into a BigInt rather than doing per-digit carry arithmetic —
 * addresses are 25 bytes, so the cost is irrelevant and the arithmetic is
 * obviously correct. Leading '1' characters encode leading zero bytes, which
 * the numeric form cannot represent, so they are restored explicitly.
 *
 * @param text - Base58 text to decode.
 * @returns The decoded bytes, or null if a character is outside the alphabet.
 */
function base58Decode(text: string): Uint8Array | null {
    let num = 0n;
    for (const char of text) {
        const digit = BASE58_ALPHABET.indexOf(char);
        if (digit < 0) {
            return null;
        }
        num = num * 58n + BigInt(digit);
    }

    const bytes: number[] = [];
    while (num > 0n) {
        bytes.unshift(Number(num % 256n));
        num = num / 256n;
    }

    for (const char of text) {
        if (char === '1') {
            bytes.unshift(0);
        } else {
            break;
        }
    }

    return new Uint8Array(bytes);
}

/**
 * Verify that a string is a real, checksum-valid TRON mainnet address.
 *
 * Use this anywhere a user supplies an address — a typed field, a URL query
 * param, stored state being rehydrated — so a typo is caught at the point of
 * entry instead of becoming a record that refers to nothing.
 *
 * @param address - Candidate address. Trimming is the caller's responsibility,
 *        since a value carrying spaces is not something to silently accept.
 * @returns True only when the shape, prefix byte, and Base58Check checksum all
 *          agree, meaning the string encodes a well-formed mainnet address.
 */
export function isValidTronAddress(address: string): boolean {
    if (!TRON_ADDRESS_SHAPE.test(address)) {
        return false;
    }

    const decoded = base58Decode(address);
    if (!decoded || decoded.length !== DECODED_LENGTH || decoded[0] !== MAINNET_PREFIX) {
        return false;
    }

    const payload = decoded.subarray(0, DECODED_LENGTH - CHECKSUM_LENGTH);
    const expected = sha256(sha256(payload)).subarray(0, CHECKSUM_LENGTH);
    for (let index = 0; index < CHECKSUM_LENGTH; index += 1) {
        if (decoded[DECODED_LENGTH - CHECKSUM_LENGTH + index] !== expected[index]) {
            return false;
        }
    }

    return true;
}
