/**
 * @fileoverview JSON parsing that keeps large integers exact.
 *
 * `JSON.parse` turns every number into a JavaScript double, which holds
 * integers exactly only up to 2^53 (`Number.MAX_SAFE_INTEGER`). java-tron's
 * int64 fields go up to 2^63 - 1, and TRC-10 token amounts do reach that range,
 * so a plain parse silently rounds them before any of our code sees the value.
 *
 * This parser uses the reviver's access to each number's original source text,
 * and returns an integer beyond the safe range as its exact decimal string
 * instead. Every other value parses exactly as `JSON.parse` would, so a caller
 * that only reads small numbers sees no difference.
 *
 * @module backend/lib/parseJsonExactIntegers
 */

/** The reviver's third argument, which carries a primitive's source text. */
interface IJsonReviverContext {
    source?: string;
}

/** Matches the source text of a JSON integer: no fraction and no exponent. */
const JSON_INTEGER_SOURCE = /^-?\d+$/;

/**
 * Matches a JSON number token of 16 or more digits, the fewest an integer
 * beyond 2^53 (9007199254740992) can have. A number token always follows the
 * start of the text, a colon, a comma, or an opening bracket, apart from
 * whitespace, so a long run of digits inside a hex string does not match.
 * A match inside some other string only costs the slower parse, never a
 * wrong result.
 */
const LONG_NUMBER_TOKEN = /(?:^|[:,[])\s*-?\d{16,}/;

/**
 * Keep an unsafe integer as the exact text it was written as.
 *
 * The reviver `JSON.parse` calls for every value when a large number may be
 * present. It relies on the reviver's third argument, which carries each
 * primitive's source text.
 *
 * @param _key - The property name or array index, which the decision does not need.
 * @param value - The value as `JSON.parse` produced it, already rounded if it was a large number.
 * @param context - Carries `source`, the value's original text.
 * @returns The source text for an integer beyond 2^53, otherwise the value unchanged.
 */
function keepUnsafeIntegerText(_key: string, value: unknown, context?: IJsonReviverContext): unknown {
    let result = value;
    if (
        typeof value === 'number'
        && !Number.isSafeInteger(value)
        && typeof context?.source === 'string'
        && JSON_INTEGER_SOURCE.test(context.source)
    ) {
        result = context.source;
    }
    return result;
}

/**
 * Parse JSON text, keeping each integer beyond 2^53 as its exact decimal string.
 *
 * Exists so a provider response carrying int64 values can be read without
 * rounding them. A number with a fraction or an exponent is left as a double,
 * because only integer source text can be carried exactly as a string.
 *
 * A reviver makes `JSON.parse` several times slower, and block sync parses
 * every block and receipt response through here. So the reviver is used only
 * when the text holds a number token long enough to be unsafe; any other text
 * parses exactly as a plain `JSON.parse` would.
 *
 * @param text - The JSON text, such as an HTTP response body.
 * @returns The parsed value, with unsafe integers as decimal strings.
 * @throws SyntaxError when the text is not valid JSON, as `JSON.parse` does.
 */
export function parseJsonExactIntegers(text: string): unknown {
    return LONG_NUMBER_TOKEN.test(text)
        ? JSON.parse(text, keepUnsafeIntegerText)
        : JSON.parse(text);
}
