/**
 * @fileoverview The contract for removing credentials from data.
 *
 * Code that must strip secrets before sending or storing data depends on this
 * interface rather than on `SecretScrubber` itself, so a test can pass a fake
 * and the scrubbing rules stay in one place.
 */

/**
 * Removes credentials from data. The replacement is a visible marker, so a
 * reader can see that a value was taken out rather than wondering whether it
 * was ever there.
 */
export interface ISecretScrubber {
    /**
     * Return a copy of a JSON-compatible value with every credential replaced.
     *
     * @param value - The data to clean, such as a tool's arguments or result.
     * @returns A scrubbed copy; the input is never modified.
     */
    scrub<T>(value: T): T;

    /**
     * Scrub one string, for text that is already serialized.
     *
     * @param text - Any string that may contain a credential.
     * @returns The string with each credential replaced.
     */
    scrubText(text: string): string;
}
