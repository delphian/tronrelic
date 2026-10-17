/**
 * @fileoverview Decides whether a menu link points at the page being viewed.
 *
 * @module modules/menu/lib/isMenuPathActive
 */

/**
 * Report whether a menu link should be marked as the current page.
 *
 * A link to a section stays marked on the pages beneath it, so the Markets
 * tab stays highlighted on `/markets/btc`. The home link is the exception:
 * every path starts with `/`, so home matches only itself. The segment check
 * (`href + '/'`) stops `/markets` from also marking `/markets-archive`.
 *
 * @param pathname - The current path from the address bar, including any
 *   language prefix, because the caller compares it with a localized link.
 * @param href - The link target after localization, as rendered in `href`.
 * @param isHome - Whether the item's stored URL is `/`, which a localized
 *   home link (such as `/zh`) no longer shows on its own.
 * @returns True when the link should carry `aria-current="page"` and the active style.
 */
export function isMenuPathActive(pathname: string, href: string, isHome: boolean): boolean {
    return isHome ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}
