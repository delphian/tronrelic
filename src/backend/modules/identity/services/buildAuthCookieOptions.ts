/**
 * @fileoverview The cookie settings the identity module states explicitly on
 * Better Auth, so they do not depend on the library's defaults.
 *
 * Why `SameSite=Lax` matters here:
 * - The origin check in `config/cors.ts` lets a request with no `Origin`
 *   header through, because non-browser callers never send one.
 * - A browser also sends no `Origin` header on a GET that another website
 *   triggers, such as an image, a script tag, or a link.
 * - `SameSite=Lax` is what keeps the session cookie off the image and script
 *   requests, and off every cross-site write.
 *
 * Better Auth already defaults every cookie to `lax`. Stating the value here
 * means a library upgrade that changes the default does not change the site.
 */
import type { BetterAuthAdvancedOptions } from 'better-auth';

/**
 * Build the `advanced` cookie options passed to Better Auth.
 *
 * The value is set through `defaultCookieAttributes`, which Better Auth
 * applies to every cookie it creates: the session cookie, the cached session
 * and account cookies, and the short-lived cookies used during social sign-in.
 * A function rather than a constant so the test builds the same options
 * `createAuth` does and asks Better Auth what attributes they resolve to.
 *
 * @returns The options to pass as `advanced`, which `createAuth` needs to fix
 *   the cookie attributes on the auth instance.
 */
export function buildAuthCookieOptions(): Pick<BetterAuthAdvancedOptions, 'defaultCookieAttributes'> {
    return { defaultCookieAttributes: { sameSite: 'lax' } };
}
