/**
 * @fileoverview Turns a raw User-Agent string into a short "browser · system"
 * summary for the user detail panel, such as "Safari 19 · macOS".
 *
 * A full User-Agent runs to 120 characters or more and wrapped to three lines
 * in the panel's sessions and sign-in events, which made each row several
 * times taller than its other fields. An admin reading those rows wants to
 * know which browser and which system, so that is all the summary says; the
 * panel keeps the full string in the cell's tooltip.
 *
 * - Detection is `includes` and fixed regular expressions on a clamped string,
 *   never a pattern built from user input, because the value is written by
 *   whoever made the request.
 * - Browsers that embed another browser's token are tested first: Edge and
 *   Opera carry `Chrome/`, and Chrome carries `Safari/`.
 * - Wallet apps with an in-app browser, such as TronLink, are named as the
 *   app, because that is how a TRON user signs in from a phone.
 * - The backend has no browser parser to share; the traffic module only
 *   classifies device type and the social app a visit came through.
 */

/** Longest part of a User-Agent read, so a hostile value cannot make matching slow. */
const MAX_LENGTH = 512;

/**
 * Browsers and apps in the order they are tested. `token` is the product
 * token whose version follows a slash, and `parts` is how many dot-separated
 * version parts to show: one for browsers, whose major version is what
 * matters, and two for apps, whose major version barely changes.
 */
const BROWSERS: ReadonlyArray<{ name: string; token: string; parts: number }> = [
    { name: 'TronLink', token: 'TronLink', parts: 2 },
    { name: 'TokenPocket', token: 'TokenPocket', parts: 2 },
    { name: 'imToken', token: 'imToken', parts: 2 },
    { name: 'Edge', token: 'Edg', parts: 1 },
    { name: 'Opera', token: 'OPR', parts: 1 },
    { name: 'Samsung Internet', token: 'SamsungBrowser', parts: 1 },
    { name: 'Firefox', token: 'Firefox', parts: 1 },
    { name: 'Firefox', token: 'FxiOS', parts: 1 },
    { name: 'Chrome', token: 'CriOS', parts: 1 },
    { name: 'Chrome', token: 'Chrome', parts: 1 },
    { name: 'Safari', token: 'Version', parts: 1 }
];

/**
 * Operating systems in the order they are tested. iOS comes before macOS
 * because an iPhone's User-Agent also says "like Mac OS X", and Android
 * before Linux because Android's also says "Linux".
 */
const SYSTEMS: ReadonlyArray<{ name: string; marker: string }> = [
    { name: 'iOS', marker: 'iPhone' },
    { name: 'iPadOS', marker: 'iPad' },
    { name: 'Android', marker: 'Android' },
    { name: 'Windows', marker: 'Windows' },
    { name: 'macOS', marker: 'Mac OS X' },
    { name: 'ChromeOS', marker: 'CrOS' },
    { name: 'Linux', marker: 'Linux' }
];

/**
 * Read the version that follows a product token, such as `142` from
 * `Chrome/142.0.0.0`.
 *
 * @param userAgent - The clamped User-Agent.
 * @param token - The product token, without its slash.
 * @param parts - How many dot-separated version parts to keep.
 * @returns The version, or null when the token is absent.
 */
function versionAfter(userAgent: string, token: string, parts: number): string | null {
    const start = userAgent.indexOf(`${token}/`);
    let version: string | null = null;
    if (start !== -1) {
        const match = /^[\d.]+/.exec(userAgent.slice(start + token.length + 1));
        version = match ? match[0].split('.').filter(Boolean).slice(0, parts).join('.') : '';
    }
    return version;
}

/**
 * Name the browser or app, with its version where one can be read.
 *
 * Safari is the last browser tested and needs `Safari/` as well as
 * `Version/`, because many apps and webviews carry a `Version/` token too.
 *
 * @param userAgent - The clamped User-Agent.
 * @returns A name such as "Chrome 142", or null when none is recognised.
 */
function browserOf(userAgent: string): string | null {
    let found: string | null = null;
    for (const browser of BROWSERS) {
        const version = versionAfter(userAgent, browser.token, browser.parts);
        const isSafariMatch = browser.name !== 'Safari' || userAgent.includes('Safari/');
        if (found === null && version !== null && isSafariMatch) {
            found = version ? `${browser.name} ${version}` : browser.name;
        }
    }
    return found;
}

/**
 * Name the operating system.
 *
 * @param userAgent - The clamped User-Agent.
 * @returns A name such as "macOS", or null when none is recognised.
 */
function systemOf(userAgent: string): string | null {
    const system = SYSTEMS.find(candidate => userAgent.includes(candidate.marker));
    return system ? system.name : null;
}

/**
 * Summarise a User-Agent as the browser and the system it ran on.
 *
 * A value naming neither, such as a script's `curl/8.4.0`, is shown as its
 * first product token, so the cell still says something short and true.
 *
 * @param userAgent - The raw User-Agent header as stored, or null when the
 *        request sent none.
 * @returns A short summary such as "Safari 19 · macOS", or null when there is
 *          no User-Agent to summarise.
 */
export function summarizeUserAgent(userAgent: string | null | undefined): string | null {
    let summary: string | null = null;
    const clamped = (userAgent ?? '').slice(0, MAX_LENGTH).trim();
    if (clamped) {
        const parts = [browserOf(clamped), systemOf(clamped)].filter((part): part is string => part !== null);
        summary = parts.length > 0 ? parts.join(' · ') : clamped.split(/\s+/)[0].replace('/', ' ');
    }
    return summary;
}
