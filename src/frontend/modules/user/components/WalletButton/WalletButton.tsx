'use client';

/**
 * WalletButton Component
 *
 * Self-contained wallet connection button driving the two-stage wallet flow
 * (see User Module README for the canonical anonymous / registered / verified
 * taxonomy). Shows different states based on the visitor's identity state
 * and live TronLink connection:
 *
 * 1. **No connected address** — "Login" button. Triggers TronLink account
 *    access; on success the wallet is auto-registered by the `useWallet`
 *    hook and the user transitions from *anonymous* to *registered*.
 * 2. **Connected address, not currently Verified** — Address with warning
 *    icon. Click prompts for signature to verify the wallet (user becomes
 *    *verified*). This branch fires for never-signed registered users
 *    *and* for users whose previous session has expired — both states
 *    resolve through the same re-sign affordance, no special UI.
 * 3. **Connected address, currently Verified** — Address. Click navigates
 *    to the user's profile page.
 *
 * The verified check reads the user-level `identityState === Verified`,
 * which the backend has already resolved through its lazy session-expiry
 * pass. A user whose session has aged past `SESSION_TTL_MS` reads as
 * not-Verified here, so the button routes them to the re-sign CTA
 * instead of into the Verified-only profile route (which would 404).
 *
 * Logout is handled from the user's profile page, not from this button.
 */

import { useEffect, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { useToast } from '../../../../components/ui/ToastProvider';
import { useWallet } from '../../hooks/useWallet';
import styles from './WalletButton.module.scss';

/**
 * Truncates a wallet address to show first 6 and last 4 characters.
 * Example: TRSbL...N8Mq
 */
function truncateWallet(address: string) {
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Wallet connection button with login state display.
 */
export function WalletButton() {
    const {
        address,
        connect,
        verify,
        connectionError,
        isVerified,
        connectionStatus
    } = useWallet();
    const router = useRouter();
    const { push } = useToast();
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);

    // Display connection errors via toast
    useEffect(() => {
        if (connectionError) {
            const isNotInstalled = connectionError.includes('not detected');
            push({
                tone: 'warning',
                title: 'Wallet Connection',
                description: connectionError,
                ...(isNotInstalled && {
                    actionLabel: 'Get TronLink',
                    onAction: () => window.open('https://www.tronlink.org/', '_blank')
                })
            });
        }
    }, [connectionError, push]);

    /**
     * Handle connect button click.
     *
     * Triggers TronLink account access. The `useWallet` hook's auto-register
     * effect picks up the connected address and registers it on the backend
     * (stage 1), moving the user from *anonymous* to *registered*. The
     * separate "verify" CTA then handles the signature step.
     */
    const handleConnect = useCallback(async () => {
        setIsLoggingIn(true);
        try {
            await connect();
        } catch (error) {
            console.error('Connect failed:', error);
        } finally {
            setIsLoggingIn(false);
        }
    }, [connect]);

    /**
     * Handle verify button click.
     * Ensures TronLink is connected, then requests signature.
     *
     * SSR hydrates wallet addresses from the database, but TronLink may not
     * be connected yet. We must call connect() first to access the signing API.
     * For whitelisted sites, connect() returns silently (no popup).
     */
    const handleVerify = useCallback(async () => {
        setIsVerifying(true);
        try {
            await connect();
            const verified = await verify();
            if (verified) {
                push({
                    tone: 'success',
                    title: 'Wallet Verified',
                    description: 'Your wallet has been verified successfully.'
                });
            }
            // Failure path: verify() dispatches setConnectionError, which the
            // connectionError useEffect surfaces as a warning toast.
        } catch (error) {
            console.error('Verify failed:', error);
        } finally {
            setIsVerifying(false);
        }
    }, [connect, verify, push]);

    /**
     * Handle profile navigation.
     * Navigates to the user's profile page when wallet is verified.
     */
    const handleNavigateToProfile = useCallback(() => {
        if (address) {
            router.push(`/u/${address}`);
        }
    }, [address, router]);

    // Not-currently-Verified branch — fires for never-signed registered
    // users and for users whose previous session has expired. Both
    // recover through the same verify CTA.
    if (address && !isVerified) {
        return (
            <Button
                variant="secondary"
                size="sm"
                onClick={handleVerify}
                disabled={isVerifying}
                className={styles.connected_btn}
                title="Click to verify wallet ownership"
            >
                {isVerifying ? (
                    <Loader2 size={14} className={styles.spinner} />
                ) : (
                    <AlertCircle
                        size={14}
                        className={styles.registered_icon}
                        aria-label="Click to verify wallet"
                    />
                )}
                {truncateWallet(address)}
            </Button>
        );
    }

    // Verified state — click navigates to profile
    if (address) {
        return (
            <Button
                variant="secondary"
                size="sm"
                onClick={handleNavigateToProfile}
                className={styles.connected_btn}
                title="View your profile"
            >
                <ShieldCheck
                    size={14}
                    className={styles.verified_icon}
                    aria-label="Wallet verified"
                />
                {truncateWallet(address)}
            </Button>
        );
    }

    // Logged out state - show connect button (responsive via parent container query)
    const isConnecting = connectionStatus === 'connecting' || isLoggingIn;

    return (
        <button
            className={styles.connect_btn}
            onClick={handleConnect}
            disabled={isConnecting}
            aria-label="Login"
        >
            {isConnecting ? (
                <Loader2 size={18} className={styles.spinner} />
            ) : (
                <img
                    src="/images/tronlink/tronlink-64x64.jpg"
                    alt="TronLink"
                    className={styles.wallet_icon}
                />
            )}
            <span className={styles.login_text}>Login</span>
        </button>
    );
}
