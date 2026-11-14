/**
 * @fileoverview Builds the MCP server's self-description from the site origin.
 *
 * One Docker image serves several domains, so nothing here names a domain:
 * every URL and the reverse-DNS name come from the origin the public endpoint
 * is served under.
 */

import type { IMcpServerIdentity } from './IMcpServerIdentity.js';

/** Version reported to clients and in the Server Card; bump when the served surface changes shape. */
export const MCP_SERVER_VERSION = '1.1.0';

/** Longest description the Server Card schema accepts. */
const MAX_DESCRIPTION_LENGTH = 100;

/**
 * The public server's description, written to fit the card's 100-character
 * limit. It names what the anonymous group is granted today, so change it when
 * those grants change in kind.
 */
const DESCRIPTION = 'TRON energy rental prices and market activity from TronRelic. Read-only, no sign-in.';

/**
 * The site icon. Next.js serves `app/icon.png` at this path on every domain;
 * it is a 192-pixel PNG, a format every MCP client must support.
 */
const ICON_PATH = '/icon.png';

/**
 * Build the server identity for a site.
 *
 * @param siteOrigin - The origin the endpoints are served under, such as
 *   `https://tronrelic.com`. Its host gives the reverse-DNS name.
 * @returns The identity the handshake and the Server Card both report.
 * @throws {Error} When the description no longer fits the card's limit, so the
 *   mistake surfaces at startup rather than as a card registries reject.
 */
export function buildMcpServerIdentity(siteOrigin: string): IMcpServerIdentity {
    if (DESCRIPTION.length > MAX_DESCRIPTION_LENGTH) {
        throw new Error(`MCP server description is ${DESCRIPTION.length} characters; the Server Card allows ${MAX_DESCRIPTION_LENGTH}.`);
    }
    const origin = new URL(siteOrigin).origin;
    const namespace = new URL(origin).hostname.split('.').reverse().join('.');

    return {
        name: `${namespace}/mcp`,
        title: 'TronRelic',
        version: MCP_SERVER_VERSION,
        description: DESCRIPTION,
        websiteUrl: origin,
        icons: [{ src: `${origin}${ICON_PATH}`, mimeType: 'image/png', sizes: ['192x192'] }],
        termsUrl: `${origin}/terms`,
        privacyUrl: `${origin}/privacy`
    };
}
