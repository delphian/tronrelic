/**
 * Server-side rendering navigation component for database-driven menus.
 *
 * This component fetches menu items from the backend IMenuService during server-side
 * rendering and passes them to the client component for interactive behavior. This
 * ensures menu items are always fresh and managed through the centralized menu system
 * rather than hardcoded in the frontend.
 *
 * The fetch itself is `fetchMenuNamespace` from the menu module, which forwards the
 * visitor's cookies so MenuService.getTreeForUser can apply per-user visibility gating
 * (requiresGroups / requiresAdmin); without this the SSR pass would always render the
 * anonymous-visible subset and admins would see admin items only after a
 * post-hydration refetch. The site's main navigation no longer uses this component:
 * it is the `core:main-menu` widget, seeded by the root layout through
 * `MenuSeedProvider`.
 *
 * @example
 * ```tsx
 * <MenuNavSSR namespace="footer" ariaLabel="Footer navigation" />
 * ```
 */

import { cookies } from 'next/headers';
import { fetchMenuNamespace } from '../../../modules/menu/server';
import { MenuNavClient } from './MenuNavClient';

/**
 * Props for MenuNavSSR component.
 */
interface IMenuNavSSRProps {
    /**
     * Menu namespace to fetch (e.g., 'main', 'footer').
     * Determines which menu items are loaded from the database.
     */
    namespace: string;

    /**
     * Optional aria-label for the nav element.
     * Defaults to "{namespace} navigation".
     */
    ariaLabel?: string;
}

/**
 * Server-side navigation component.
 *
 * Fetches the namespace's tree for the current visitor during SSR and renders it
 * through the client component for interactive behavior. A failed fetch renders an
 * empty navigation rather than an error, so a menu outage never stops a page.
 *
 * @param props - Component props
 * @param props.namespace - Menu namespace to load
 * @param props.ariaLabel - Optional accessible label for navigation
 * @returns The navigation, seeded with the visitor's tree.
 */
export async function MenuNavSSR({ namespace, ariaLabel }: IMenuNavSSRProps) {
    const cookieHeader = (await cookies()).toString();
    const { roots, generatedAt } = await fetchMenuNamespace(namespace, cookieHeader);

    return (
        <MenuNavClient
            namespace={namespace}
            items={roots}
            generatedAt={generatedAt}
            ariaLabel={ariaLabel}
        />
    );
}
