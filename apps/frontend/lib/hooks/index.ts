/**
 * Shared hooks for cross-cutting concerns.
 *
 * These hooks provide functionality used across multiple features and components.
 * Feature-specific hooks should live in their respective feature directories.
 *
 * Note: useMenuConfig has been moved to modules/menu/. Re-exported here for
 * backward compatibility but prefer importing from modules/menu directly.
 */

// Re-export from menu module for backward compatibility
export { useMenuConfig } from '../../modules/menu';
export type { IMenuNamespaceConfig } from '../../modules/menu';
