'use client';

/**
 * @fileoverview Keep a zone's widget bundle in step with the page the visitor is on.
 *
 * The `(core)` route-group layout renders the `main-before` and `main-after`
 * zones for every page under it, such as `/tools`, `/account`, and `/system`.
 * Next.js does not render a layout again when a visitor moves between two of
 * its pages without a full reload, so widgets fetched on the server for the
 * first page stayed on screen after a menu click took the visitor to the
 * next: a visitor who opened `/account` and then clicked Tools saw no
 * language switcher above the tools list until they reloaded.
 *
 * This hook starts from the bundle the server rendered and, whenever the
 * current path no longer matches the path that bundle was resolved for,
 * fetches the bundle for the new path from the public widgets endpoint. The
 * menu widget follows the same pattern when its tree was not seeded by the
 * layout.
 *
 * @module frontend/components/widgets/useRouteWidgets
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { resolveLocalizedPath } from '@/types';
import type { IWidgetBundle } from './fetchWidgetsForRoute';
import { widgetsRequestPath } from './widgetsRequestPath';
import { getRuntimeConfig } from '../../lib/runtimeConfig';
// Imported directly rather than through the localization module's barrel:
// this hook runs inside the layout on every core page, and the barrel also
// exports the admin tabs, whose styles would join the layout bundle.
import { useLocalization } from '../../modules/localization/hooks/useLocalization';

/** A widget bundle together with the page path it was resolved for. */
export interface IRouteWidgetBundle extends IWidgetBundle {
    /** Page path with any language prefix removed, matching the server's `x-pathname`. */
    route: string;
}

/**
 * Return the widget bundle for the page currently shown, refetching it after
 * an in-page navigation.
 *
 * The path is compared with the language prefix removed, using the same
 * `resolveLocalizedPath` rule the middleware applies to set `x-pathname`, so
 * the first render matches the server's bundle and fetches nothing. A
 * response that arrives after the visitor has moved on is discarded, and a
 * failed request leaves the zones empty, as a failed server fetch does,
 * rather than showing the previous page's widgets.
 *
 * When the parent renders again with a new server bundle, such as a page
 * that renders these zones itself, that bundle replaces the current one.
 *
 * @param initial - The bundle the server resolved, with the path it resolved it for.
 * @returns The bundle for the page currently shown.
 */
export function useRouteWidgets(initial: IRouteWidgetBundle): IRouteWidgetBundle {
    const pathname = usePathname() ?? '/';
    const { language, config } = useLocalization();
    const route = resolveLocalizedPath(pathname, config).path;
    const [current, setCurrent] = useState<IRouteWidgetBundle>(initial);
    const [seededFrom, setSeededFrom] = useState<IRouteWidgetBundle>(initial);

    // A new server bundle replaces whatever the browser fetched. Adjusting
    // state during render, rather than in an effect, avoids one render with
    // the old bundle.
    if (initial !== seededFrom) {
        setSeededFrom(initial);
        setCurrent(initial);
    }

    useEffect(() => {
        const controller = new AbortController();

        /**
         * Fetch the bundle for the current path and store it, unless the
         * visitor has already moved on.
         *
         * @returns Resolves once the bundle is stored or the request is abandoned.
         */
        const load = async (): Promise<void> => {
            let next: IRouteWidgetBundle = { route, widgets: [], zones: {} };
            try {
                const { apiUrl } = getRuntimeConfig();
                const response = await fetch(`${apiUrl}${widgetsRequestPath(route, {}, language)}`, { signal: controller.signal });
                if (response.ok) {
                    const data = await response.json();
                    next = { route, widgets: data.widgets ?? [], zones: data.zones ?? {} };
                } else {
                    console.error('Failed to fetch widgets:', response.status);
                }
            } catch (error) {
                if (!controller.signal.aborted) {
                    console.error('Error fetching widgets:', error);
                }
            }
            if (!controller.signal.aborted) {
                setCurrent(next);
            }
        };

        if (route !== current.route) {
            void load();
        }

        return () => controller.abort();
    }, [route, language, current.route]);

    return current;
}
