/**
 * @fileoverview The server-rendered starting tree for one menu namespace.
 */

import type { MenuNodeSerialized } from '@/shared';

/**
 * One namespace's menu tree as the server fetched it for the current
 * visitor. The navigation component seeds Redux from it on mount, after
 * which `menu:update` refetches keep it current.
 */
export interface IMenuSeed {
    /** The namespace's root nodes, already filtered to what this visitor may see. */
    roots: MenuNodeSerialized[];
    /** When the backend produced the tree, recorded on the Redux namespace state. */
    generatedAt: string;
}
