/**
 * Client-side navigation component for system monitoring pages.
 *
 * This component handles interactive behavior (active state highlighting) while
 * receiving menu items as props from the server component. Uses the same CSS
 * Module as the original SystemNav for identical theming.
 *
 * The component is designed to work with server-rendered menu data, allowing
 * menu items to be dynamically managed through the IMenuService without requiring
 * client-side fetching or hardcoded navigation arrays.
 *
 * Responsive behavior uses Priority+ navigation pattern with IntersectionObserver
 * to automatically show as many items as fit, moving overflow items to a "More"
 * dropdown based on the namespace configuration from the backend.
 *
 * @example
 * ```tsx
 * // Used by SystemNavSSR (server component)
 * <SystemNavClient items={menuItems} />
 * ```
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PriorityNav, useMenuConfig } from '../../../../modules/menu';
import styles from './SystemNav.module.css';

/**
 * Menu item structure passed from server component.
 *
 * Matches the IMenuNode structure from the backend but includes only
 * the fields needed for navigation rendering.
 */
interface IMenuItem {
    /**
     * Unique identifier for the menu item.
     */
    _id: string;

    /**
     * Display label shown in the navigation tab.
     */
    label: string;

    /**
     * Navigation URL or route path.
     * Used for Link href and active state matching.
     */
    url: string;

    /**
     * Sort order within the navigation.
     * Lower numbers appear first.
     */
    order: number;

    /**
     * Visibility flag.
     * Only enabled items are rendered.
     */
    enabled: boolean;
}

/**
 * Props for SystemNavClient component.
 */
interface ISystemNavClientProps {
    /**
     * Menu items fetched by the server component.
     * Will be sorted by order before rendering.
     */
    items: IMenuItem[];
}

/**
 * Client-side system navigation component with active state highlighting.
 *
 * Receives menu items from server component and handles interactive behavior.
 * Uses Next.js usePathname hook to highlight the active tab based on current route.
 * Maintains identical styling to the original SystemNav through shared CSS Module.
 *
 * The component sorts items by order and filters out disabled items before rendering.
 * Active state uses startsWith matching to highlight tabs for nested routes
 * (e.g., /system/pages/edit shows "Pages" tab as active).
 *
 * Responsive behavior uses Priority+ navigation with IntersectionObserver to
 * automatically detect overflow and move items to a "More" dropdown based on
 * available space and the namespace configuration.
 *
 * @param props - Component props
 * @param props.items - Menu items from server
 */
export function SystemNavClient({ items }: ISystemNavClientProps) {
    const pathname = usePathname();
    const menuConfig = useMenuConfig('system');

    // Sort by order and filter enabled items
    const visibleItems = items
        .filter(item => item.enabled)
        .sort((a, b) => a.order - b.order);

    /**
     * Renders a single navigation tab with active state highlighting.
     */
    const renderTab = (item: IMenuItem) => {
        const isActive = pathname.startsWith(item.url);
        return (
            <Link
                key={item._id}
                href={item.url}
                className={`${styles.tab} ${isActive ? styles.active : ''}`}
                aria-current={isActive ? 'page' : undefined}
            >
                {item.label}
            </Link>
        );
    };

    /**
     * Converts menu items to PriorityNav format.
     */
    const priorityNavItems = visibleItems.map(item => ({
        id: item._id,
        node: renderTab(item)
    }));

    /**
     * Wraps navigation in PriorityNav if overflow handling is enabled.
     *
     * Uses IntersectionObserver to detect which items fit and moves overflow
     * to a "More" dropdown automatically.
     */
    const overflowEnabled = menuConfig.overflow?.enabled ?? true;

    if (overflowEnabled && !menuConfig.loading) {
        return (
            <nav className={styles.nav} aria-label="System monitoring navigation">
                <PriorityNav
                    items={priorityNavItems}
                    enabled={overflowEnabled}
                    collapseAtCount={menuConfig.overflow?.collapseAtCount}
                    moreButtonLabel="More system menu items"
                />
            </nav>
        );
    }

    return (
        <nav className={`${styles.nav} ${styles['nav--wrap']}`} aria-label="System monitoring navigation">
            {visibleItems.map(item => renderTab(item))}
        </nav>
    );
}
