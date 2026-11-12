/**
 * @file IMcpClientAdmissionPolicy.ts
 *
 * The contract the MCP module fulfils so the identity module's OAuth server
 * can ask which apps may register, without owning that rule itself.
 */

import type { IMcpClientDetails } from './IMcpClientDetails.js';

/**
 * Decides which apps may register with the OAuth server.
 *
 * The OAuth server exists so apps can reach the MCP endpoint, which makes the
 * rule for which apps may connect the MCP module's to own. The identity
 * module builds the OAuth server and starts first, so it cannot import the
 * rule from the MCP module. It receives this policy through dependency
 * injection and calls it before fetching any app's metadata document.
 */
export interface IMcpClientAdmissionPolicy {
    /**
     * Decide whether an app that identifies itself with this address may
     * register.
     *
     * Called before the metadata document is fetched, so a refused app causes
     * no outbound request and stores nothing. The implementation records each
     * refusal, which is how an operator learns the address a new legitimate
     * app presents.
     *
     * @param clientIdUrl - The address the app supplied as its client id. The
     *   caller chooses this text, so it must be treated as untrusted.
     * @returns True when the app may register.
     */
    isAllowed(clientIdUrl: string): boolean;

    /**
     * Record that a registered app's metadata document was read again.
     *
     * An app's owner can change its name or redirect addresses after users
     * approved it. The implementation compares the two states and reports a
     * difference, so the change does not pass unnoticed.
     *
     * @param previous - The app's details before the document was re-read.
     * @param current - The app's details afterwards.
     */
    noteRefreshed(previous: IMcpClientDetails, current: IMcpClientDetails): void;
}
