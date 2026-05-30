/**
 * @fileoverview Authentication gate for the `/system/*` admin surface.
 *
 * Renders the protected layout when the Better Auth session belongs to a
 * member of the `admin` group; otherwise renders an explanatory screen
 * pointing the visitor at the recovery they need (sign in, or have an
 * existing admin add them to the group).
 *
 * The gate is purely a UX surface. The trust boundary is the backend
 * `requireAdmin` middleware; even if a visitor reaches a page through this
 * component without being an admin, the API calls behind it return 401.
 */
'use client';

import { type ReactNode } from 'react';
import { useSystemAuth } from '../../contexts/SystemAuthContext';
import styles from '../../../../app/(core)/system/layout.module.css';

/**
 * Explanatory screen for visitors who are not admins.
 *
 * Two branches: the visitor has no session (sign in via the header auth
 * button), or they are signed in but not in the `admin` group (an existing
 * admin must add them).
 */
function NotAdminScreen({
    needsLogin,
    needsAdminGroupMembership
}: {
    needsLogin: boolean;
    needsAdminGroupMembership: boolean;
}) {
    let title: string;
    let body: ReactNode;

    if (needsAdminGroupMembership) {
        title = 'Signed in — admin access required';
        body = (
            <>
                <p>
                    You're signed in, but your account isn't in the <code>admin</code>{' '}
                    group. An existing admin (or an operator with the service token)
                    needs to add your account before you can use this surface.
                </p>
                <p>
                    Operators bootstrap the first admin via the service token by calling{' '}
                    <code>PUT /api/admin/users/&lt;your-account-id&gt;/groups</code> with{' '}
                    <code>{`{"groups": ["admin"]}`}</code>.
                </p>
            </>
        );
    } else if (needsLogin) {
        title = 'Sign in required';
        body = (
            <>
                <p>
                    The system surface is restricted to admin accounts. Use the sign-in
                    button in the page header to authenticate, then ask an existing admin
                    to add your account to the <code>admin</code> group.
                </p>
            </>
        );
    } else {
        title = 'Admin access required';
        body = (
            <>
                <p>
                    The system surface is restricted to admin accounts. Ask an existing
                    admin to add your account to the <code>admin</code> group.
                </p>
            </>
        );
    }

    return (
        <div className={styles.login_container}>
            <div className={styles.login_content}>
                <header className={styles.login_header}>
                    <h1 className={styles.login_title}>{title}</h1>
                </header>
                <div className={styles.login_form}>
                    {body}
                </div>
            </div>
        </div>
    );
}

/**
 * Authenticated layout containing optional sub-navigation and child page
 * content.
 *
 * The system surface no longer renders its own sub-nav — admin items live in
 * the main navigation under the System container — but the prop is retained
 * for future per-section sub-navs and only rendered when supplied so an
 * absent prop doesn't introduce a blank row.
 *
 * @param props - Component props
 * @param props.navigation - Optional sub-navigation rendered above content
 * @param props.children - Page content to render
 */
function AuthenticatedLayout({ navigation, children }: { navigation?: ReactNode; children: ReactNode }) {
    return (
        <div className={styles.layout_container}>
            <div className={styles.layout_content}>
                {navigation && (
                    <div className={styles.layout_nav_row}>
                        {navigation}
                    </div>
                )}

                <section className={styles.layout_section}>
                    {children}
                </section>
            </div>
        </div>
    );
}

/**
 * Authentication gate component that checks admin status.
 *
 * Renders the explanatory not-admin screen when the session is not an admin
 * account; otherwise renders the protected layout. Must be inside
 * `SystemAuthProvider` to access the context.
 *
 * @param props - Component props
 * @param props.navigation - Navigation component to render below header (server-side rendered)
 * @param props.children - Page content passed from route segments
 */
export function SystemAuthGate({ navigation, children }: { navigation?: ReactNode; children: ReactNode }) {
    const {
        isAuthenticated,
        isHydrated,
        needsLogin,
        needsAdminGroupMembership
    } = useSystemAuth();

    // Until the session resolves we don't know what the visitor is. Render
    // nothing rather than flashing the not-admin screen.
    if (!isHydrated) {
        return null;
    }

    if (!isAuthenticated) {
        return (
            <NotAdminScreen
                needsLogin={needsLogin}
                needsAdminGroupMembership={needsAdminGroupMembership}
            />
        );
    }

    return <AuthenticatedLayout navigation={navigation}>{children}</AuthenticatedLayout>;
}
