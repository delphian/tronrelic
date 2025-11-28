'use client';

/**
 * WalletButton Component
 *
 * Self-contained wallet connection button with two-step linking flow.
 * Shows different states based on connection and verification status:
 *
 * 1. **Logged out**: "Connect" button - triggers TronLink account access
 * 2. **Logged in, unverified**: Address with warning icon - click to verify via signature
 * 3. **Logged in, verified**: Address - click to logout
 *
 * Note: isLoggedIn is a UI/feature gate - UUID tracking always continues.
 */

import { useEffect, useCallback, useState } from 'react';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { useToast } from '../../../../components/ui/ToastProvider';
import { useWallet } from '../../hooks/useWallet';
import styles from './WalletButton.module.css';

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
        login,
        logout,
        connectionError,
        walletVerified,
        connectionStatus,
        isLoggedIn
    } = useWallet();
    const { push } = useToast();
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
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
     * Connects to TronLink, then auto-logs in.
     */
    const handleConnect = useCallback(async () => {
        setIsLoggingIn(true);
        try {
            await connect();
            // Auto-login after successful connection
            await login();
        } catch (error) {
            console.error('Connect/login failed:', error);
        } finally {
            setIsLoggingIn(false);
        }
    }, [connect, login]);

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
            await verify();
            push({
                tone: 'success',
                title: 'Wallet Verified',
                description: 'Your wallet has been verified successfully.'
            });
        } catch (error) {
            console.error('Verify failed:', error);
            push({
                tone: 'warning',
                title: 'Verification Failed',
                description: 'Unable to verify wallet. Please try again.'
            });
        } finally {
            setIsVerifying(false);
        }
    }, [connect, verify, push]);

    /**
     * Handle logout button click.
     * Logs out (sets isLoggedIn=false) and disconnects TronLink session.
     */
    const handleLogout = useCallback(async () => {
        setIsLoggingOut(true);
        try {
            await logout();
        } catch (error) {
            console.error('Logout failed:', error);
            push({
                tone: 'warning',
                title: 'Logout Failed',
                description: 'Unable to log out. Please try again.'
            });
        } finally {
            setIsLoggingOut(false);
        }
    }, [logout, push]);

    // Logged in, unverified state - show address with verify on click
    if (isLoggedIn && address && !walletVerified) {
        return (
            <Button
                variant="secondary"
                size="sm"
                onClick={handleVerify}
                disabled={isVerifying}
                className={`${styles.connected_btn} ${styles.unverified}`}
                title="Click to verify wallet ownership"
            >
                {isVerifying ? (
                    <Loader2 size={14} className={styles.spinner} />
                ) : (
                    <AlertCircle
                        size={14}
                        className={styles.unverified_icon}
                        aria-label="Click to verify wallet"
                    />
                )}
                {truncateWallet(address)}
            </Button>
        );
    }

    // Logged in, verified state - show address with logout on click
    if (isLoggedIn && address) {
        return (
            <Button
                variant="secondary"
                size="sm"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className={styles.connected_btn}
            >
                {isLoggingOut ? (
                    <Loader2 size={14} className={styles.spinner} />
                ) : (
                    <ShieldCheck
                        size={14}
                        className={styles.verified_icon}
                        aria-label="Wallet verified"
                    />
                )}
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
            aria-label="Connect wallet"
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
            Connect
        </button>
    );
}
