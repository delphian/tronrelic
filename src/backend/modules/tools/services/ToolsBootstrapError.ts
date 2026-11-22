/**
 * @fileoverview The error the tools bootstrap service throws when it refuses a create.
 *
 * The admin controller needs to tell "no such entry" and "the address is
 * already held" apart from a failure, to answer each with the right status.
 * A dedicated class with a code makes that a type check rather than a guess
 * based on message text.
 */

/** Why a bootstrap create was refused. */
export type ToolsBootstrapErrorCode = 'unknown-entry' | 'address-held';

/**
 * A bootstrap create refused before anything was written. The message is
 * written to be shown to the admin.
 */
export class ToolsBootstrapError extends Error {
    /**
     * @param code - Why the create was refused, which the controller maps to a status.
     * @param message - What happened, phrased for the admin.
     */
    constructor(public readonly code: ToolsBootstrapErrorCode, message: string) {
        super(message);
        this.name = 'ToolsBootstrapError';
    }
}
