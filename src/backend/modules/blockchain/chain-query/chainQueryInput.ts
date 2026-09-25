/**
 * @fileoverview Re-validating every argument a chain query tool receives from a model.
 *
 * The tool's JSON schema tells the model what to send; it does not guarantee
 * what arrives. Each parser here checks one argument and either returns a
 * normalized value or throws a `ChainQueryError` of kind `input` whose message
 * says what a valid value looks like, so the model can correct itself. No
 * value reaches ClickHouse except through these parsers and query parameters.
 *
 * @module backend/modules/blockchain/chain-query/chainQueryInput
 */

import { normalizeAddress } from '../../../lib/tron-address.js';
import { TronGridClient } from '../tron-grid.client.js';
import { ChainQueryError } from './ChainQueryError.js';

/** Which kind of asset a token filter names, matching `tron._transfer.asset_type`. */
export type ChainAssetType = 'trx' | 'trc10' | 'trc20';

/** A token filter, in the form `tron._transfer` stores it. */
export interface IChainTokenFilter {
    /** Which kind of asset. */
    assetType: ChainAssetType;
    /** Empty for TRX, the decimal id for TRC-10, the contract address for TRC-20. */
    token: string;
}

/** The time range a query covers. */
export interface IChainWindow {
    /** Inclusive start. */
    from: Date;
    /** Exclusive end. */
    to: Date;
    /** True when the requested start fell before the retention window and was moved forward. */
    clampedToRetention: boolean;
}

/** How wide a tool lets its window be. */
export interface IWindowRules {
    /** Hours covered when the caller gives no `hours` or `since`. */
    defaultHours: number;
    /** The widest span the tool accepts, in hours. */
    maxHours: number;
}

/** Matches a TRC-10 token id, which is a decimal number. */
const TRC10_ID = /^\d{1,10}$/;

/** One hour in milliseconds. */
const HOUR_MS = 3_600_000;

/**
 * Read a required TRON address in base58 or hex form.
 *
 * The address is converted to hex and back, and must come back unchanged. A
 * mistyped or invented address usually passes the character check but fails
 * the checksum, and catching it here stops a model from reading an empty
 * result as "this wallet did nothing".
 *
 * @param value - The raw argument.
 * @param field - The parameter name, used in the error message.
 * @returns The address in base58.
 */
export function parseAddress(value: unknown, field: string): string {
    const text = typeof value === 'string' ? value.trim() : '';
    let base58: string | null = null;
    try {
        const normalized = normalizeAddress(text);
        base58 = TronGridClient.toBase58Address(normalized.hex);
        if (text.startsWith('T') && base58 !== text) {
            base58 = null;
        }
    } catch {
        base58 = null;
    }
    if (!base58) {
        throw new ChainQueryError(
            `${field} must be a valid TRON address: 34 characters starting with T (base58, checksum verified), or 42 hex characters starting with 41. Got ${JSON.stringify(text.slice(0, 64))}.`,
            'input'
        );
    }
    return base58;
}

/**
 * Read an optional TRON address.
 *
 * @param value - The raw argument, possibly absent.
 * @param field - The parameter name, used in the error message.
 * @returns The address in base58, or undefined when the argument was absent or empty.
 */
export function parseOptionalAddress(value: unknown, field: string): string | undefined {
    return value === undefined || value === null || value === '' ? undefined : parseAddress(value, field);
}

/**
 * Read a token filter: `TRX`, a TRC-20 contract address, or a TRC-10 token id.
 *
 * A symbol such as `USDT` is refused on purpose. Anyone can deploy a contract
 * whose `symbol()` answers `USDT`, and address poisoning relies on exactly
 * that, so a symbol cannot identify a token.
 *
 * @param value - The raw argument.
 * @returns The filter in the form `tron._transfer` stores it.
 */
export function parseToken(value: unknown): IChainTokenFilter {
    const text = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
    let filter: IChainTokenFilter;
    if (text.toUpperCase() === 'TRX') {
        filter = { assetType: 'trx', token: '' };
    } else if (TRC10_ID.test(text)) {
        filter = { assetType: 'trc10', token: text };
    } else if (text.startsWith('T') || text.startsWith('41')) {
        filter = { assetType: 'trc20', token: parseAddress(text, 'token') };
    } else {
        throw new ChainQueryError(
            'token must be "TRX", a TRC-20 contract address (for USDT: TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t), or a numeric TRC-10 token id. Symbols are not accepted, because any contract can claim any symbol.',
            'input'
        );
    }
    return filter;
}

