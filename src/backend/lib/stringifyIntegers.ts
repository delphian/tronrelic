/**
 * @fileoverview Turning every integer in a parsed JSON value into decimal text.
 *
 * java-tron's contract fields are protobuf integers, mostly int64, and int64
 * values reach past 2^53, the largest integer a JavaScript number holds
 * exactly. `parseJsonExactIntegers` keeps those large values exact by handing
 * them back as decimal strings, which leaves a field holding a number when it
 * is small and a string when it is large. Code that does arithmetic on such a
 * field works in testing and breaks on the rare large value.
 *
 * This helper removes the mixed case by making every integer a string, small
 * or large, so a field has one type whatever its size. It is applied where a
 * contract's fields are handed to observers and stored, which is
 * `describeContract` in the blockchain module.
 *
 * @module backend/lib/stringifyIntegers
 */

/**
 * Copy a parsed JSON value with every integer replaced by its decimal string.
 *
 * Exists so the contract fields observers receive have one type per field.
 * Walks arrays and plain objects recursively, since several contracts nest
 * their integers, such as `votes[].vote_count` or `new_contract.call_value`.
 * Strings are left as they are, which includes the integers
 * `parseJsonExactIntegers` already returned as strings. Numbers with a
 * fraction are left as numbers, because only whole numbers are protobuf
 * integers and a fraction has no exact decimal text to give. Booleans, null,
 * and undefined pass through unchanged.
 *
 * An integer that was already rounded before it reached here, because its
 * response was parsed with a plain `JSON.parse`, is stringified as the rounded
 * value. Keeping it exact is the job of the parse step, not this one.
 *
 * @param value - A value produced by JSON parsing, such as a contract's
 *                `parameter.value` bag.
 * @returns A copy of the value in which every integer is a decimal string. The
 *          input is not modified.
 */
export function stringifyIntegers(value: unknown): unknown {
    let result: unknown = value;
    if (typeof value === 'number' && Number.isInteger(value)) {
        result = String(value);
    } else if (Array.isArray(value)) {
        result = value.map(item => stringifyIntegers(item));
    } else if (value !== null && typeof value === 'object') {
        const copy: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            copy[key] = stringifyIntegers(entry);
        }
        result = copy;
    }
    return result;
}
