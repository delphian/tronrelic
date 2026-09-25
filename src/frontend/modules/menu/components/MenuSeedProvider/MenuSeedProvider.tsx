'use client';

/**
 * @fileoverview Carries server-fetched, per-visitor menu trees to the widgets that render them.
 *
 * The main menu is a widget, and widget data is cached per route with
 * nothing about the visitor in the cache key. The main menu differs by
 * visitor — admins see the System container — so its tree cannot travel in
 * the widget payload without showing one visitor's menu to the next. The root
 * layout fetches each visitor's tree on every request instead, and this
 * provider hands it to whichever widget renders that namespace.
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
 * @returns The seed, or an empty tree when the layout did not fetch that
 *   namespace, so the navigation still renders and fills in on the next
 *   `menu:update`.
 */
export function useMenuSeed(namespace: string): IMenuSeed {
    const seeds = useContext(MenuSeedContext);
    return seeds[namespace] ?? EMPTY_SEED;
}

/**
 * Seed used when a namespace was not fetched. Module-level so its identity is
 * stable across renders.
 */
const EMPTY_SEED: IMenuSeed = { roots: [], generatedAt: new Date(0).toISOString() };
