/**
 * Unit tests for the chain query tools' argument parsing and unit conversion.
 *
 * These are the checks that stand between a model's arguments and ClickHouse,
 * and the conversion that stands between ClickHouse's base units and the
 * model. A lenient parser lets an invented address read as "no activity", and
 * an off-by-one in the conversion reports amounts wrong by a factor of ten.
 */
import { describe, it, expect } from 'vitest';
import { ChainQueryError } from '../chain-query/ChainQueryError.js';
import { decodeCursor, encodeCursor, parseAddress, parseToken, parseWindow } from '../chain-query/chainQueryInput.js';
import { formatUnits, parseUnits } from '../chain-query/tokenUnits.js';

/** The USDT contract, in base58 and java-tron hex. */
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_HEX = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c';

/** A fixed "now", so windows are predictable. */
const NOW = new Date(Date.UTC(2026, 8, 24, 12, 0, 0));

/** Seven days, the chain data retention used below. */
const RETENTION_DAYS = 7;

/**
 * Assert that a call throws a `ChainQueryError` of kind `input`.
 *
 * @param call - The parse to run.
 */
function expectInputError(call: () => unknown): void {
    let caught: unknown;
    try {
        call();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(ChainQueryError);
    expect((caught as ChainQueryError).kind).toBe('input');
}

describe('formatUnits and parseUnits', () => {
    it('renders base units as exact whole units', () => {
        expect(formatUnits('12500000', 6)).toBe('12.5');
        expect(formatUnits('0', 6)).toBe('0');
        expect(formatUnits('1', 18)).toBe('0.000000000000000001');
        expect(formatUnits('42', 0)).toBe('42');
        // 2^200, far beyond 2^53, stays exact to the last digit.
        expect(formatUnits('1606938044258990275541962092341162602522202993782792835301376', 6))
            .toBe('1606938044258990275541962092341162602522202993782792835.301376');
    });

    it('converts whole units to base units, refusing more precision than the token has', () => {
        expect(parseUnits('1000.5', 6)).toBe('1000500000');
        expect(parseUnits(0.1, 6)).toBe('100000');
        expect(parseUnits('7', 0)).toBe('7');
        expect(parseUnits('1.1234567', 6)).toBeNull();
        expect(parseUnits('-1', 6)).toBeNull();
        expect(parseUnits('1e3', 6)).toBeNull();
    });
});

describe('parseAddress', () => {
    it('accepts base58 and converts hex to base58', () => {
        expect(parseAddress(USDT, 'address')).toBe(USDT);
        expect(parseAddress(USDT_HEX, 'address')).toBe(USDT);
    });

    it('refuses an address whose checksum does not match', () => {
        // One character changed: the right shape, but not a real address.
        expectInputError(() => parseAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u', 'address'));
        expectInputError(() => parseAddress('not an address', 'address'));
    });
});

describe('parseToken', () => {
    it('reads TRX, TRC-10 ids, and TRC-20 contracts in the ledger\'s form', () => {
        expect(parseToken('trx')).toEqual({ assetType: 'trx', token: '' });
        expect(parseToken('1002000')).toEqual({ assetType: 'trc10', token: '1002000' });
        expect(parseToken(USDT)).toEqual({ assetType: 'trc20', token: USDT });
    });

    it('refuses a symbol, because any contract can claim one', () => {
        expectInputError(() => parseToken('USDT'));
    });
});

describe('parseWindow', () => {
    const rules = { defaultHours: 24, maxHours: 168 };

    it('defaults to the tool\'s hours before now', () => {
        const window = parseWindow({}, rules, NOW, RETENTION_DAYS);
        expect(window.to).toEqual(NOW);
        expect(window.from).toEqual(new Date(NOW.getTime() - 24 * 3_600_000));
        expect(window.clampedToRetention).toBe(false);
    });

    it('moves a start older than retention forward and says so', () => {
        const window = parseWindow({ since: '2026-09-01T00:00:00Z', until: '2026-09-18T00:00:00Z' }, { defaultHours: 24, maxHours: 24 * 30 }, NOW, RETENTION_DAYS);
        expect(window.clampedToRetention).toBe(true);
        expect(window.from).toEqual(new Date(NOW.getTime() - RETENTION_DAYS * 86_400_000));
    });

    it('refuses a backwards window, a window wider than the tool allows, and since with hours', () => {
        expectInputError(() => parseWindow({ since: '2026-09-24T10:00:00Z', until: '2026-09-24T09:00:00Z' }, rules, NOW, RETENTION_DAYS));
        expectInputError(() => parseWindow({ since: '2026-09-10T00:00:00Z' }, rules, NOW, RETENTION_DAYS));
        expectInputError(() => parseWindow({ since: '2026-09-24T00:00:00Z', hours: 2 }, rules, NOW, RETENTION_DAYS));
    });

    it('refuses a window lying entirely before retention', () => {
        expectInputError(() => parseWindow({ since: '2026-09-01T00:00:00Z', until: '2026-09-02T00:00:00Z' }, rules, NOW, RETENTION_DAYS));
    });
});

describe('cursors', () => {
    it('round-trip, and a cursor from elsewhere is refused', () => {
        const cursor = encodeCursor({ offset: 25 });
        expect(decodeCursor(cursor, ['offset'])).toEqual({ offset: 25 });
        expect(decodeCursor(undefined, ['offset'])).toBeUndefined();
        expectInputError(() => decodeCursor('garbage', ['offset']));
        expectInputError(() => decodeCursor(encodeCursor({ other: 1 }), ['offset']));
    });
});
