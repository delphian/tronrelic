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
 * Responsive behavior uses Priority+ navigation pattern with IntersectionObserver
 * to automatically show as many items as fit, moving overflow items to a "More"
 * dropdown based on the namespace configuration from the backend.
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

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PriorityNav, useMenuConfig } from '../../../modules/menu';
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
 * Responsive behavior uses Priority+ navigation with IntersectionObserver to
 * automatically detect overflow and move items to a "More" dropdown based on
 * available space and the namespace configuration.
 *
 * @param props - Component props
 * @param props.namespace - Menu namespace for config lookup
 * @param props.items - Menu items from server
 * @param props.ariaLabel - Optional accessible label
 */
export function MenuNavClient({ namespace, items, ariaLabel }: IMenuNavClientProps) {
    const pathname = usePathname();
    const menuConfig = useMenuConfig(namespace);
    const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
    const [isMounted, setIsMounted] = useState(false);
    const categoryButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Sort by order and filter enabled items
    const visibleItems = useMemo(() => items
        .filter(item => item.enabled)
        .sort((a, b) => a.order - b.order), [items]);

    // Track mount state for portal rendering (SSR safety)
    useEffect(() => {
        setIsMounted(true);
    }, []);

    /**
     * Close dropdown and return focus to the category button.
     */
    const closeDropdown = useCallback(() => {
        if (expandedCategoryId) {
            const button = categoryButtonRefs.current.get(expandedCategoryId);
            setExpandedCategoryId(null);
            button?.focus();
        }
    }, [expandedCategoryId]);

    /**
     * Handle Escape key to close dropdown.
     */
    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && expandedCategoryId) {
                closeDropdown();
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [expandedCategoryId, closeDropdown]);

    /**
     * Handle clicks outside dropdown to close it.
     */
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (!expandedCategoryId) return;

            const button = categoryButtonRefs.current.get(expandedCategoryId);
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node) &&
                !button?.contains(event.target as Node)
            ) {
                closeDropdown();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [expandedCategoryId, closeDropdown]);

    /**
     * Lock body scroll when category dropdown is open on mobile.
     *
     * Prevents background page from scrolling when interacting with the
     * category bottom sheet on mobile devices.
     */
    useEffect(() => {
        if (!expandedCategoryId) return;

        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (!isMobile) return;

        const originalOverflow = document.body.style.overflow;
        const originalTouchAction = document.body.style.touchAction;

        document.body.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';

        return () => {
            document.body.style.overflow = originalOverflow;
            document.body.style.touchAction = originalTouchAction;
        };
    }, [expandedCategoryId]);

    /**
     * Toggles a category's expanded state.
     */
    const toggleCategory = (categoryId: string) => {
        setExpandedCategoryId(prev => prev === categoryId ? null : categoryId);
    };

    /**
     * Renders a link menu item.
     *
     * For nested links (inside category dropdowns), dispatches a mousedown event
     * on document.body to trigger PriorityNav's click-outside handler. This ensures
     * the "More" dropdown also closes when selecting a child link from a category
     * that overflowed into the "More" menu.
     */
    const renderLinkItem = (item: IMenuItem, isNested = false): JSX.Element => {
        const isActive = item.url === '/'
            ? pathname === '/'
            : pathname.startsWith(item.url!);

        return (
            <Link
                key={item._id}
                href={item.url!}
                className={`${styles.tab} ${isActive ? styles.active : ''} ${isNested ? styles.nested : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                    if (isNested) {
                        closeDropdown();
                        // Trigger PriorityNav's click-outside handler to close "More" dropdown
                        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    }
                }}
            >
                {item.label}
            </Link>
        );
    };

    /**
     * Renders a category button (without the dropdown - that's portaled separately).
     *
     * Uses stopPropagation to prevent PriorityNav's "More" dropdown from closing
     * when a category button inside it is clicked.
     */
    const renderCategoryButton = (item: IMenuItem): JSX.Element => {
        const isExpanded = expandedCategoryId === item._id;

        return (
            <div key={item._id} className={styles.category}>
                <button
                    ref={(el) => {
                        if (el) {
                            categoryButtonRefs.current.set(item._id, el);
                        } else {
                            categoryButtonRefs.current.delete(item._id);
                        }
                    }}
                    className={styles.categoryButton}
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleCategory(item._id);
                    }}
                    aria-expanded={isExpanded}
                    aria-haspopup="true"
                >
                    <span>{item.label}</span>
                    {isExpanded ? (
                        <ChevronDown size={16} />
                    ) : (
                        <ChevronRight size={16} />
                    )}
                </button>
            </div>
        );
    };

    /**
     * Renders menu items - categories get buttons, links get rendered directly.
     */
    const renderMenuItem = (item: IMenuItem): JSX.Element => {
        const hasChildren = item.children && item.children.length > 0;

        // Container node (no URL) - render as category button
        if (!item.url && hasChildren) {
            return renderCategoryButton(item);
        }

        // Link node - render as navigation link
        if (item.url) {
            return renderLinkItem(item);
        }

        // Fallback for invalid nodes
        return <span key={item._id}>{item.label}</span>;
    };

    /**
     * Get the expanded category item for rendering its dropdown.
     */
    const expandedCategory = expandedCategoryId
        ? visibleItems.find(item => item._id === expandedCategoryId)
        : null;

    /**
     * Get position for the dropdown based on the button's bounding rect.
     */
    const getDropdownPosition = () => {
        if (!expandedCategoryId) return { top: 0, left: 0 };
        const button = categoryButtonRefs.current.get(expandedCategoryId);
        if (!button) return { top: 0, left: 0 };
        const rect = button.getBoundingClientRect();
        return {
            top: rect.bottom + 8,
            left: rect.left
        };
    };

    /**
     * Converts menu items to PriorityNav format.
     */
    const priorityNavItems = visibleItems.map(item => ({
        id: item._id,
        node: renderMenuItem(item)
    }));

    const navAriaLabel = ariaLabel || `${namespace} navigation`;

    /**
     * Wraps navigation in PriorityNav if overflow handling is enabled.
     * Uses IntersectionObserver to detect which items fit and moves overflow
     * to a "More" dropdown automatically.
     */
    const overflowEnabled = menuConfig.overflow?.enabled ?? true;

    /**
     * Renders the category dropdown portal.
     * Portaled to document.body to escape overflow:hidden constraints.
     */
    const renderCategoryDropdown = () => {
        if (!isMounted || !expandedCategory || !expandedCategory.children) {
            return null;
        }

        const position = getDropdownPosition();

        return createPortal(
            <>
                {/* Backdrop - prevents interaction with page behind sheet */}
                <div
                    className={styles.categoryBackdrop}
                    aria-hidden="true"
                    onClick={closeDropdown}
                    onTouchMove={(e) => e.preventDefault()}
                />
                {/* Dropdown panel */}
                <div
                    ref={dropdownRef}
                    className={styles.categoryDropdown}
                    role="menu"
                    aria-label={`${expandedCategory.label} submenu`}
                    style={{
                        top: position.top,
                        left: position.left
                    }}
                >
                    {expandedCategory.children.map(child => (
                        <div
                            key={child._id}
                            className={styles.categoryDropdownItem}
                            role="menuitem"
                        >
                            {renderLinkItem(child, true)}
                        </div>
                    ))}
                </div>
            </>,
            document.body
        );
    };

    if (overflowEnabled && !menuConfig.loading) {
        return (
            <>
                <nav className={styles.nav} aria-label={navAriaLabel}>
                    <PriorityNav
                        items={priorityNavItems}
                        enabled={overflowEnabled}
                        collapseAtCount={menuConfig.overflow?.collapseAtCount}
                        moreButtonLabel={`More ${namespace} menu items`}
                    />
                </nav>
                {renderCategoryDropdown()}
            </>
        );
    }

    return (
        <>
            <nav className={`${styles.nav} ${styles['nav--wrap']}`} aria-label={navAriaLabel}>
                {visibleItems.map(item => renderMenuItem(item))}
            </nav>
            {renderCategoryDropdown()}
        </>
    );
}
