import type { IMenuNode, IMenuNodeWithChildren } from './IMenuNode.js';

/**
 * Menu tree structure returned by getTree() method.
 *
 * Represents the complete hierarchical menu with all nodes organized by
 * parent-child relationships. The frontend uses this to render navigation.
 */
export interface IMenuTree {
    /**
     * Root-level nodes (parent is null or undefined).
     * Each node may contain children forming the complete tree.
     */
    roots: IMenuNodeWithChildren[];

    /**
     * Flat array of all nodes for quick lookups.
     * Useful for searching or mapping IDs to nodes.
     */
    all: IMenuNode[];

    /**
     * Timestamp when the tree was generated.
     * Used by frontend to detect stale cached data.
     */
    generatedAt: Date;
}
