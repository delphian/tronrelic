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

import { ThemeToggle } from '../../ThemeToggle';
import { WalletButton } from '../../../modules/user';
import styles from './MainHeader.module.css';

/**
 * Interactive header controls component.
 *
 * Provides client-side interactive features for the main header:
 * - Theme toggle (dark/light mode switching)
 * - Wallet connection button via WalletButton from modules/user
 */
export function MainHeaderControls() {
    return (
        <div className={styles.controls}>
            <ThemeToggle />
            <WalletButton />
        </div>
    );
}
