/**
 * @fileoverview Countries whose visitors must give consent before
 * non-essential cookies are set.
 *
 * EU and UK cookie law requires opt-in consent for analytics and advertising
 * cookies, Switzerland expects the same, and Google's EU user consent policy
 * covers exactly the EEA, the UK, and Switzerland. Visitors elsewhere see no
 * banner. The list is fixed in code rather than editable on the admin page,
 * so a mistyped setting cannot quietly drop a country out of scope.
 */

/**
 * ISO 3166-1 alpha-2 codes, as Cloudflare sends them in `cf-ipcountry`:
 * the 27 EU members, the rest of the EEA (Iceland, Liechtenstein, Norway),
 * the United Kingdom, and Switzerland. EU territories that have their own
 * code — Åland and the French outermost regions — are included because EU
 * law applies there in full.
 */
export const CONSENT_REGION_COUNTRIES: ReadonlySet<string> = new Set([
    // EU member states
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
    'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
    // EU territories with their own country code
    'AX', 'GF', 'GP', 'MQ', 'RE', 'YT', 'MF',
    // Rest of the EEA
    'IS', 'LI', 'NO',
    // United Kingdom and Switzerland
    'GB', 'CH'
]);
