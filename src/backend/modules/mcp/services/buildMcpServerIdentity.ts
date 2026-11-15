/**
 * @fileoverview Builds the MCP server's self-description from the site origin.
 *
 * One Docker image serves several domains, so nothing here names a domain:
 * every URL and the reverse-DNS name come from the origin the public endpoint
 * is served under.
 */

import type { IMcpServerIdentity } from './IMcpServerIdentity.js';

/** Version reported to clients and in the Server Card; bump when the served surface changes shape. */
export const MCP_SERVER_VERSION = '1.2.0';

/** Longest description the Server Card schema accepts. */
const MAX_DESCRIPTION_LENGTH = 100;

/**
 * The server's description, written to fit the card's 100-character limit. It
 * names what the anonymous group is granted today and that an account adds
 * more, so change it when those grants change in kind. The official MCP
 * Registry listing (`server.json`, kept in the ops repository) carries the same
 * sentence, so change the two together.
 */
const DESCRIPTION = 'TRON energy rental prices and market activity from TronRelic. Free account unlocks more tools.';

/**
 * The anonymous tools {@link DESCRIPTION} was written for.
 *
 * An admin changes the anonymous grants on `/system/mcp` at any time, and
 * nothing in the sentence changes with them. `/system/mcp` compares this list
 * with the tools the `anonymous` group is served now and warns when they
 * differ. When a warning appears, rewrite the sentence for the new grants,
 * update this list to match, bump {@link MCP_SERVER_VERSION}, and republish
 * the MCP Registry listing with the same sentence and version.
 */
export const DESCRIBED_ANONYMOUS_TOOLS: readonly string[] = ['resource-markets-get-activity', 'resource-markets-get-prices'];

/**
 * The page explaining how to connect an AI client. Every installation creates
 * it, so the path is safe to report on any domain.
 */
const DOCS_PATH = '/p/mcp';

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
        websiteUrl: `${origin}${DOCS_PATH}`,
        siteUrl: origin,
        icons: [{ src: `${origin}${ICON_PATH}`, mimeType: 'image/png', sizes: ['192x192'] }],
        termsUrl: `${origin}/terms`,
        privacyUrl: `${origin}/privacy`
    };
}
