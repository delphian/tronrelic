/**
 * Unit tests for the TRC20 transfer decoder and the metadata decoders.
 *
 * Block sync delivers `payload.tokenTransfer` from `decodeTokenTransfer`, and
 * plugins compare its `rawAmount` against thresholds, so a decoding slip would
 * silently misreport every token transfer on the site. `getTrc20TokenInfo`
 * relies on the metadata decoders for the decimals that turn raw amounts into
 * whole tokens.
 */
import { describe, it, expect } from 'vitest';
import { decodeTokenTransfer } from '../token-transfer.js';
import { decodeAbiDecimals, decodeAbiString } from '../trc20-metadata.js';

/** USDT contract, base58. */
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/** 20-byte body of the USDT address, used here as an arbitrary account address. */
const ADDRESS_BODY = 'a614f803b6fd780986a42c78ec9c7f77e6ded13c';

/**
 * Left-pad hex to one 32-byte ABI word.
 *
 * @param hex Hex digits to pad.
 * @returns 64 hex characters.
 */
function word(hex: string): string {
    return hex.padStart(64, '0');
}

describe('decodeTokenTransfer', () => {
    it('decodes transfer(address,uint256) with the signer as sender', () => {
        const data = `a9059cbb${word(ADDRESS_BODY)}${word('3b9aca00')}`;

        expect(decodeTokenTransfer(USDT, 'TSigner', data)).toEqual({
            contractAddress: USDT,
            method: 'transfer',
            from: 'TSigner',
            to: USDT,
            rawAmount: '1000000000'
        });
    });

    it('decodes transferFrom with the sender named in the call', () => {
        const data = `0x23b872dd${word(ADDRESS_BODY)}${word(ADDRESS_BODY)}${word('01')}`;

        expect(decodeTokenTransfer(USDT, 'TSpender', data)).toMatchObject({
            method: 'transferFrom',
            from: USDT,
            to: USDT,
            rawAmount: '1'
        });
    });

    it('keeps amounts larger than a JavaScript number exactly', () => {
        const data = `a9059cbb${word(ADDRESS_BODY)}${'f'.repeat(64)}`;

        expect(decodeTokenTransfer(USDT, 'TSigner', data)?.rawAmount).toBe((2n ** 256n - 1n).toString());
    });

    it.each([
        ['another method', `095ea7b3${word(ADDRESS_BODY)}${word('01')}`],
        ['truncated call data', `a9059cbb${word(ADDRESS_BODY)}`],
        ['no call data', undefined],
        ['non-hex call data', `a9059cbb${word(ADDRESS_BODY)}${'z'.repeat(64)}`]
    ])('returns undefined for %s', (_label, data) => {
        expect(decodeTokenTransfer(USDT, 'TSigner', data)).toBeUndefined();
    });
});

describe('decodeAbiDecimals', () => {
    it('reads a uint8 answer', () => {
        expect(decodeAbiDecimals(word('06'))).toBe(6);
        expect(decodeAbiDecimals(`0x${word('12')}`)).toBe(18);
    });

    it('rejects missing or implausible answers', () => {
        expect(decodeAbiDecimals(null)).toBeNull();
        expect(decodeAbiDecimals('')).toBeNull();
        expect(decodeAbiDecimals(word('ff'))).toBeNull();
    });
});

describe('decodeAbiString', () => {
    it('reads a dynamic ABI string', () => {
        const text = Buffer.from('USDT').toString('hex');
        const encoded = `${word('20')}${word('04')}${text.padEnd(64, '0')}`;

        expect(decodeAbiString(encoded)).toBe('USDT');
    });

    it('reads a bytes32 answer from older contracts', () => {
        const encoded = Buffer.from('JST').toString('hex').padEnd(64, '0');

        expect(decodeAbiString(encoded)).toBe('JST');
    });

    it('returns null when there is no text', () => {
        expect(decodeAbiString(null)).toBeNull();
        expect(decodeAbiString(word('0'))).toBeNull();
    });
});
