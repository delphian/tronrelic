/**
 * @fileoverview How the MCP server describes itself, in the opening handshake
 * and in its Server Card.
 *
 * Clients show these values in their connector lists, and registries index the
 * card. Both places must say the same thing, so one value built at startup
 * feeds both.
 */

/** One icon a client may show beside the server. */
export interface IMcpServerIcon {
    /** Absolute HTTPS URL of the image. */
    src: string;

    /** The image's media type, such as `image/png`. */
    mimeType: string;

    /** Pixel sizes the image provides, as `WxH` strings. */
    sizes: string[];
}

/** The server's name, description, site, and icon. */
export interface IMcpServerIdentity {
    /**
     * Reverse-DNS name of the site plus `/mcp`, such as `com.tronrelic/mcp`.
     * The Server Card requires this form, and the official MCP Registry uses
     * the same namespace rule.
     */
    name: string;

    /** Display name. */
    title: string;

    /** Version reported to clients; bump when the served surface changes shape. */
    version: string;

    /** One sentence, at most 100 characters, saying what the public server offers. */
    description: string;

    /**
     * Where a person reads about the server and how to connect to it: the
     * `/p/mcp` docs page. Reported as `websiteUrl` in the handshake and the
     * Server Card, which clients and registries show as the server's link.
     */
    websiteUrl: string;

    /**
     * The site's origin, such as `https://tronrelic.com`. Used where the site
     * itself is meant rather than the docs page: naming the site in the
     * instructions and naming the publisher in the AI Catalog.
     */
    siteUrl: string;

    /** Icons for client connector lists. */
    icons: IMcpServerIcon[];

    /** The site's terms of use. */
    termsUrl: string;

    /** The site's privacy policy. */
    privacyUrl: string;
}
