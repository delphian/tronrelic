import { type ReactNode } from 'react';
import { SystemAuthProvider, SystemAuthGate, SystemNavSSR } from '../../../features/system';

/**
 * Force dynamic rendering for all system pages.
 *
 * Required because SystemNavSSR fetches menu data with cache: 'no-store' to ensure
 * navigation always reflects current menu structure. This prevents Next.js from
 * attempting static pre-rendering at build time when the backend isn't available.
 */
export const dynamic = 'force-dynamic';

/**
 * System monitoring layout with server-side navigation and authentication.
 *
 * This server component renders the SystemNavSSR component to fetch and display
 * navigation items on the server, ensuring they appear immediately without client-side
 * placeholders. Authentication logic is handled by client components (SystemAuthProvider
 * and SystemAuthGate) which manage login state and conditional rendering.
 *
 * Architecture:
 * - Layout (server) - Renders static structure and SSR navigation
 * - SystemAuthProvider (client) - Manages auth state via React Context
 * - SystemNavSSR (server) - Fetches menu items from backend API during SSR
 * - SystemAuthGate (client) - Shows login form or authenticated content
 *
 * This pattern allows navigation to render on the server while authentication remains
 * client-side for localStorage access and interactive login flows.
 */

/**
 * Root system layout component.
 *
 * Wraps all /system routes with authentication provider, server-rendered navigation,
 * and authentication gate. The navigation renders on the server and appears immediately,
 * while the authentication UI (login form, logout button) is client-side for interactivity.
 *
 * All child routes automatically inherit this layout structure. The SystemNavSSR component
 * fetches menu items from the backend IMenuService during server rendering, ensuring
 * navigation is always up-to-date with the menu system.
 *
 * @param props - Component props
 * @param props.children - Page content from Next.js route segments
 */
export default function SystemLayout({ children }: { children: ReactNode }) {
    return (
        <SystemAuthProvider>
            <SystemNavSSR />
            <SystemAuthGate>
                {children}
            </SystemAuthGate>
        </SystemAuthProvider>
    );
}
