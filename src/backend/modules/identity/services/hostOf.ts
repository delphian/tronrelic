/**
 * @fileoverview Host-name helpers for OAuth redirect URIs.
 *
 * The consent screen and the connected-apps list both show where an app sends
 * its sign-in result, and both flag an app that only sends it to this
 * computer. Keeping the parsing and the loopback list in one place means the
 * two screens cannot disagree about which app counts as local.
 */

/** Host names that mean "this computer", as `URL.hostname` reports them. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Extract the host name from a URL, so a screen can say where an app sends
 * its sign-in result.
 *
 * A native app may register a private-use scheme redirect such as
 * `com.example.app:/callback` (RFC 8252), which parses as a valid URL with an
 * empty host name. Returning that empty string would make the consent screen
 * reject a legitimate redirect as invalid, so the scheme is returned instead,
 * because it is the part of such a URI that names the receiving app.
 *
 * @param url - A URL string, such as a registered redirect URI.
 * @returns The host name, the scheme when the URL has no host, or null when
 *   the string is empty or not a URL, so a malformed stored value can be
 *   skipped rather than failing the caller.
 */
export function hostOf(url: string): string | null {
    let host: string | null = null;
    try {
        const parsed = url ? new URL(url) : null;
        host = parsed ? parsed.hostname || parsed.protocol.replace(/:$/, '') || null : null;
    } catch {
        host = null;
    }
    return host;
}

/**
 * Whether a host name refers to this computer.
 *
 * Local tools such as Claude Code receive their sign-in result on a loopback
 * address, and the screens point that out so the user knows the result does
 * not leave the machine.
 *
 * @param host - A host name as returned by {@link hostOf}.
 * @returns True for a loopback host.
 */
export function isLoopbackHost(host: string): boolean {
    return LOOPBACK_HOSTS.has(host);
}
