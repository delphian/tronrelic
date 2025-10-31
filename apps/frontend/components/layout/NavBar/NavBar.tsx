'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { Wallet } from 'lucide-react';
import { Button } from '../../ui/Button';
import { ThemeToggle } from '../../ThemeToggle';
import { useWallet } from '../../../features/accounts';
import { pluginRegistry } from '../../../lib/pluginRegistry';
import { useMenuConfig } from '../../../lib/hooks';
import { HamburgerMenu } from '../HamburgerMenu';
import type { IMenuItemConfig } from '@tronrelic/types';
import styles from './NavBar.module.css';

const coreNavLinks: IMenuItemConfig[] = [
    { href: '/', label: 'Overview', order: 0 },
    { href: '/resource-markets', label: 'Energy Markets', order: 1 },
    { href: '/accounts', label: 'Accounts', order: 6 }
];

/**
 * Determines if the given pathname matches or starts with the href.
 *
 * Used for nav link active state highlighting. Handles both exact matches
 * (for homepage) and prefix matches (for section paths).
 *
 * @param pathname - Current page path from Next.js router
 * @param href - Navigation link href to check against
 * @returns True if the path is active for this nav item
 */
function isActivePath(pathname: string, href: string) {
    if (href === '/') {
        return pathname === '/';
    }
    return pathname.startsWith(href);
}

/**
 * Truncates a wallet address to show first 6 and last 4 characters.
 *
 * Reduces visual clutter while maintaining address recognizability.
 * Example: TRSbL...N8Mq
 *
 * @param address - Full TRON wallet address
 * @returns Truncated address string with ellipsis
 */
