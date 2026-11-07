/**
 * Published props contract for the `Link` component exposed to plugins on
 * `context.ui.Link`.
 *
 * Declared here rather than beside the component so core and plugins share one
 * copy of the shape. It deliberately does not reference `next/link`: this
 * package may import React types and nothing else, so the props are built on
 * React's own anchor attributes.
 */
import type { AnchorHTMLAttributes, ReactNode } from 'react';

/**
 * The `Link` component published to plugins.
 *
 * A plain `<a href>` makes every click load a whole new page: the browser
 * downloads the full HTML again, re-runs the JavaScript, reconnects the
 * WebSocket, and re-sends the translation catalog on a translated page. This
 * component navigates between pages without that reload where it is safe to,
 * the way core's own menus already do, and falls back to a plain `<a>` where
 * it is not.
 *
 * It falls back to a plain `<a>` for any link that leaves the site, and for
 * any link whose target is in a different language from the current page,
 * because changing language needs a full page load (see `canNavigateInPage`).
 * Use it for links to other pages of the site. Leave links to files, feeds,
 * and API routes as plain `<a>` elements, since those are not pages.
 *
 * **Pass an href that is already localized.** The component does not add the
 * language prefix, because running `localizeHref` on an address that already
 * carries one can produce `/zh/zh/...` when a broad route pattern is
 * published. Build the href with `context.useLocalizedHref()` first, exactly
 * as for a plain anchor. A link that skips that step still works, but takes a
 * visitor on a translated page back to English.
 */
export interface ILinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
    /** Destination of the link, already localized for the current page. */
    href: string;

    /** Link content. */
    children?: ReactNode;

    /**
     * Fetch the target page in the background before the link is clicked.
     * Defaults to `false`. A page such as the blog archive can render
     * thousands of links, and prefetching each one as it scrolls into view
     * sends a burst of requests that the server's per-visitor rate limit
     * refuses. Turn it on only for a small number of links a visitor is
     * likely to follow.
     */
    prefetch?: boolean;
}