/**
 * Read an optional token filter.
 *
 * @param value - The raw argument, possibly absent.
 * @returns The filter, or undefined when the argument was absent or empty.
 */
export function parseOptionalToken(value: unknown): IChainTokenFilter | undefined {
    return value === undefined || value === null || value === '' ? undefined : parseToken(value);
}

/**
 * Read an argument that must be one of a fixed set of words.
 *
 * @param value - The raw argument, possibly absent.
 * @param field - The parameter name, used in the error message.
 * @param allowed - The accepted values.
 * @param fallback - The value used when the argument is absent.
 * @returns One of `allowed`.
 */
export function parseChoice<T extends string>(value: unknown, field: string, allowed: readonly T[], fallback: T): T {
    let choice: T = fallback;
    if (value !== undefined && value !== null && value !== '') {
        if (typeof value !== 'string' || !allowed.includes(value as T)) {
            throw new ChainQueryError(`${field} must be one of ${allowed.map(item => `"${item}"`).join(', ')}.`, 'input');
        }
        choice = value as T;
    }
    return choice;
}

/**
 * Read a whole-number argument within a range.
 *
 * @param value - The raw argument, possibly absent.
 * @param field - The parameter name, used in the error message.
 * @param fallback - The value used when the argument is absent.
 * @param min - The smallest accepted value.
 * @param max - The largest accepted value.
 * @returns An integer between `min` and `max`.
 */
export function parseInteger(value: unknown, field: string, fallback: number, min: number, max: number): number {
    let result = fallback;
    if (value !== undefined && value !== null && value !== '') {
        const number = typeof value === 'string' ? Number(value) : value;
        if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) {
            throw new ChainQueryError(`${field} must be a whole number from ${min} to ${max}.`, 'input');
        }
        result = number;
    }
    return result;
}

/**
 * Read a boolean argument.
 *
 * @param value - The raw argument, possibly absent.
 * @param field - The parameter name, used in the error message.
 * @param fallback - The value used when the argument is absent.
 * @returns The boolean.
 */
export function parseFlag(value: unknown, field: string, fallback: boolean): boolean {
    let result = fallback;
    if (value !== undefined && value !== null) {
        if (typeof value !== 'boolean') {
            throw new ChainQueryError(`${field} must be true or false.`, 'input');
        }
        result = value;
    }
    return result;
}

/**
 * Read an ISO 8601 time argument.
 *
 * @param value - The raw argument.
 * @param field - The parameter name, used in the error message.
 * @returns The instant.
 */
function parseInstant(value: unknown, field: string): Date {
    const instant = typeof value === 'string' ? new Date(value) : new Date(Number.NaN);
    if (Number.isNaN(instant.getTime())) {
        throw new ChainQueryError(`${field} must be an ISO 8601 time such as "2026-09-24T03:00:00Z".`, 'input');
    }
    return instant;
}

/**
 * Work out the time window a query covers from `hours`, `since`, and `until`.
 *
 * `until` defaults to now and is never later than now. The start is `since`
 * when given, otherwise `hours` (or the tool's default) before the end. A
 * start older than the retention window is moved forward and flagged rather
 * than refused, because the answer for the part that exists is still useful,
 * as long as the caller is told the rest was never available.
 *
 * @param input - The tool's raw arguments.
 * @param rules - The tool's default and widest window.
 * @param now - The current time.
 * @param retentionDays - How many days of chain data ClickHouse keeps.
 * @returns The window, with the retention flag set when the start was moved.
 */
