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
 * @example
 * ```tsx
 * // In app/layout.tsx
 * <MainHeader />
 * ```
 */

import Link from 'next/link';
import { MenuNavSSR } from '../MenuNav';
import { MainHeaderControls } from './MainHeaderControls';
import styles from './MainHeader.module.css';

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
 * - Theme toggle and wallet button (MainHeaderControls - client-rendered)
 *
 * Responsive behavior uses container queries via MenuNav component to automatically
 * switch between horizontal navigation and hamburger menu.
 */
export async function MainHeader() {
    return (
        <header className={styles.header}>
            <div className={styles.container}>
                <Link href="/" className={styles.logo}>
                    TronRelic
                </Link>

                <MainHeaderControls />

                <div className={styles.nav_section}>
                    <MenuNavSSR namespace="main" ariaLabel="Main navigation" />
                </div>
            </div>
        </header>
    );
}
