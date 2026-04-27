import { type ReactNode } from 'react';
import type { Metadata } from 'next';
import { SystemAuthProvider, SystemAuthGate } from '../../../features/system';

/**
 * Force dynamic rendering for all system pages.
 *
 * Required because admin sub-pages render dynamic content (live job
 * status, current users, runtime config) that should never be cached at
 * build time when the backend isn't available.
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
 * System monitoring layout with admin authentication shell.
 *
 * This server component wraps every /system/* route with the
 * authentication provider and gate. Admin navigation is no longer
 * rendered here — the items live in the main navigation under the
 * System container (`MAIN_SYSTEM_CONTAINER_ID`, defined by the menu
 * module) and are gated per-user via `requiresAdmin`. The layout's job
 * is now solely the auth shell and the cross-route directives below
 * (`dynamic`, `metadata`).
 *
 * Architecture:
 * - Layout (server) - Auth shell, dynamic rendering directive, robots metadata
 * - SystemAuthProvider (client) - Manages admin-token state via React Context
 * - SystemAuthGate (client) - Shows login form or authenticated content
 */

/**
 * Root system layout component.
 *
 * Wraps all /system routes with authentication provider and authentication
 * gate. All child routes automatically inherit this layout structure.
 *
 * @param props - Component props
 * @param props.children - Page content from Next.js route segments
 */
export default function SystemLayout({ children }: { children: ReactNode }) {
    return (
        <SystemAuthProvider>
            <SystemAuthGate>{children}</SystemAuthGate>
        </SystemAuthProvider>
    );
}
