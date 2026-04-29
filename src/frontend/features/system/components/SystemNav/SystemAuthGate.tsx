/**
 * @fileoverview Authentication gate for the `/system/*` admin surface.
 *
 * Renders the protected layout when the cookie-resolved user is a
 * Verified admin; otherwise renders an explanatory screen pointing the
 * visitor at the recovery they need (verify a wallet, or have an
 * existing admin add them). Verification freshness is folded into
 * `Verified` itself — a stale-signed user reads as `Registered` and
 * falls into the `needsVerification` branch the same way an unsigned
 * user does. Recovery is the normal verify-wallet flow on `/profile`;
 * there is no special re-sign affordance here, because the affordance
 * disappearance is the signal and `/profile` is where wallet
 * management already lives.
 *
 * The gate is purely a UX surface. The trust boundary is the backend
 * `requireAdmin` middleware; even if a visitor reaches a page through
 * this component without being an admin, the API calls behind it will
 * return 401.
 */
'use client';

import { type ReactNode } from 'react';
import { useSystemAuth } from '../../contexts/SystemAuthContext';
import styles from '../../../../app/(core)/system/layout.module.css';

/**
 * Explanatory screen for visitors who are not Verified admins.
 *
 * Two branches: the visitor is not currently `Verified` (no wallets,
 * unsigned wallets, or every signature is stale — `/profile` is where
 * they fix it), or they are `Verified` but not in the admin group (an
 * existing admin must add them).
 */
function NotAdminScreen({
    needsVerification,
    needsAdminGroupMembership
}: {
    needsVerification: boolean;
    needsAdminGroupMembership: boolean;
}) {
    let title: string;
    let body: ReactNode;

    if (needsAdminGroupMembership) {
        title = 'Wallet verified — admin access required';
        body = (
            <>
                <p>
                    Your wallet is verified, but you're not in the <code>admin</code> group.
                    An existing admin (or an operator with the service token) needs to add
                    your account to the admin group before you can use this surface.
                </p>
                <p>
                    Operators bootstrap the first admin via the service token by calling{' '}
                    <code>PUT /api/admin/users/&lt;your-uuid&gt;/groups</code> with{' '}
                    <code>{`{"groups": ["admin"]}`}</code>.
                </p>
            </>
        );
    } else if (needsVerification) {
        title = 'Wallet verification required';
        body = (
            <>
                <p>
                    The system surface requires a cryptographically verified wallet
                    plus admin-group membership. Use the wallet button in the
                    page header to connect and sign a TronLink wallet, then
                    return here. If you've used this surface before, your last
                    signature has aged past the freshness window — clicking the
                    same button re-signs the attached wallet and restores admin
                    access.
                </p>
            </>
        );
    } else {
        title = 'Admin access required';
        body = (
            <>
                <p>
                    The system surface is restricted to admin users. Use the
                    wallet button in the page header to connect and verify a
                    TronLink wallet, then ask an existing admin to add your
                    account to the <code>admin</code> group.
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
 * The system surface no longer renders its own sub-nav — admin items
 * live in the main navigation under the System container — but the prop
 * is retained for future per-section sub-navs and only rendered when
 * supplied so an absent prop doesn't introduce a blank row.
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
 * Renders the explanatory not-admin screen when the cookie-resolved
 * user is not a Verified admin; otherwise renders the protected
 * layout. Must be inside `SystemAuthProvider` to access the context.
 *
 * @param props - Component props
 * @param props.navigation - Navigation component to render below header (server-side rendered)
 * @param props.children - Page content passed from route segments
 */
export function SystemAuthGate({ navigation, children }: { navigation?: ReactNode; children: ReactNode }) {
    const {
        isAuthenticated,
        isHydrated,
        needsVerification,
        needsAdminGroupMembership
    } = useSystemAuth();

    // Until bootstrap completes we don't know what the user is. Render
    // nothing rather than flashing the not-admin screen.
    if (!isHydrated) {
        return null;
    }

    if (!isAuthenticated) {
        return (
            <NotAdminScreen
                needsVerification={needsVerification}
                needsAdminGroupMembership={needsAdminGroupMembership}
            />
        );
    }

    return <AuthenticatedLayout navigation={navigation}>{children}</AuthenticatedLayout>;
}
