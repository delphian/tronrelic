'use client';

/**
 * @fileoverview Reads one menu namespace's tree, starting from the server seed.
 *
 * A menu tree is filtered per visitor, so it never travels in widget data.
 * The root layout fetches each visitor's tree for every namespace a widget on
 * the page names and passes them down through `MenuSeedProvider`. Any widget
 * that renders a menu then needs the same three steps: start from that seed so
 * the server HTML and the first client render match, switch to the Redux copy
 * once `menu:update` refetches have filled it, and fetch the tree in the
 * browser when the layout never seeded it. This hook holds those steps in one
 * place so the menu widget and the tab bar cannot drift apart.
 *
 * @module modules/menu/hooks/useMenuTree
 */

import { useEffect } from 'react';
import { useMenuSeed } from '../components/MenuSeedProvider';
import { refetchMenuTree } from '../slice';
import type { IMenuSeed } from '../types';
import { useAppDispatch, useAppSelector } from '../../../store/hooks';

/**
 * Tree returned when nothing has loaded yet. Module-level so its identity is
 * stable across renders and memoized consumers do not recompute.
 */
const EMPTY_TREE: IMenuSeed = { roots: [], generatedAt: new Date(0).toISOString() };

/**
 * Read the visitor's tree for one menu namespace.
 *
 * The live Redux copy wins once it holds a tree, because SocketBridge
 * refetches it on every `menu:update`. Until then the server seed is used,
 * which is what keeps hydration clean: Redux is empty during server rendering
 * and on the first client render, so both of those render from the seed.
 *
 * @param namespace - The menu namespace to read, such as `main`.
 * @returns The tree's root items and the time the seed was generated, which
 *   `MenuNavClient` records when it copies the seed into Redux.
 */
export function useMenuTree(namespace: string): IMenuSeed {
    const seed = useMenuSeed(namespace);
    const liveRoots = useAppSelector(state => state.menu.namespaces[namespace]?.roots);
    const loadedInRedux = useAppSelector(state => state.menu.namespaces[namespace]?.lastUpdated !== undefined);
    const dispatch = useAppDispatch();

    /**
     * Fetch the tree in the browser when the root layout did not seed it.
     *
     * The root layout seeds every namespace placed on the page it rendered,
     * but Next.js does not render the root layout again on a client-side
     * navigation. A menu placed only on the page navigated to therefore has
     * no seed, and would otherwise stay empty until the next `menu:update`.
     * The check uses the values from the render that scheduled the effect, so
     * an empty tree a navigation component writes to Redux on mount does not
     * count as loaded; once the fetched tree arrives, a re-run does nothing.
     */
    useEffect(() => {
        if (seed === null && !loadedInRedux) {
            void dispatch(refetchMenuTree({ namespace, timestamp: new Date().toISOString() }));
        }
    }, [seed, loadedInRedux, namespace, dispatch]);

    const base = seed ?? EMPTY_TREE;
    const tree: IMenuSeed = liveRoots ? { roots: liveRoots, generatedAt: base.generatedAt } : base;

    return tree;
}
