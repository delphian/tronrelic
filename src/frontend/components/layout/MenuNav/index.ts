/**
 * MenuNav - Universal database-driven navigation component.
 *
 * Provides server-side rendered, namespace-based navigation that works for
 * any menu namespace (main, system, footer, etc.). All menu items are fetched
 * from the backend MenuService and can be managed through the admin interface.
 *
 * @example
 * ```tsx
 * // Main site navigation
 * import { MenuNavSSR } from '@/components/layout/MenuNav';
 * <MenuNavSSR namespace="main" />
 *
 * // System monitoring navigation
 * <MenuNavSSR namespace="system" ariaLabel="System monitoring navigation" />
 * ```
 */

export { MenuNavSSR } from './MenuNavSSR';
export { MenuNavClient } from './MenuNavClient';
