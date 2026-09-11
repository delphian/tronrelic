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
 * The branding read happens on the server, inside BrandedHeaderControls, so the
 * chosen image is in the first HTML response and the button never switches from
 * text to image after the page loads.
 *
 * Responsive behavior uses container queries via MenuNav component to automatically
 * switch between horizontal navigation and hamburger menu.
 *
 * @returns The site header element.
 */
export function MainHeader() {
    return (
        <header className={styles.header}>
            <div className={styles.container}>
                <Link href="/" className={styles.logo}>
                    TronRelic
                </Link>

                <BrandedHeaderControls />

                <div className={styles.nav_section}>
                    <MenuNavSSR namespace="main" ariaLabel="Main navigation" />
                </div>
            </div>
        </header>
    );
}

/**
 * Header controls with the administrator's sign-in button image applied.
 *
 * The branding read lives in its own server component instead of in
 * MainHeader so that it renders as a sibling of MenuNavSSR. React starts
 * sibling server components at the same time, so the branding request and
 * the menu request run concurrently rather than one after the other. This
 * keeps the header from adding a second sequential backend round trip to
 * every page render.
 *
 * @returns The header controls, given the chosen image URL, or null so the
 *     default text sign-in button renders.
 */
async function BrandedHeaderControls() {
    const { authButtonImageUrl } = await fetchHeaderBranding();

    return <MainHeaderControls authButtonImageUrl={authButtonImageUrl} />;
}
