/**
 * @fileoverview Host-name display helper for OAuth client ids and URIs.
 *
 * The consent screen and the connected-apps table both show an app by the
 * host of its client URI or client id. One helper keeps the two screens
 * naming the same app the same way.
 */

/**
 * Extract a host name for display, falling back to the raw value.
 *
 * A client id is often a metadata URL but can be an opaque string, so a value
 * that does not parse as a URL is shown as it is rather than hidden. The same
 * applies to a value that parses but has no host, such as a `urn:` id or a
 * private-use scheme URI, which would otherwise render as a blank label.
 *
 * @param url - A client id or client URI.
 * @returns The URL's host name, or the input when it is not a URL or has no host.
 */
export function displayHost(url: string): string {
    let host = url;
    try {
        host = new URL(url).hostname || url;
    } catch {
        host = url;
    }
    return host;
}
