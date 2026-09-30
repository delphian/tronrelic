/**
 * @file IConnectedApp.ts
 *
 * One app a user has authorized to act on their behalf through OAuth.
 */

/**
 * A user's grant to one connected app, as their profile page and the admin
 * page show it.
 *
 * Each row is one OAuth consent: the user approved this client for these
 * scopes. Revoking it removes the consent and every refresh token the client
 * holds for that user, and the MCP endpoint refuses the client's remaining
 * access tokens on the next request.
 */
export interface IConnectedApp {
    /** OAuth client id. For apps that identify themselves by URL, this is that URL. */
    clientId: string;

    /** Name the app gives itself. Self-declared, so shown as a claim rather than a verified identity. */
    clientName: string;

    /** The app's home page, when it declares one. */
    clientUri?: string;

    /** Host names the app may send sign-in results back to. */
    redirectHosts: string[];

    /**
     * True when every redirect goes to this computer (`localhost` or a
     * loopback address). Local tools such as Claude Code do this; for any
     * other kind of app it is a warning sign, because a local program could be
     * anything.
     */
    loopbackOnly: boolean;

    /** Scopes the user granted. */
    scopes: string[];

    /** ISO 8601 time the user first approved the app. */
    grantedAt: string;

    /**
     * ISO 8601 time the app last made an authorized call to the MCP endpoint,
     * when known. Recorded at most every few minutes per grant, so it can
     * trail the real last call slightly. Absent for a grant that has not been
     * used since it was created or reconnected.
     */
    lastUsedAt?: string;
}
