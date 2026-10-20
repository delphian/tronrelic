/**
 * @fileoverview Builds the per-request Content-Security-Policy for site pages.
 *
 * A Content-Security-Policy tells the browser which sources a page may load
 * scripts, styles, images, and connections from. Its main job here is
 * `script-src`: an attacker who manages to inject markup into a page cannot run
 * a script, because only scripts carrying this request's nonce are allowed.
 *
 * The middleware sends this policy as `Content-Security-Policy-Report-Only`
 * while it is being rolled out, so the browser reports what it would block
 * without blocking it. The enforcing baseline in `next.config.mjs`
 * (`object-src`, `base-uri`, `frame-ancestors`) is a separate header and stays
 * in force alongside it.
 */

/**
 * Hosts the Google Ads tag sends conversion data to. The consent module loads
 * the tag only for a visitor who allowed advertising cookies, but the policy
 * is the same for every page so it does not depend on that visitor's choice.
 * The list follows Google's published Content-Security-Policy guidance for the
 * Google tag with Google Ads conversion tracking.
 */
const GOOGLE_ADS_CONNECT_SOURCES = [
    'https://www.googletagmanager.com',
    'https://www.google.com',
    'https://google.com',
    'https://www.googleadservices.com',
    'https://googleads.g.doubleclick.net',
    'https://pagead2.googlesyndication.com'
];

/** Frames the Google Ads tag may open to record a conversion. */
const GOOGLE_ADS_FRAME_SOURCES = ['https://td.doubleclick.net', 'https://www.googletagmanager.com'];

/**
 * Build the policy for one page request.
 *
 * `script-src` allows scripts carrying the nonce, plus `'strict-dynamic'`, which
 * lets a trusted script load further scripts. That is how the Next.js chunks
 * and Cloudflare's bot-detection script load, since both are added by scripts
 * that already carry the nonce. Browsers that understand `'strict-dynamic'`
 * ignore `'self'`, which is kept only for older browsers.
 *
 * `style-src` keeps `'unsafe-inline'` because the site renders hundreds of
 * `style` attributes and plugin-contributed `<style>` blocks, and a nonce cannot
 * cover a `style` attribute. Style injection is far less dangerous than script
 * injection, so this is the usual trade-off.
 *
 * `img-src` allows any HTTPS image because token logos, market logos, and
 * sign-in avatars come from hosts the site does not control.
 *
 * `connect-src` and `frame-src` also allow the Google Ads hosts above. The tag
 * script itself needs no `script-src` entry, because the consent module adds
 * it from a script that already carries the nonce, which `'strict-dynamic'`
 * trusts.
 *
 * In development, Next.js needs `'unsafe-eval'` for fast refresh, and the
 * browser talks to the backend on a different local port, so those are
 * allowed only when `isDevelopment` is true.
 *
 * @param nonce - The base64 nonce generated for this request; the same value
 *   must be stamped on every inline script the page writes.
 * @param isDevelopment - True under `next dev`, which needs eval and a
 *   cross-port backend connection that production must not allow.
 * @returns The policy as a single header value.
 */
export function buildContentSecurityPolicy(nonce: string, isDevelopment: boolean): string {
    const scriptSources = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
    const connectSources = ["'self'", ...GOOGLE_ADS_CONNECT_SOURCES];
    if (isDevelopment) {
        scriptSources.push("'unsafe-eval'");
        connectSources.push('http://localhost:*', 'ws://localhost:*');
    }

    const directives = [
        "default-src 'self'",
        `script-src ${scriptSources.join(' ')}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        `connect-src ${connectSources.join(' ')}`,
        `frame-src 'self' ${GOOGLE_ADS_FRAME_SOURCES.join(' ')}`,
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'"
    ];

    return directives.join('; ');
}
