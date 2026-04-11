/**
 * @fileoverview Web Worker for TRON address generation.
 *
 * Runs secp256k1 key derivation and Base58Check encoding off the main thread
 * so the UI stays responsive during vanity search. Uses elliptic for EC math,
 * js-sha3 for Keccak-256, and @noble/hashes for SHA-256 (pure JS, no Node
 * crypto dependency).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { ec as EC } from 'elliptic';
import { keccak256 } from 'js-sha3';
import { sha256 } from '@noble/hashes/sha256';

/** Base58 alphabet — excludes 0, O, I, l to avoid visual ambiguity. */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const secp256k1 = new EC('secp256k1');

/* ------------------------------------------------------------------ */
/*  Encoding helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Encode a byte array to Base58.
 *
 * @param buffer - Raw bytes to encode
 * @returns Base58-encoded string
 */
function base58Encode(buffer: Uint8Array): string {
    let num = BigInt(0);
    for (const byte of buffer) {
        num = num * 256n + BigInt(byte);
    }

    let result = '';
    while (num > 0n) {
        const remainder = Number(num % 58n);
        num = num / 58n;
        result = BASE58_ALPHABET[remainder] + result;
    }

    for (const byte of buffer) {
        if (byte === 0) {
            result = '1' + result;
        } else {
            break;
        }
    }

    return result;
}

/**
 * Base58Check encode a payload (payload + 4-byte double-SHA-256 checksum).
 *
 * @param payload - Raw address bytes (21 bytes for TRON: 0x41 prefix + 20-byte hash)
 * @returns Base58Check-encoded TRON address starting with 'T'
 */
function base58CheckEncode(payload: Uint8Array): string {
    const first = sha256(payload);
    const second = sha256(first);
    const checksum = second.slice(0, 4);

    const combined = new Uint8Array(payload.length + 4);
    combined.set(payload);
    combined.set(checksum, payload.length);

    return base58Encode(combined);
}

/**
 * Convert a hex string to a Uint8Array.
 *
 * @param hex - Even-length hex string without 0x prefix
 * @returns Byte array
 */
function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

/* ------------------------------------------------------------------ */
/*  Address generation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Generate a single TRON address from a random private key.
 *
 * Steps: random key -> secp256k1 public key -> keccak256 -> last 20 bytes
 * -> 0x41 prefix -> Base58Check.
 *
 * @returns Object with base58 address and hex private key
 */
function generateAddress(): { address: string; privateKey: string } {
    const keyPair = secp256k1.genKeyPair();
    const privateKey = keyPair.getPrivate('hex').padStart(64, '0');
    const publicKeyHex = keyPair.getPublic(false, 'hex');

    const pubBytes = hexToBytes(publicKeyHex.slice(2));
    const hash = keccak256(pubBytes);

    const rawAddress = new Uint8Array(21);
    rawAddress[0] = 0x41;
    const hashBytes = hexToBytes(hash.slice(-40));
    rawAddress.set(hashBytes, 1);

    const address = base58CheckEncode(rawAddress);

    return { address, privateKey };
}

/* ------------------------------------------------------------------ */
/*  Worker message handling                                            */
/* ------------------------------------------------------------------ */

/** Whether a vanity search is currently running. */
let searching = false;

/**
 * Run a vanity search loop using batched iterations with setTimeout(0) yields.
 *
 * Each batch generates BATCH_SIZE addresses, then yields the event loop via
 * setTimeout so the worker can process incoming messages (e.g. vanity-stop).
 * Without yielding, the synchronous loop would block the event loop and
 * prevent stop messages from being handled.
 *
 * @param pattern - Substring to search for inside the address
 * @param caseSensitive - Whether the match should be case-sensitive
 */
function runVanitySearch(pattern: string, caseSensitive: boolean): void {
    searching = true;
    let checked = 0;
    const startTime = Date.now();
    const searchPattern = caseSensitive ? pattern : pattern.toLowerCase();

    const BATCH_SIZE = 100;
    const PROGRESS_INTERVAL = 500;
    let lastProgressTime = startTime;

    const processBatch = (): void => {
        if (!searching) {
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = elapsed > 0 ? Math.round(checked / elapsed) : 0;
            self.postMessage({ type: 'vanity-stopped', checked, rate });
            return;
        }

        for (let i = 0; i < BATCH_SIZE && searching; i++) {
            const { address, privateKey } = generateAddress();
            checked++;

            const haystack = caseSensitive ? address : address.toLowerCase();
            if (haystack.includes(searchPattern)) {
                self.postMessage({ type: 'vanity-match', address, privateKey });
            }
        }

        const now = Date.now();
        if (now - lastProgressTime >= PROGRESS_INTERVAL) {
            const elapsed = (now - startTime) / 1000;
            const rate = Math.round(checked / elapsed);
            self.postMessage({ type: 'vanity-progress', checked, rate });
            lastProgressTime = now;
        }

        setTimeout(processBatch, 0);
    };

    processBatch();
}

self.onmessage = (event: MessageEvent) => {
    const { type } = event.data;

    switch (type) {
        case 'generate': {
            const result = generateAddress();
            self.postMessage({ type: 'generated', ...result });
            break;
        }
        case 'vanity-start': {
            const { pattern, caseSensitive } = event.data as { pattern: string; caseSensitive: boolean };
            runVanitySearch(pattern, caseSensitive);
            break;
        }
        case 'vanity-stop': {
            searching = false;
            break;
        }
    }
};
