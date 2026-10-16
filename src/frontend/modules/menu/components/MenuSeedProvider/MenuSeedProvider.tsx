'use client';

/**
 * @fileoverview Carries server-fetched, per-visitor menu trees to the widgets that render them.
 *
 * Menus are placed as widgets, and widget data is cached per route with
 * nothing about the visitor in the cache key. A menu differs by visitor —
 * admins see the System container in `main` — so its tree cannot travel in
 * the widget payload without showing one visitor's menu to the next. The root
 * layout fetches each visitor's tree for every namespace placed on the page
 * instead, and this provider hands each one to the widget rendering it.
 *
 * The seed is only a starting point. The navigation component copies it into
 * Redux on mount, and `menu:update` refetches keep Redux current from then on.
 *
 * @module modules/menu/components/MenuSeedProvider
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { IMenuSeed } from '../../types';

/** Seeds keyed by menu namespace. */
type MenuSeeds = Readonly<Record<string, IMenuSeed>>;

/** Context holding the seeds; empty outside a provider. */
const MenuSeedContext = createContext<MenuSeeds>({});

/**
 * Props for {@link MenuSeedProvider}.
 */
interface IMenuSeedProviderProps {
    /** Server-fetched trees keyed by namespace, such as `{ main: … }`. */
    seeds: MenuSeeds;
    /** The subtree that may read the seeds. */
    children: ReactNode;
}

/**
 * Provide server-fetched menu trees to the components below.
 *
 * @param props - The seeds and the subtree that reads them.
 * @returns The children, wrapped in the seed context.
 */
export function MenuSeedProvider({ seeds, children }: IMenuSeedProviderProps) {
    return <MenuSeedContext.Provider value={seeds}>{children}</MenuSeedContext.Provider>;
}

/**
 * Read the server-fetched tree for one namespace.
 *
 * @param namespace - The menu namespace to read, such as `main`.
 * @returns The seed, or null when the layout did not fetch that namespace,
 *   so the caller can render an empty tree and fetch it in the browser
 *   rather than mistake an unfetched menu for one with no items.
 */
export function useMenuSeed(namespace: string): IMenuSeed | null {
    const seeds = useContext(MenuSeedContext);
    return seeds[namespace] ?? null;
}