export function parseWindow(input: Record<string, unknown>, rules: IWindowRules, now: Date, retentionDays: number): IChainWindow {
    const until = input.until === undefined || input.until === null || input.until === ''
        ? now
        : parseInstant(input.until, 'until');
    const to = until.getTime() > now.getTime() ? now : until;
    let from: Date;
    if (input.since !== undefined && input.since !== null && input.since !== '') {
        from = parseInstant(input.since, 'since');
        if (input.hours !== undefined && input.hours !== null) {
            throw new ChainQueryError('Pass either since or hours, not both.', 'input');
        }
    } else {
        const hours = parseInteger(input.hours, 'hours', rules.defaultHours, 1, rules.maxHours);
        from = new Date(to.getTime() - hours * HOUR_MS);
    }
    if (from.getTime() >= to.getTime()) {
        throw new ChainQueryError('since must be earlier than until, and until must not be in the future.', 'input');
    }
    if (to.getTime() - from.getTime() > rules.maxHours * HOUR_MS) {
        throw new ChainQueryError(`The window may span at most ${rules.maxHours} hours for this tool. Narrow since/until or pass a smaller hours value.`, 'input');
    }
    const retentionStart = new Date(now.getTime() - retentionDays * 24 * HOUR_MS);
    const clampedToRetention = from.getTime() < retentionStart.getTime();
    if (clampedToRetention && to.getTime() <= retentionStart.getTime()) {
        throw new ChainQueryError(`Chain data is kept for ${retentionDays} days only. The whole window is older than that, so nothing can be answered for it.`, 'input');
    }
    return { from: clampedToRetention ? retentionStart : from, to, clampedToRetention };
}

/** The cursor fields that pin a paged listing to the window its first page answered for. */
export const WINDOW_CURSOR_KEYS = ['windowFrom', 'windowTo'] as const;

/**
 * The cursor fields recording a window, for a tool to spread into its cursor.
 *
 * @param window - The window the page was answered for.
 * @returns The window's ends as epoch milliseconds.
 */
export function windowCursorFields(window: IChainWindow): Record<string, number> {
    return { windowFrom: window.from.getTime(), windowTo: window.to.getTime() };
}

/**
 * Keep a paged listing on the window its first page answered for.
 *
 * A window given as `hours`, or with no `until`, is measured back from the
 * moment of the call, so it moves forward between one page and the next. With
 * a cursor bounding only the newest end, rows that slid out of the old end
 * would be skipped without any sign, and offset paging would skip or repeat
 * groups. The cursor therefore carries the first page's window, and a later
 * page answers for exactly that window whatever the other arguments say.
 *
 * @param cursor - The decoded cursor, or undefined on a first page.
 * @param window - The window worked out from this call's arguments.
 * @param rules - The tool's widest window, checked again so a forged cursor cannot widen it.
 * @returns The first page's window when a cursor was passed, otherwise `window`.
 */
export function pinWindowToCursor(cursor: Record<string, string | number> | undefined, window: IChainWindow, rules: IWindowRules): IChainWindow {
    let pinned = window;
    if (cursor) {
        const from = Number(cursor.windowFrom);
        const to = Number(cursor.windowTo);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from >= to || to - from > rules.maxHours * HOUR_MS) {
            throw new ChainQueryError('cursor is not one this tool issued. Pass back nextCursor exactly, or omit it.', 'input');
        }
        pinned = { from: new Date(from), to: new Date(to), clampedToRetention: window.clampedToRetention };
    }
    return pinned;
}

/**
 * Pack a paging position into an opaque cursor.
 *
 * @param position - The sort-key values of the last row returned.
 * @returns A base64url string the caller passes back unchanged.
 */
export function encodeCursor(position: Record<string, string | number>): string {
    return Buffer.from(JSON.stringify(position), 'utf8').toString('base64url');
}

/**
 * Unpack a cursor produced by {@link encodeCursor}.
 *
 * @param value - The raw argument, possibly absent.
 * @param keys - The fields the cursor must carry for this tool.
 * @returns The paging position, or undefined when no cursor was passed.
 */
export function decodeCursor(value: unknown, keys: readonly string[]): Record<string, string | number> | undefined {
    let position: Record<string, string | number> | undefined;
    if (value !== undefined && value !== null && value !== '') {
        try {
            const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8')) as Record<string, unknown>;
            if (keys.every(key => typeof parsed[key] === 'string' || typeof parsed[key] === 'number')) {
                position = parsed as Record<string, string | number>;
            }
        } catch {
            position = undefined;
        }
        if (!position) {
            throw new ChainQueryError('cursor is not one this tool issued. Pass back the nextCursor value from the previous response exactly, or omit it to start from the newest rows.', 'input');
        }
    }
    return position;
}
