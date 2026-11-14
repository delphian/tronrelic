/**
 * @fileoverview The error the pages module throws when a page write is refused
 * because of what the caller sent.
 *
 * Callers need to tell bad input apart from an infrastructure failure. The AI
 * page tools show this error's message to the model so it can correct the
 * call, while any other failure is logged and reported without detail. A
 * dedicated class makes that split a type check rather than a guess based on
 * message text. It covers the field rules of a proposed page or edit, and the
 * title and slug rules the page content type checks on every write.
 *
 * @module backend/modules/pages/services/PageInputError
 */

/**
 * A page write refused because of what the caller sent. The message is
 * written to be shown to the caller.
 */
export class PageInputError extends Error {
    /**
     * @param message - What was wrong with the input, phrased so the caller
     *   can fix it.
     */
    constructor(message: string) {
        super(message);
        this.name = 'PageInputError';
    }
}
