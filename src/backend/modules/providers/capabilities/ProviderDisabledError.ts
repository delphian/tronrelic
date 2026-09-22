/**
 * @fileoverview The error a capability implementation throws when its vendor is
 * switched off in configuration.
 *
 * Why a distinct type: a consumer that tries vendors in order needs to tell "the
 * operator turned this one off, move on" from "the network failed, retry the
 * whole tick". Both arrive as thrown errors from the same call, so the
 * distinction has to be carried by the error's type rather than its message.
 */

/**
 * Raised by a capability implementation when the operator has disabled its
 * vendor. Routing code skips the vendor; anything else treats it as a failure.
 */
export class ProviderDisabledError extends Error {
    /** The vendor that is switched off. */
    public readonly vendorId: string;

    /**
     * @param vendorId - The vendor that is switched off, named in the message so
     *   a log line identifies which configuration card to look at.
     */
    constructor(vendorId: string) {
        super(`Provider '${vendorId}' is disabled in its configuration`);
        this.name = 'ProviderDisabledError';
        this.vendorId = vendorId;
    }
}
