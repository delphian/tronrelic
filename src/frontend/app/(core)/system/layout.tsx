import { type ReactNode } from 'react';
import type { Metadata } from 'next';
import { SystemAuthProvider, SystemAuthGate, LogoutNavItem } from '../../../features/system';
import { MenuNavSSR } from '../../../components/layout/MenuNav';

/**
 * Force dynamic rendering for all system pages.
 *
 * Required because MenuNavSSR fetches menu data with cache: 'no-store' to ensure
 * navigation always reflects current menu structure. This prevents Next.js from
 * attempting static pre-rendering at build time when the backend isn't available.
 */
export const dynamic = 'force-dynamic';

/**
 * Block search engine indexing for the entire /system/* admin surface.
 *
 * Why this exists:
 * Every route under /system/* is admin-only and gated by SystemAuthGate, so the
 * only thing a crawler would index is the login form — a pure reconnaissance
 * leak that exposes the admin entry point without exposing data. Setting robots
 * here cascades to every nested route (overview, plugin admin pages, scheduler,
 * websockets, users, etc.) without each page having to opt in.
 *
 * Next.js merges metadata across the layout hierarchy by replacing the robots
 * field rather than merging it, so this overrides the root layout's
 * `robots: { index: true, follow: true }` for all /system/* paths.
 */
export const metadata: Metadata = {
    robots: {
        index: false,
        follow: false
    }
};

/**
 * System monitoring layout with server-side navigation and authentication.
 *
 * This server component renders the MenuNavSSR component to fetch and display
 * navigation items on the server, ensuring they appear immediately without client-side
 * placeholders. Authentication logic is handled by client components (SystemAuthProvider
 * and SystemAuthGate) which manage login state and conditional rendering.
 *
 * Architecture:
 * - Layout (server) - Renders static structure and SSR navigation
 * - SystemAuthProvider (client) - Manages auth state via React Context
 * - MenuNavSSR (server) - Fetches menu items from backend API during SSR
 * - SystemAuthGate (client) - Shows login form or authenticated content
 *
 * This pattern allows navigation to render on the server while authentication remains
 * client-side for localStorage access and interactive login flows.
 */

/**
 * Root system layout component.
 *
 * Wraps all /system routes with authentication provider and authentication gate.
 * The navigation is passed to SystemAuthGate to render below the header, ensuring
 * proper visual hierarchy (header → navigation → content).
 *
 * All child routes automatically inherit this layout structure. The MenuNavSSR component
 * fetches menu items from the backend IMenuService during server rendering, ensuring
 * navigation is always up-to-date with the menu system.
 *
 * @param props - Component props
 * @param props.children - Page content from Next.js route segments
 */
export default function SystemLayout({ children }: { children: ReactNode }) {
    return (
        <SystemAuthProvider>
            <SystemAuthGate
                navigation={
                    <MenuNavSSR
                        namespace="system"
                        ariaLabel="System monitoring navigation"
                        trailingItems={[{ id: 'system-logout', node: <LogoutNavItem /> }]}
                    />
                }
            >
                {children}
            </SystemAuthGate>
        </SystemAuthProvider>
    );
}