function truncateWallet(address: string) {
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * NavBar Component
 *
 * Primary navigation header that combines core navigation links with plugin-based
 * menu items. Supports categorized dropdown menus for organizing related links,
 * wallet connection controls, responsive hamburger menu, and active state highlighting.
 *
 * Navigation items are automatically sorted by category and order, with uncategorized
 * items appearing as top-level links and categorized items grouped in dropdowns.
 *
 * The component subscribes to the plugin registry for dynamic menu item registration,
 * allowing plugins to contribute navigation items without modifying core code.
 *
 * Responsive behavior uses container queries to automatically switch between horizontal
 * navigation (wide containers) and hamburger menu (narrow containers) based on the
 * namespace configuration from the backend.
 *
 * @example
 * ```tsx
 * <NavBar />
 * ```
 */
export function NavBar() {
    const pathname = usePathname();
    const { address, connect, disconnect, status, providerDetected } = useWallet();
    const [isClient, setIsClient] = useState(false);
    const [allNavLinks, setAllNavLinks] = useState<IMenuItemConfig[]>(coreNavLinks);
    const [openDropdown, setOpenDropdown] = useState<string | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const menuConfig = useMenuConfig('main');

    useEffect(() => {
        setIsClient(true);
    }, []);

    /**
     * Closes the dropdown menu when clicking outside of it.
     *
     * Prevents dropdown menus from remaining open when users click elsewhere
     * on the page, improving UX by cleaning up UI state automatically.
     */
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setOpenDropdown(null);
            }
        }

        if (openDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => {
                document.removeEventListener('mousedown', handleClickOutside);
            };
        }
    }, [openDropdown]);

    /**
     * Merges core navigation links with plugin menu items.
     *
     * Subscribes to plugin registry updates so that navigation dynamically
     * reflects newly registered plugins without page reloads. Links are sorted
     * first by category (uncategorized first), then by order within each category.
     */
    useEffect(() => {
        const updateNavLinks = () => {
            const pluginMenuItems = pluginRegistry.getMenuItems();

            // Merge and sort core + plugin links
            const combined = [...coreNavLinks, ...pluginMenuItems];
            combined.sort((a, b) => {
                // Sort by category first (items without category come first)
                const categoryA = a.category ?? '';
                const categoryB = b.category ?? '';
                if (categoryA !== categoryB) {
                    return categoryA.localeCompare(categoryB);
                }
                // Then by order within each category
                const orderA = a.order ?? 999;
                const orderB = b.order ?? 999;
                return orderA - orderB;
            });
            setAllNavLinks(combined);
        };

        // Initial update
        updateNavLinks();

        // Subscribe to future plugin registrations
        const unsubscribe = pluginRegistry.subscribe(updateNavLinks);

        return unsubscribe;
    }, []);

    const canConnect = providerDetected || isClient;

    /**
     * Groups navigation links by category for rendering.
     *
     * Creates an array of {category, links[]} objects to separate top-level
     * navigation items from dropdown-based categorized items. This supports
     * the two-tier navigation structure where uncategorized items appear as
     * individual nav links and categorized items appear in dropdown menus.
     */
    const groupedLinks: { category: string; links: IMenuItemConfig[] }[] = [];
    let currentCategory = '';
    let currentGroup: IMenuItemConfig[] = [];

    for (const link of allNavLinks) {
        const linkCategory = link.category ?? '';
        if (linkCategory !== currentCategory) {
            if (currentGroup.length > 0) {
                groupedLinks.push({ category: currentCategory, links: currentGroup });
            }
            currentCategory = linkCategory;
            currentGroup = [link];
        } else {
            currentGroup.push(link);
        }
    }
    if (currentGroup.length > 0) {
        groupedLinks.push({ category: currentCategory, links: currentGroup });
    }

    // Separate uncategorized links (render as top-level) and categorized links (render as dropdowns)
    const topLevelLinks = groupedLinks.filter(group => !group.category);
    const dropdownGroups = groupedLinks.filter(group => group.category);

    /**
     * Toggles dropdown menu visibility for a given category.
     *
     * Clicking an open dropdown closes it, clicking a different dropdown
     * switches to that dropdown, ensuring only one dropdown is open at a time.
     *
     * @param category - Category name to toggle
     */
    const toggleDropdown = (category: string) => {
        setOpenDropdown(openDropdown === category ? null : category);
    };

    /**
     * Generates menu items for the hamburger menu.
     *
     * Flattens all navigation links (uncategorized and categorized) into a single
     * array for display in the hamburger slideout panel. Each item becomes a
     * clickable link in the vertical menu.
     */
    const hamburgerItems = allNavLinks.map(link => (
        <Link
            key={link.href}
            href={link.href}
        >
            {link.label}
        </Link>
    ));

    /**
     * Renders the navigation structure.
     *
     * Chooses between regular horizontal navigation and hamburger menu based on
     * namespace configuration. When hamburger is enabled, wraps navigation in
     * HamburgerMenu component that uses container queries to auto-switch.
     */
    const renderNavigation = () => {
        const navContent = (
            <>
                {/* Render uncategorized links as regular nav items */}
                {topLevelLinks.map(group =>
                    group.links.map(link => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className={isActivePath(pathname, link.href) ? `${styles.link} ${styles['link--active']}` : styles.link}
                        >
                            {link.label}
                        </Link>
                    ))
                )}

                {/* Render categorized links as dropdowns */}
                {dropdownGroups.map(group => {
                    const isOpen = openDropdown === group.category;
                    const hasActiveLink = group.links.some(link => isActivePath(pathname, link.href));

                    return (
                        <div key={group.category} className={styles.dropdown}>
                            <button
                                className={`${styles.dropdown__trigger} ${hasActiveLink ? styles['dropdown__trigger--active'] : ''}`}
                                onClick={() => toggleDropdown(group.category)}
                                aria-expanded={isOpen}
                            >
                                {group.category}
                                <span className={`${styles.dropdown__arrow} ${isOpen ? styles['dropdown__arrow--open'] : ''}`}>▾</span>
                            </button>
                            {isOpen && (
                                <div className={styles.dropdown__menu}>
                                    {group.links.map(link => (
                                        <Link
                                            key={link.href}
                                            href={link.href}
                                            className={isActivePath(pathname, link.href) ? `${styles.dropdown__item} ${styles['dropdown__item--active']}` : styles.dropdown__item}
                                            onClick={() => setOpenDropdown(null)}
                                        >
                                            {link.label}
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </>
        );

        // If hamburger is enabled and config is loaded, use HamburgerMenu
        if (menuConfig.hamburgerMenu?.enabled && !menuConfig.loading) {
            return (
                <HamburgerMenu
                    triggerWidth={menuConfig.hamburgerMenu.triggerWidth}
                    items={hamburgerItems}
                >
                    {navContent}
                </HamburgerMenu>
            );
        }

        // Otherwise render regular navigation
        return navContent;
    };

    return (
        <header className={styles.nav}>
            <Link href="/" className={styles.logo}>
                TronRelic
            </Link>
            <nav className={styles.links} ref={dropdownRef}>
                {renderNavigation()}
            </nav>
            <div className={styles.wallet_container}>
                <ThemeToggle />
                {address ? (
                    <Button variant="secondary" size="sm" onClick={disconnect}>
                        {truncateWallet(address)}
                    </Button>
                ) : (
                    <button
                        className={styles.connect_wallet_btn}
                        onClick={connect}
                        disabled={true}
                        aria-label="Connect wallet (coming soon)"
                    >
                        <span className={styles.wallet_icon}>
                            <Wallet size={18} />
                        </span>
                        Connect Wallet
                        <span className={styles.coming_soon_badge}>Soon</span>
                    </button>
                )}
            </div>
        </header>
    );
}
