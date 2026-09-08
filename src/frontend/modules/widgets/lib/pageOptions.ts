/**
 * @fileoverview Builds the page picker's option list.
 *
 * Operators previously had to type a URL from memory before they could see
 * a page's widgets. The picker now offers the site's real pages, taken from
 * the navigation menu, so choosing a page is a click. Route patterns that
 * placements already target are listed too, because a widget scoped to
 * `/tools/*` is only reachable through that pattern, and any path the
 * operator types during the session stays selectable until they leave.
 *
 * @module modules/widgets/lib/pageOptions
 */

import type { MenuNodeSerialized } from '@/shared';
import type { IWidgetPlacement } from '@/types';
import type { IPageOption } from '../types/IPageOption';

/**
 * Walk the navigation tree and collect every node that links to a page on
 * this site. Admin pages under `/system` are excluded because no widget
 * zone renders there, so listing them would only offer pages the editor
 * cannot affect. External links and container nodes without a URL are
 * skipped for the same reason.
 *
 * @param roots - Root nodes of the `main` menu namespace.
 * @returns Page options in menu order, deduplicated by path.
 */
export function pageOptionsFromMenu(roots: ReadonlyArray<MenuNodeSerialized>): IPageOption[] {
    const seen = new Set<string>();
    const options: IPageOption[] = [];

    /**
     * Visit one node and its children, appending each linkable page.
     *
     * @param node - The node to visit.
     */
    const visit = (node: MenuNodeSerialized): void => {
        const url = node.url;
        const isInternal = typeof url === 'string' && url.startsWith('/') && !url.startsWith('//');
        const isAdmin = typeof url === 'string' && (url === '/system' || url.startsWith('/system/'));
        if (isInternal && !isAdmin && !seen.has(url)) {
            seen.add(url);
            options.push({ value: url, label: node.label || url, source: 'menu' });
        }
        for (const child of node.children ?? []) {
            visit(child);
        }
    };

    for (const root of roots) {
        visit(root);
    }
    return options;
}

/**
 * Merge the three option sources into one list for the picker. Menu pages
 * come first in their own order; route patterns and custom paths follow,
 * each sorted so the dropdown is stable between renders. A path present in
 * more than one source keeps its first, most descriptive entry.
 *
 * @param menuPages - Pages from the navigation menu.
 * @param placements - Every placement, whose route filters supply the patterns.
 * @param customPaths - Paths the operator typed this session.
 * @returns The combined option list.
 */
export function buildPageOptions(
    menuPages: ReadonlyArray<IPageOption>,
    placements: ReadonlyArray<IWidgetPlacement>,
    customPaths: ReadonlyArray<string>
): IPageOption[] {
    const seen = new Set(menuPages.map(page => page.value));
    const options: IPageOption[] = [...menuPages];

    const patterns = new Set<string>();
    for (const placement of placements) {
        for (const route of placement.routes) {
            if (!seen.has(route)) patterns.add(route);
        }
    }
    for (const pattern of Array.from(patterns).sort((a, b) => a.localeCompare(b))) {
        seen.add(pattern);
        options.push({ value: pattern, label: pattern, source: 'pattern' });
    }

    for (const path of Array.from(customPaths).sort((a, b) => a.localeCompare(b))) {
        if (!seen.has(path)) {
            seen.add(path);
            options.push({ value: path, label: path, source: 'custom' });
        }
    }

    return options;
}
