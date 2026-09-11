/**
 * MainHeader Component (Server Component)
 *
 * Primary site header with database-driven navigation, logo, and utility controls.
 * Combines MenuNavSSR for database-driven menu items with client-side wallet
 * controls.
 *
 * Architecture:
 * - Server component (this file) - Renders static structure and MenuNavSSR,
 *   and reads the branding settings that decide how the sign-in button looks
 * - MainHeaderControls (client) - Handles interactive wallet features
 * - Fully responsive with hamburger menu support via MenuNav
 */

import Link from 'next/link';
import { MenuNavSSR } from '../MenuNav';
import { MainHeaderControls } from './MainHeaderControls';
import { fetchHeaderBranding } from './fetchHeaderBranding';
import styles from './MainHeader.module.scss';

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
 * - Wallet button (MainHeaderControls - client-rendered), shown as the
 *   administrator-chosen image when one is set
 *
 * The branding read happens here, on the server, so the chosen image is in the
 * first HTML response and the button never switches from text to image after
 * the page loads.
 *
 * Responsive behavior uses container queries via MenuNav component to automatically
 * switch between horizontal navigation and hamburger menu.
 */
export async function MainHeader() {
    const { authButtonImageUrl } = await fetchHeaderBranding();

    return (
        <header className={styles.header}>
            <div className={styles.container}>
                <Link href="/" className={styles.logo}>
                    TronRelic
                </Link>

                <MainHeaderControls authButtonImageUrl={authButtonImageUrl} />

                <div className={styles.nav_section}>
                    <MenuNavSSR namespace="main" ariaLabel="Main navigation" />
                </div>
            </div>
        </header>
    );
}
