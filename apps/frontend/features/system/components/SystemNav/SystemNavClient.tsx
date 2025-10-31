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
 * Responsive behavior uses container queries to automatically switch between horizontal
 * tabs (wide containers) and hamburger menu (narrow containers) based on the namespace
 * configuration from the backend.
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
import { useMenuConfig } from '../../../../lib/hooks';
import { HamburgerMenu } from '../../../../components/layout/HamburgerMenu';
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
 * Responsive behavior uses container queries to automatically switch between horizontal
 * tabs (wide containers) and hamburger menu (narrow containers) based on the namespace
 * configuration.
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
     * Generates menu items for the hamburger menu.
     *
     * Creates simplified link elements for display in the slideout panel.
     */
    const hamburgerItems = visibleItems.map(item => (
        <Link key={item._id} href={item.url}>
            {item.label}
        </Link>
    ));

    /**
     * Renders the navigation tabs.
     *
     * Creates the full tab bar with active state highlighting.
     */
    const navContent = (
        <>
            {visibleItems.map(item => {
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
            })}
        </>
    );

    /**
     * Wraps navigation in HamburgerMenu if enabled.
     *
     * Uses container queries to automatically switch between full tabs and
     * hamburger icon based on available width.
     */
    if (menuConfig.hamburgerMenu?.enabled && !menuConfig.loading) {
        return (
            <nav className={styles.nav} aria-label="System monitoring navigation">
                <HamburgerMenu
                    triggerWidth={menuConfig.hamburgerMenu.triggerWidth}
                    items={hamburgerItems}
                >
                    {navContent}
                </HamburgerMenu>
            </nav>
        );
    }

    return (
        <nav className={styles.nav} aria-label="System monitoring navigation">
            {navContent}
        </nav>
    );
}
