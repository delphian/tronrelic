/**
 * @file IOAuthConsentContext.ts
 *
 * What the `/oauth/authorize` page shows before a user approves an app.
 */

/**
 * The details a user needs to decide whether to let an app act for them.
 *
 * The app's name is its own claim and can be anything, so the page also shows
 * where sign-in results will be sent (the redirect host), which the app cannot
 * fake once Better Auth has matched it against the app's registration.
 */
export interface IOAuthConsentContext {
    /** OAuth client id; for apps that identify themselves by URL, that URL. */
    clientId: string;

    /** Name the app gives itself. */
    clientName: string;

    /** The app's home page, when it declares one. */
    clientUri?: string;

    /** Host the authorization result will be sent to. */
    redirectHost: string;

    /** True when the result goes to this computer, which is expected only for local tools. */
    loopbackOnly: boolean;

    /** Requested scopes, each with a plain-language description. */
    scopes: Array<{ scope: string; label: string }>;

    /** Whether the signed-in user is allowed to connect apps at all. */
    permitted: boolean;
}
