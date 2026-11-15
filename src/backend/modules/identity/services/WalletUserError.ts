/**
 * @fileoverview A wallet operation failure the caller may be told about.
 *
 * The wallet controller sends a caller only the text of errors it recognises
 * as safe, and a generic message for everything else, so an unexpected
 * internal error (a database failure, a library message) never reaches the
 * browser. This class is how the wallet service marks a failure as one the
 * caller caused and may be told about.
 *
 * It carries two texts because some failures need different wording for each
 * audience. The log keeps the precise cause, such as which account already
 * owns a wallet; the caller gets wording that tells them what to do next
 * without stating more than they need.
 */

/**
 * A wallet failure with separate log and user-facing wording.
 */
export class WalletUserError extends Error {
    /**
     * @param message - The precise cause, written to the system log and seen
     *   by tests. Never sent to the caller unless it equals `userMessage`.
     * @param userMessage - What the API response and the frontend show.
     *   Defaults to `message` for failures whose cause is safe to state.
     */
    constructor(message: string, readonly userMessage: string = message) {
        super(message);
        this.name = 'WalletUserError';
    }
}
