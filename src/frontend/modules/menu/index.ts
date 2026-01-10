/**
 * Menu module public API exports.
 *
 * Frontend module for menu navigation with Priority+ overflow handling.
 * Provides components, hooks, and types for rendering adaptive navigation
 * that automatically moves overflow items to a "More" dropdown.
 *
 * @example
 * ```tsx
 * import { PriorityNav, useMenuConfig } from '../modules/menu';
 *
 * function Navigation() {
 *     const config = useMenuConfig('main');
 *     const items = menuNodes.map(node => ({
 *         id: node._id,
 *         node: <Link href={node.url}>{node.label}</Link>
 *     }));
 *
 *     return (
 *         <PriorityNav
 *             items={items}
 *             enabled={config.overflow?.enabled}
 *             collapseAtCount={config.overflow?.collapseAtCount}
 *         />
 *     );
 * }
 * ```
 */

// Components
export { PriorityNav } from './components';
export type { IPriorityNavProps, IPriorityNavItem } from './components';

// Hooks
export { useMenuConfig, useBodyScrollLock } from './hooks';

// Types
export type { IMenuNamespaceConfig, IUseMenuConfigResult } from './types';
