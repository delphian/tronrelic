/**
 * MainHeaderControls Component (Client Component)
 *
 * Interactive controls for the main header including theme toggle and wallet connection.
 * Separated from MainHeader server component to enable client-side interactivity.
 *
 * @example
 * ```tsx
 * // Used by MainHeader (server component)
 * <MainHeaderControls />
 * ```
 */
'use client';

import { Wallet } from 'lucide-react';
import { Button } from '../../ui/Button';
import { ThemeToggle } from '../../ThemeToggle';
import { useWallet } from '../../../features/accounts';
import styles from './MainHeader.module.css';

/**
 * Truncates a wallet address to show first 6 and last 4 characters.
 *
 * Reduces visual clutter while maintaining address recognizability.
 * Example: TRSbL...N8Mq
 *
 * @param address - Full TRON wallet address
 * @returns Truncated address string with ellipsis
 */
function truncateWallet(address: string) {
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Interactive header controls component.
 *
 * Provides client-side interactive features for the main header:
 * - Theme toggle (dark/light mode switching)
 * - Wallet connection button with TronLink integration
 *
 * The wallet button shows different states:
 * - Not connected: "Connect Wallet" with "Soon" badge (currently disabled)
 * - Connected: Truncated address with disconnect on click
 *
 * Uses React hooks for wallet state management and theme switching.
 */
export function MainHeaderControls() {
    const { address, connect, disconnect, providerDetected } = useWallet();

    return (
        <div className={styles.controls}>
            <ThemeToggle />
            {address ? (
                <Button variant="secondary" size="sm" onClick={disconnect}>
                    {truncateWallet(address)}
                </Button>
            ) : (
                <button
                    className={styles.connect_wallet_btn}
                    onClick={connect}
                    disabled={!providerDetected}
                    aria-label="Connect wallet (coming soon)"
                >
                    <span className={styles.wallet_icon}>
                        <Wallet size={18} />
                    </span>
                    Connect Wallet
                    <span className={styles.coming_soon_badge}>Soon</span>
                </button>
            )}
        </div>
    );
}
