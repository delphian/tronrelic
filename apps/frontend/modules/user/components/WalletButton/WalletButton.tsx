'use client';

/**
 * WalletButton Component
 *
 * Self-contained wallet connection button with login state display.
 * Shows different states based on login status:
 * - Logged out: "Connect" button with TronLink styling
 * - Logged in: Wallet address with logout on click
 *
 * When user clicks Connect, TronLink connects and login is called automatically.
 * When user clicks their address (logged in), logout is called and TronLink disconnects.
 *
 * Note: isLoggedIn is a UI/feature gate - UUID tracking always continues.
 */

import { useEffect, useCallback, useState } from 'react';
import { AlertCircle, Wallet, Loader2 } from 'lucide-react';
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

    // Logged in state - show address with logout on click
    if (isLoggedIn && address) {
        const buttonClasses = [styles.connected_btn];
        if (!walletVerified) buttonClasses.push(styles.unverified);

        return (
            <Button
                variant="secondary"
                size="sm"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className={buttonClasses.join(' ')}
            >
                {isLoggingOut ? (
                    <Loader2 size={14} className={styles.spinner} />
                ) : !walletVerified ? (
                    <AlertCircle
                        size={14}
                        className={styles.unverified_icon}
                        aria-label="Wallet not verified"
                    />
                ) : null}
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
                <>
                    <span className={styles.wallet_icon}>
                        <Wallet size={18} />
                    </span>
                    <img
                        src="/images/tronlink/tronlink-64x64.jpg"
                        alt="TronLink"
                        className={styles.wallet_icon_mobile}
                    />
                </>
            )}
            <span className={styles.connect_text_full}>Connect Wallet</span>
            <span className={styles.connect_text_short}>Connect</span>
        </button>
    );
}
