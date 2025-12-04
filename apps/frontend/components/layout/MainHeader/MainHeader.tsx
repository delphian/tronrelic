/**
 * MainHeader Component (Server Component)
 *
 * Primary site header with database-driven navigation, logo, and utility controls.
 * Combines MenuNavSSR for database-driven menu items with client-side wallet and
 * theme controls.
 *
 * Architecture:
 * - Server component (this file) - Renders static structure and MenuNavSSR
 * - MainHeaderControls (client) - Handles interactive wallet and theme features
 * - Fully responsive with hamburger menu support via MenuNav
 *
 * SSR + Live Updates Pattern:
 * - Theme data is fetched in layout.tsx and passed down for immediate rendering
 * - Theme toggle buttons render with server data (no loading flash)
 * - After hydration, client handles theme switching interactively
 *
 * @example
 * ```tsx
 * // In app/layout.tsx
 * <MainHeader initialThemes={themes} initialThemeId={selectedThemeId} />
 * ```
 */

import Link from 'next/link';
import type { IOrderedTheme } from '../../../app/layout';
import { MenuNavSSR } from '../MenuNav';
import { MainHeaderControls } from './MainHeaderControls';
import styles from './MainHeader.module.css';

/**
 * Props for the MainHeader component.
 */
interface MainHeaderProps {
    /**
     * Active themes fetched during SSR for immediate toggle button rendering.
     * Each theme includes pre-resolved SVG icon data from the backend.
     */
    initialThemes: IOrderedTheme[];
    /**
     * Currently selected theme ID from cookie, read during SSR.
     * Null if no theme is active.
     */
    initialThemeId: string | null;
}

/**
 * Main site header with navigation and utility controls.
 *
 * Server component that renders the header structure with database-driven
 * navigation managed through the backend MenuService. Navigation items can be
 * edited via the `/system/menu` admin interface.
 *
 * The header includes:
 * - Logo/home link (server-rendered)
 * - Database-driven navigation (MenuNavSSR - server-rendered)
 * - Theme toggle and wallet button (MainHeaderControls - client-rendered with SSR data)
 *
 * Responsive behavior uses container queries via MenuNav component to automatically
 * switch between horizontal navigation and hamburger menu.
 */
export async function MainHeader({ initialThemes, initialThemeId }: MainHeaderProps) {
    return (
        <header className={styles.header}>
            <div className={styles.container}>
                <Link href="/" className={styles.logo}>
                    TronRelic
                </Link>

                <MainHeaderControls
                    initialThemes={initialThemes}
                    initialThemeId={initialThemeId}
                />

                <div className={styles.nav_section}>
                    <MenuNavSSR namespace="main" ariaLabel="Main navigation" />
                </div>
            </div>
        </header>
    );
}
