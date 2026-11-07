'use client';

/**
 * SiteLink — a link to another page of the site that navigates without a full
 * page load where it is safe to.
 *
 * Published to plugins as `context.ui.Link`. Plugins rendered plain `<a href>`
 * links because the plugin context offered nothing else, so every click inside
 * a plugin reloaded the whole site: the HTML, the JavaScript start-up, the
 * WebSocket connection, and on a translated page the translation catalog.
 * Core's menus already navigate with `next/link`; this gives plugins the same,
 * with two rules core decides once instead of each plugin deciding them.
 *
 * Prefetching is off by default. A page such as the blog archive renders
 * thousands of links, and prefetching each as it scrolls into view would send
 * bursts the frontend's per-visitor prefetch rate limit refuses.
 *
 * A link that leaves the site, or whose target is in a different language from
 * the current page, renders as a plain `<a>`. Changing language changes the
 * `[lang]` route segment, which needs a full page load so `<html lang>`, the
 * catalog, and the navigation switch together — the reason the language
 * switcher uses plain links too. `canNavigateInPage` in `@/types` holds that
 * rule.
 *
 * The href is rendered as given. Callers localize it first with
 * `useLocalizedHref()`; the component does not, because localizing an address
 * that already carries a language prefix can double it.
 *
 * @module components/ui/SiteLink
 */

import NextLink from 'next/link';
import type { ILinkProps } from '@/types';
import { canNavigateInPage } from '@/types';
import { useLocalization } from '../../../modules/localization';

/**
 * Render a link that uses in-page navigation when it stays on the site and in
 * the current language, and a plain anchor otherwise.
 *
 * @param props - The anchor attributes to render, plus `href` and `prefetch`.
 * @param props.href - Destination, already localized for the current page.
 * @param props.prefetch - Whether to fetch the target before it is clicked. Off unless set.
 * @param props.children - Link content.
 * @returns A Next.js link or a plain anchor carrying the same attributes.
 */
export function SiteLink({ href, prefetch = false, children, ...anchorProps }: ILinkProps) {
    const { language, config } = useLocalization();
    const element = canNavigateInPage(href, language, config)
        ? <NextLink href={href} prefetch={prefetch} {...anchorProps}>{children}</NextLink>
        : <a href={href} {...anchorProps}>{children}</a>;
    return element;
}
