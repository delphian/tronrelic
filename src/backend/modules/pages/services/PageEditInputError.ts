/**
 * @fileoverview The error the page service throws when a proposed page edit
 * breaks one of its field rules.
 *
 * Callers need to tell bad input apart from an infrastructure failure. The AI
 * edit tool shows this error's message to the model so it can correct the
 * call, while any other failure is logged and reported without detail. A
 * dedicated class makes that split a type check rather than a guess based on
 * message text.
 *
 * @module backend/modules/pages/services/PageEditInputError
 */

/**
 * A proposed page edit refused because of what the caller sent. The message is
 * written to be shown to the caller.
 */
export class PageEditInputError extends Error {
    /**
     * @param message - What was wrong with the input, phrased so the caller
     *   can fix it.
     */
    constructor(message: string) {
        super(message);
        this.name = 'PageEditInputError';
    }
}
