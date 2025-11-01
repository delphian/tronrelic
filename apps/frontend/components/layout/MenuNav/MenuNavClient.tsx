/**
 * Client-side navigation component for database-driven menus.
 *
 * This component handles interactive behavior (active state highlighting) while
 * receiving menu items as props from the server component. Uses CSS Module for
 * consistent theming across all navigation instances.
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
 * // Main navigation
 * <MenuNavClient namespace="main" items={menuItems} ariaLabel="Main navigation" />
 *
 * // System navigation
 * <MenuNavClient namespace="system" items={menuItems} ariaLabel="System monitoring navigation" />
 * ```
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMenuConfig } from '../../../lib/hooks';
import { HamburgerMenu } from '../HamburgerMenu';
import { ChevronDown, ChevronRight } from 'lucide-react';
import styles from './MenuNav.module.css';

/**
 * Menu item structure passed from server component.
 *
 * Matches the IMenuNode structure from the backend but includes only
 * the fields needed for navigation rendering. Supports hierarchical
 * menus with expandable categories.
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
     * Optional for container/category nodes that don't navigate.
     */
    url?: string;

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

    /**
     * Child menu items for hierarchical navigation.
     * Container nodes can have children that appear in expandable sections.
     */
    children?: IMenuItem[];
}

/**
 * Props for MenuNavClient component.
 */
interface IMenuNavClientProps {
    /**
     * Menu namespace (e.g., 'main', 'system', 'footer').
     * Used to fetch namespace-specific configuration.
     */
    namespace: string;

    /**
     * Menu items fetched by the server component.
     * Will be sorted by order before rendering.
     */
    items: IMenuItem[];

    /**
     * Optional aria-label for the nav element.
     * Defaults to "{namespace} navigation".
     */
    ariaLabel?: string;
}

/**
 * Client-side navigation component with active state highlighting.
 *
 * Receives menu items from server component and handles interactive behavior.
 * Uses Next.js usePathname hook to highlight the active tab based on current route.
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
 * @param props.namespace - Menu namespace for config lookup
 * @param props.items - Menu items from server
 * @param props.ariaLabel - Optional accessible label
 */
export function MenuNavClient({ namespace, items, ariaLabel }: IMenuNavClientProps) {
    const pathname = usePathname();
    const menuConfig = useMenuConfig(namespace);
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

    // Sort by order and filter enabled items
    const visibleItems = items
        .filter(item => item.enabled)
        .sort((a, b) => a.order - b.order);

    /**
     * Toggles a category's expanded state.
     */
    const toggleCategory = (categoryId: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(categoryId)) {
                next.delete(categoryId);
            } else {
                next.add(categoryId);
            }
            return next;
        });
    };

    /**
     * Recursively renders menu items with support for nested children.
     */
    const renderMenuItem = (item: IMenuItem, isNested = false): JSX.Element => {
        const hasChildren = item.children && item.children.length > 0;
        const isExpanded = expandedCategories.has(item._id);

        // Container node (no URL) - render as expandable category
        if (!item.url && hasChildren) {
            return (
                <div key={item._id} className={styles.category}>
                    <button
                        className={styles.categoryButton}
                        onClick={() => toggleCategory(item._id)}
                        aria-expanded={isExpanded}
                    >
                        <span>{item.label}</span>
                        {isExpanded ? (
                            <ChevronDown size={16} />
                        ) : (
                            <ChevronRight size={16} />
                        )}
                    </button>
                    {isExpanded && (
                        <div className={styles.categoryChildren}>
                            {item.children!.map(child => renderMenuItem(child, true))}
                        </div>
                    )}
                </div>
            );
        }

        // Link node - render as navigation link
        if (item.url) {
            const isActive = item.url === '/'
                ? pathname === '/'
                : pathname.startsWith(item.url);

            return (
                <Link
                    key={item._id}
                    href={item.url}
                    className={`${styles.tab} ${isActive ? styles.active : ''} ${isNested ? styles.nested : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                >
                    {item.label}
                </Link>
            );
        }

        // Fallback for invalid nodes
        return <span key={item._id}>{item.label}</span>;
    };

    /**
     * Generates menu items for the hamburger menu.
     */
    const renderHamburgerItem = (item: IMenuItem, isNested = false): JSX.Element => {
        if (item.url) {
            return (
                <Link key={item._id} href={item.url} className={isNested ? styles.nestedHamburger : ''}>
                    {item.label}
                </Link>
            );
        }
        // For categories in hamburger, show all children inline
        if (item.children) {
            return (
                <div key={item._id} className={styles.hamburgerCategory}>
                    <span className={styles.hamburgerCategoryLabel}>{item.label}</span>
                    {item.children.map(child => renderHamburgerItem(child, true))}
                </div>
            );
        }
        return <span key={item._id}>{item.label}</span>;
    };

    const hamburgerItems = visibleItems.map(item => renderHamburgerItem(item));
    const navContent = <>{visibleItems.map(item => renderMenuItem(item))}</>;
    const navAriaLabel = ariaLabel || `${namespace} navigation`;

    /**
     * Wraps navigation in HamburgerMenu if enabled.
     */
    if (menuConfig.hamburgerMenu?.enabled && !menuConfig.loading) {
        return (
            <nav className={styles.nav} aria-label={navAriaLabel}>
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
        <nav className={styles.nav} aria-label={navAriaLabel}>
            {navContent}
        </nav>
    );
}
