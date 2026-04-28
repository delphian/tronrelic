/**
 * @fileoverview Authentication gate for the `/system/*` admin surface.
 *
 * Renders the protected layout when the cookie-resolved user is a
 * verified admin; otherwise renders an explanatory screen telling the
 * visitor what they're missing (verified wallet, admin group, or
 * neither). The legacy "paste your admin token here" form is gone —
 * there is no longer a JS-readable admin secret to enter.
 *
 * The gate is purely a UX surface. The trust boundary is the backend
 * `requireAdmin` middleware; even if a visitor reaches a page through
 * this component without being an admin, the API calls behind it will
 * return 401.
 */
'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useSystemAuth } from '../../contexts/SystemAuthContext';
import { useWallet } from '../../../../modules/user';
import { useAppSelector } from '../../../../store/hooks';
import { selectWallets } from '../../../../modules/user/slice';
import styles from '../../../../app/(core)/system/layout.module.css';

/**
 * Explanatory screen for visitors who are not verified admins.
 *
 * The message adapts to where the visitor is in the funnel: anonymous
 * needs to connect a wallet, registered needs to verify it, verified
 * needs an existing admin to add them to the admin group, and a
 * stale-Verified admin needs to re-sign any attached wallet via the
 * dedicated refresh-verification endpoint.
 */
function NotAdminScreen({
    needsVerification,
    needsAdminGroupMembership,
    needsRefreshVerification
}: {
    needsVerification: boolean;
    needsAdminGroupMembership: boolean;
    needsRefreshVerification: boolean;
}) {
    let title: string;
    let body: ReactNode;

    if (needsRefreshVerification) {
        title = 'Verification expired — re-sign to continue';
        body = <RefreshVerificationPrompt />;
    } else if (needsAdminGroupMembership) {
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
                    plus admin-group membership. Connect and verify your TronLink wallet
                    on your profile, then return here.
                </p>
                <p>
                    <Link href="/profile">Go to your profile →</Link>
                </p>
            </>
        );
    } else {
        title = 'Admin access required';
        body = (
            <>
                <p>
                    The system surface is restricted to admin users. Connect and verify a
                    TronLink wallet that's been added to the <code>admin</code> group.
                </p>
                <p>
                    <Link href="/profile">Connect your wallet →</Link>
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
 * Inline re-sign affordance for a stale-Verified admin.
 *
 * The user is already an admin — the cookie path validated identity,
 * group membership, and the verified state. They just need to refresh
 * `verifiedAt` on any attached verified wallet to bring the freshness
 * clock back inside the window. Picks the primary verified wallet by
 * default; any verified wallet works since the freshness rule is
 * "any-fresh-wins."
 *
 * Refusing to render a wallet picker when only one verified wallet
 * exists is intentional — most operators only carry one wallet, and
 * making them pick from a list of one adds friction without value.
 * If multi-wallet operators ever request the picker, swap the
 * `targetWallet` derivation for a `<select>`.
 */
function RefreshVerificationPrompt() {
    const wallets = useAppSelector(selectWallets);
    const { refreshVerification, providerDetected } = useWallet();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Pick the wallet to refresh. Primary verified wallet wins; if no
    // wallet is flagged primary, the first verified wallet is fine.
    const targetWallet =
        wallets.find(w => w.verified && w.isPrimary) ??
        wallets.find(w => w.verified) ??
        null;

    const handleClick = async () => {
        if (!targetWallet) {
            setError('No verified wallet available to refresh.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const ok = await refreshVerification(targetWallet.address);
            if (!ok) {
                setError('Refresh failed. Make sure TronLink is unlocked and try again.');
            }
            // On success the SystemAuthProvider re-derives isAuthenticated
            // from the updated userData and the gate re-renders the
            // protected layout — no manual navigation needed.
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Refresh failed.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
            <p>
                Admin authority on this surface requires a wallet signature within
                the last 14 days. Your last signature has aged past that window —
                re-prove control of an attached wallet to refresh it. Identity,
                group membership, and verification history are all preserved;
                only the freshness clock is reset.
            </p>
            {targetWallet ? (
                <p>
                    <button
                        type="button"
                        onClick={handleClick}
                        disabled={submitting || !providerDetected}
                    >
                        {submitting
                            ? 'Waiting for TronLink…'
                            : `Re-sign with ${targetWallet.address.slice(0, 6)}…${targetWallet.address.slice(-4)}`}
                    </button>
                </p>
            ) : (
                <p>
                    No verified wallet is attached to this account. Visit{' '}
                    <Link href="/profile">your profile</Link> to verify a wallet first.
                </p>
            )}
            {!providerDetected && (
                <p>
                    <small>TronLink not detected. Install or unlock the extension and reload.</small>
                </p>
            )}
            {error && (
                <p>
                    <small>{error}</small>
                </p>
            )}
        </>
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
 * user is not a verified admin; otherwise renders the protected layout.
 * Must be inside `SystemAuthProvider` to access the context.
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
        needsAdminGroupMembership,
        needsRefreshVerification
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
                needsRefreshVerification={needsRefreshVerification}
            />
        );
    }

    return <AuthenticatedLayout navigation={navigation}>{children}</AuthenticatedLayout>;
}
