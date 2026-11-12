/**
 * @file IMcpClientDetails.ts
 *
 * The details of a connected app that the app itself declares, in the form
 * the identity module hands to the MCP module when those details change.
 */

/**
 * What an app says about itself in the metadata document it publishes.
 *
 * An app that connects to the MCP endpoint identifies itself with the HTTPS
 * address of a JSON document, and the OAuth server copies the name and
 * redirect addresses from that document. The app's owner can edit the
 * document at any time, so these values can change after the app registered.
 * This shape carries only the fields worth comparing before and after such a
 * change, so the MCP module never depends on the OAuth library's own types.
 */
export interface IMcpClientDetails {
    /** The address of the app's metadata document, which is also its client id. */
    clientId: string;

    /** The name the app declares for itself, or null when it declares none. */
    name: string | null;

    /** The addresses the app may send a user back to after they approve it. */
    redirectUris: string[];
}
