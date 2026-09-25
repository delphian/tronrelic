/**
 * @fileoverview The one error type the chain query tools report to a model.
 *
 * A model can only recover from a failure it understands. "Query failed" gives
 * it nothing to change, while "the read limit was hit; narrow the window" tells
 * it what to do next. Every failure inside a chain query tool is turned into a
 * `ChainQueryError` whose message is written for the model, and whose `kind`
 * says whether retrying with different input can help.
 *
 * @module backend/modules/blockchain/chain-query/ChainQueryError
 */

/**
 * What went wrong, from the caller's point of view.
 *
 * - `input`: an argument was invalid; fix it and call again.
 * - `limit`: the `ai-agent` account's limits stopped a query; ask for less.
 * - `unavailable`: chain data cannot be read right now; retrying later may work.
 * - `failed`: anything else; the details are in the server log, not the message.
 */
export type ChainQueryErrorKind = 'input' | 'limit' | 'unavailable' | 'failed';

/**
 * An error whose message is safe and useful to show a model.
 */
export class ChainQueryError extends Error {
    /**
     * @param message - What went wrong and, where possible, what to do instead.
     *                  Shown to the model as-is, so it must not carry SQL,
     *                  credentials, or internal hostnames.
     * @param kind - Whether a retry with different input can help.
     */
    constructor(message: string, public readonly kind: ChainQueryErrorKind) {
        super(message);
        this.name = 'ChainQueryError';
    }
}
