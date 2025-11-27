'use client';

/**
 * WalletButton Component
 *
 * Self-contained wallet connection button with verification status display.
 * Shows different states based on connection and verification status:
 * - Not connected: "Connect Wallet" button with TronLink styling
 * - Connected, unverified: Wallet address with warning icon
 * - Connected, verified: Wallet address (no icon)
 *
 * Handles error display via toast notifications when connection fails.
 */

import { useEffect } from 'react';
import { AlertCircle, Wallet } from 'lucide-react';
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
 * Wallet connection button with verification status display.
 */
export function WalletButton() {
    const {
        address,
        connect,
        disconnect,
        connectionError,
        walletVerified,
        connectionStatus
    } = useWallet();
    const { push } = useToast();

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

    // Connected state - show address with verification indicator
    if (address) {
        const buttonClasses = [styles.connected_btn];
        if (!walletVerified) buttonClasses.push(styles.unverified);

        return (
            <Button
                variant="secondary"
                size="sm"
                onClick={disconnect}
                className={buttonClasses.join(' ')}
            >
                {!walletVerified && (
                    <AlertCircle
                        size={14}
                        className={styles.unverified_icon}
                        aria-label="Wallet not verified"
                    />
                )}
                {truncateWallet(address)}
            </Button>
        );
    }

    // Disconnected state - show connect button (responsive via parent container query)
    return (
        <button
            className={styles.connect_btn}
            onClick={connect}
            disabled={connectionStatus === 'connecting'}
            aria-label="Connect wallet"
        >
            <span className={styles.wallet_icon}>
                <Wallet size={18} />
            </span>
            <img
                src="/images/tronlink/tronlink-64x64.jpg"
                alt="TronLink"
                className={styles.wallet_icon_mobile}
            />
            <span className={styles.connect_text_full}>Connect Wallet</span>
            <span className={styles.connect_text_short}>Connect</span>
        </button>
    );
}
